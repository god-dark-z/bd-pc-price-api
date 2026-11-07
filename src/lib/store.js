/**
 * store.js — atomic publish + freshness status for the daily refresh.
 *
 * THE DAILY-REFRESH CONTRACT (see README / API_DOCUMENTATION.md):
 *  - Once a day at 18:00 UTC (= 00:00 Dhaka) the scheduled function fires
 *    and triggers one background job per retailer.
 *  - Each background job scrapes its retailer, then REPLACES that
 *    retailer's blob data ATOMICALLY: the new payload is written to a
 *    pending key, validated (including a read-back), and only then swapped
 *    into the live key. The live key is never overwritten with an empty,
 *    half-written or invalid dataset.
 *  - If a retailer's scrape fails (fetch error, 0 publishable products,
 *    validation failure), YESTERDAY'S DATA IS KEPT for that retailer and
 *    the failure is logged in the status blob — the API keeps serving the
 *    old data and reports the failure in GET /api/status.
 *  - DAY-OVER-DAY JUMP FLAG: before publishing, each product's new price
 *    is compared with yesterday's stored price; a jump of more than 50%
 *    up or down is flagged in conflicts[] (and day_over_day_flagged) —
 *    never silently accepted.
 *
 * This module is storage-agnostic: `store` is any object with
 * get(key, {type:"json"}), setJSON(key, value) and delete(key) — the
 * Netlify Blobs store in production, a plain in-memory fake in tests.
 */
import { isPublishable } from "./normalize.js";
import { dayOverDayChangePct, DAY_OVER_DAY_JUMP_PCT } from "./price.js";

export const STATUS_KEY = "status.json";
export const QUEUE_KEY = "queue.json";

/** Effective (comparable) price of a stored product: buyable price, else last seen. */
export function effectivePrice(product) {
  if (!product) return null;
  if (product.price !== null && product.price !== undefined) return product.price;
  if (product.last_seen_price !== null && product.last_seen_price !== undefined) return product.last_seen_price;
  return null;
}

/**
 * Validate a retailer payload before it may replace live data.
 * Returns { ok, errors[] }. A payload is valid only when it has a
 * non-empty items array and every item is publishable with a sane price
 * (no 0 / negative prices, no savings above 80%).
 */
export function validateRetailerPayload(payload) {
  const errors = [];
  if (!payload || typeof payload !== "object") return { ok: false, errors: ["payload is not an object"] };
  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    return { ok: false, errors: ["no publishable products in this scrape — refusing to replace live data"] };
  }
  for (const p of payload.items) {
    if (!isPublishable(p)) {
      errors.push(`unpublishable product in payload: ${p?.url || p?.name || "(no url/name)"}`);
      continue;
    }
    if (p.price !== null && p.price !== undefined && (!Number.isFinite(p.price) || p.price <= 0)) {
      errors.push(`bad price ${p.price} on ${p.url}`);
    }
    if (p.savings_pct > 80) {
      errors.push(`implausible savings ${p.savings_pct}% on ${p.url}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Day-over-day jump check. Compares each new item's effective price with
 * the stored (yesterday's) item with the same URL. A move of more than
 * 50% up or down adds a conflict and sets day_over_day_flagged = true on
 * the new item; the flag travels with the product into the API output.
 * Returns { items, flagged } — `flagged` is the list of jumps for logging.
 */
export function applyDayOverDayFlags(newItems, oldItems) {
  const oldByUrl = new Map((oldItems || []).map((p) => [p.url, p]));
  const flagged = [];
  const items = (newItems || []).map((p) => {
    const next = { ...p, conflicts: [...(p.conflicts || [])] };
    const old = oldByUrl.get(p.url);
    if (!old) return next;
    const pct = dayOverDayChangePct(effectivePrice(old), effectivePrice(next));
    if (pct === null) return next;
    if (Math.abs(pct) > DAY_OVER_DAY_JUMP_PCT) {
      next.day_over_day_flagged = true;
      const msg = `day-over-day price jump: ${effectivePrice(old)} -> ${effectivePrice(next)} (${pct > 0 ? "+" : ""}${pct}%) — flagged, verify the live page before trusting it`;
      if (!next.conflicts.includes(msg)) next.conflicts.push(msg);
      flagged.push({ url: p.url, retailer_id: p.retailer_id, old_price: effectivePrice(old), new_price: effectivePrice(next), change_pct: pct });
      console.warn(`[price-guard] ${msg} (${p.retailer_id} ${p.url})`);
    }
    return next;
  });
  return { items, flagged };
}

async function readJson(store, key) {
  try {
    return (await store.get(key, { type: "json" })) || null;
  } catch {
    return null;
  }
}

/**
 * Atomically publish one retailer's data:
 *  1. Validate the new payload — invalid payloads never touch live data.
 *  2. Apply day-over-day flags against the current live data.
 *  3. Write the payload to `<retailer>.pending.json`, read it back and
 *     re-validate (guards against a half-written blob).
 *  4. Only then overwrite the live `<retailer>.json` and delete the
 *     pending key.
 * On any failure the live data is untouched and the result reports
 * kept_old_data: true so the caller can log it in the status blob.
 * Returns { ok, kept_old_data, errors[], flagged_jumps }.
 */
export async function publishRetailerData(store, retailerId, payload) {
  const liveKey = `${retailerId}.json`;
  const pendingKey = `${retailerId}.pending.json`;
  const oldPayload = await readJson(store, liveKey);
  const validation = validateRetailerPayload(payload);
  if (!validation.ok) {
    console.error(`[store] ${retailerId}: refusing to publish invalid payload: ${validation.errors.join("; ")} — keeping yesterday's data`);
    return { ok: false, kept_old_data: true, errors: validation.errors, flagged_jumps: [] };
  }
  const { items, flagged } = applyDayOverDayFlags(payload.items, oldPayload?.items || []);
  const publishable = { ...payload, items };
  try {
    await store.setJSON(pendingKey, publishable);
    const readBack = await readJson(store, pendingKey);
    const readBackCheck = validateRetailerPayload(readBack);
    if (!readBackCheck.ok) {
      throw new Error(`pending read-back failed validation: ${readBackCheck.errors.join("; ")}`);
    }
    await store.setJSON(liveKey, publishable);
    try {
      await store.delete(pendingKey);
    } catch {
      // Pending cleanup is best-effort; the live key is already correct.
    }
    return { ok: true, kept_old_data: false, errors: [], flagged_jumps: flagged };
  } catch (e) {
    console.error(`[store] ${retailerId}: atomic publish failed (${e.message}) — live data untouched`);
    return { ok: false, kept_old_data: true, errors: [String(e.message || e)], flagged_jumps: flagged };
  }
}

/** Empty status document shape. */
export function emptyStatus() {
  return {
    last_refresh: null,
    last_attempt: null,
    refresh_schedule: "0 18 * * *",
    refresh_schedule_human: "daily at 18:00 UTC (= 00:00 Dhaka)",
    total_products: 0,
    per_retailer: {},
    failures: [],
  };
}

/**
 * Merge one retailer's refresh result into the status document.
 * `result` is { status: "ok"|"failed"|"queued", products, error?, failures? }.
 */
export function updateStatus(status, retailerId, result) {
  const next = status && typeof status === "object" ? { ...status, per_retailer: { ...(status.per_retailer || {}) } } : emptyStatus();
  next.per_retailer[retailerId] = {
    status: result.status,
    products: result.products ?? next.per_retailer[retailerId]?.products ?? 0,
    last_scrape: result.last_scrape || new Date().toISOString(),
    error: result.error || null,
  };
  if (result.status === "ok") next.last_refresh = new Date().toISOString();
  next.last_attempt = new Date().toISOString();
  next.total_products = Object.values(next.per_retailer).reduce((n, r) => n + (r.products || 0), 0);
  const failures = Object.entries(next.per_retailer)
    .filter(([, r]) => r.status === "failed")
    .map(([id, r]) => ({ retailer_id: id, error: r.error, last_scrape: r.last_scrape }));
  next.failures = failures;
  return next;
}

/** Read the status blob (null when no refresh has ever run). */
export async function readStatus(store) {
  return readJson(store, STATUS_KEY);
}

/** Write the status blob. */
export async function writeStatus(store, status) {
  await store.setJSON(STATUS_KEY, status);
}

/**
 * Build a status document from retailer payloads alone (fallback for
 * GET /api/status when no status blob exists yet — e.g. before the first
 * scheduled refresh). last_refresh is the newest finished timestamp.
 */
export function buildStatusFromRetailers(retailerPayloads) {
  const status = emptyStatus();
  let newest = null;
  for (const d of retailerPayloads || []) {
    if (!d) continue;
    status.per_retailer[d.retailer_id] = {
      status: "ok",
      products: d.products ?? d.items?.length ?? 0,
      last_scrape: d.finished || null,
      error: null,
    };
    if (d.finished && (!newest || d.finished > newest)) newest = d.finished;
  }
  status.last_refresh = newest;
  status.total_products = Object.values(status.per_retailer).reduce((n, r) => n + (r.products || 0), 0);
  return status;
}
