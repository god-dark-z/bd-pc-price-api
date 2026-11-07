/**
 * scrape-background-background.mjs — Netlify Background Function.
 * The "-background" suffix in the file name is what makes Netlify treat
 * this as a background function: 15-minute limit, caller gets an immediate
 * 202 and the work continues. It scrapes ONE retailer per invocation
 * (from the JSON body { retailer: "<id>" }, or from the Blobs queue),
 * validates every product, and publishes the result to the Netlify Blobs
 * store "products" as <retailer>.json — which the API function reads.
 *
 * ATOMIC REPLACE + KEEP-YESTERDAY-ON-FAILURE (src/lib/store.js):
 *  - The new payload is written to <retailer>.pending.json, read back and
 *    re-validated, and only then swapped into the live <retailer>.json.
 *  - If the scrape throws, returns 0 publishable products, or fails
 *    validation, the live data is NEVER touched: yesterday's data stays
 *    in place, the failure is logged, and the status blob
 *    (GET /api/status) records the retailer as "failed".
 *  - Before publishing, day-over-day price jumps (>50% vs yesterday) are
 *    flagged in conflicts[], and cross-retailer outliers (>10x the peer
 *    median for the same model_key) are flagged and excluded from
 *    lowest/highest — see src/lib/price.js.
 *
 * Security: only accepts calls with the x-scrape-secret header matching
 * the SCRAPE_SECRET env var (or a call from the scheduled function on the
 * same site). Without the secret it returns 401 and scrapes nothing.
 *
 * NOTE on Ultra Technology: its robots.txt Crawl-Delay is 20 seconds, so
 * a full Ultra crawl takes a long time even in a 15-minute background run.
 * The runner caps each invocation with SCRAPE_LIMIT (default 200 products);
 * the queue advances on the next tick, so a big retailer finishes over
 * several invocations instead of timing out.
 */
import { getStore } from "@netlify/blobs";
import { getRetailer, RETAILERS } from "../../src/scrapers/index.js";
import { scrapeRetailer } from "../../src/scrapers/opencart.js";
import { isPublishable } from "../../src/lib/normalize.js";
import { applyCrossRetailerOutliers } from "../../src/lib/price.js";
import {
  publishRetailerData,
  readStatus,
  writeStatus,
  updateStatus,
  emptyStatus,
} from "../../src/lib/store.js";

async function failRetailer(store, retailerId, error, productsKept) {
  const status = (await readStatus(store)) || emptyStatus();
  await writeStatus(
    store,
    updateStatus(status, retailerId, {
      status: "failed",
      products: productsKept ?? status.per_retailer?.[retailerId]?.products ?? 0,
      error,
    })
  );
}

export default async (req) => {
  const secret = req.headers.get("x-scrape-secret");
  if (process.env.SCRAPE_SECRET && secret !== process.env.SCRAPE_SECRET) {
    return new Response("unauthorized", { status: 401 });
  }
  const store = getStore("products");
  let retailerId = "startech";
  try {
    const body = await req.json();
    if (body?.retailer) retailerId = body.retailer;
  } catch {
    // No JSON body — fall back to the queue's next retailer.
    const queue = (await store.get("queue.json", { type: "json" })) || { next_index: 0 };
    retailerId = RETAILERS[queue.next_index % RETAILERS.length].id;
  }

  let config;
  try {
    config = getRetailer(retailerId);
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e.message) }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const limit = Number(process.env.SCRAPE_LIMIT || 200);
  console.log(`[background] scraping ${config.id} (limit ${limit})${config.degraded ? " — DEGRADED retailer" : ""}`);
  const finishedAt = new Date().toISOString();

  let result;
  try {
    result = await scrapeRetailer(config, { limit });
  } catch (e) {
    // Scrape threw before producing anything — keep yesterday's data.
    const old = (await store.get(`${config.id}.json`, { type: "json" })) || null;
    const error = `scrape threw: ${e.message || e}`;
    console.error(`[background] ${config.id}: ${error} — keeping yesterday's data (${old?.products ?? old?.items?.length ?? 0} products)`);
    await failRetailer(store, config.id, error, old?.products ?? old?.items?.length ?? 0);
    return new Response(JSON.stringify({ retailer: config.id, ok: false, kept_old_data: true, error }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }

  const publishable = result.items.filter(isPublishable);
  if (publishable.length === 0) {
    // Empty scrape (blocked, sitemap empty, all pages failed) — a 0-product
    // payload would wipe the catalogue, so refuse it and keep yesterday.
    const old = (await store.get(`${config.id}.json`, { type: "json" })) || null;
    const error = `scrape returned 0 publishable products (${result.items.length} parsed, ${result.blocked} blocked, ${result.errors.length} errors) — keeping yesterday's data`;
    console.error(`[background] ${config.id}: ${error}`);
    await failRetailer(store, config.id, error, old?.products ?? old?.items?.length ?? 0);
    return new Response(JSON.stringify({ retailer: config.id, ok: false, kept_old_data: true, error }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }

  // Cross-retailer outlier check: compare this retailer's prices against
  // the other retailers' currently stored data for the same model_key.
  // Flagged prices stay in the data but are excluded from lowest/highest.
  let flaggedOutliers = [];
  try {
    const others = [];
    for (const r of RETAILERS) {
      if (r.id === config.id) continue;
      const d = (await store.get(`${r.id}.json`, { type: "json" })) || null;
      if (d?.items) others.push(...d.items);
    }
    const checked = applyCrossRetailerOutliers([...others, ...publishable]);
    flaggedOutliers = checked.flagged.filter((f) => f.retailer_id === config.id);
    const flaggedUrls = new Set(flaggedOutliers.map((f) => f.url));
    for (const item of checked.items) {
      if (flaggedUrls.has(item.url)) {
        const target = publishable.find((p) => p.url === item.url);
        if (target) {
          target.price_flagged = true;
          for (const c of item.conflicts) if (!target.conflicts.includes(c)) target.conflicts.push(c);
        }
      }
    }
  } catch (e) {
    console.log(`[background] ${config.id}: cross-retailer outlier check skipped (${e.message})`);
  }

  const payload = { ...result, products: publishable.length, items: publishable, finished: finishedAt };
  const published = await publishRetailerData(store, config.id, payload);
  if (!published.ok) {
    const error = `publish failed: ${published.errors.join("; ")} — keeping yesterday's data`;
    console.error(`[background] ${config.id}: ${error}`);
    await failRetailer(store, config.id, error);
    return new Response(JSON.stringify({ retailer: config.id, ok: false, kept_old_data: true, error }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }

  const status = (await readStatus(store)) || emptyStatus();
  await writeStatus(
    store,
    updateStatus(status, config.id, {
      status: "ok",
      products: publishable.length,
      last_scrape: finishedAt,
    })
  );
  console.log(
    `[background] ${config.id}: published ${publishable.length} publishable / ${result.items.length} parsed, ${result.blocked} blocked, ${result.errors.length} errors, ${flaggedOutliers.length} outlier-flagged, ${published.flagged_jumps.length} day-over-day jumps flagged`
  );
  return new Response(
    JSON.stringify({
      retailer: config.id,
      ok: true,
      publishable: publishable.length,
      outlier_flagged: flaggedOutliers.length,
      day_over_day_flagged: published.flagged_jumps.length,
    }),
    { status: 202, headers: { "content-type": "application/json" } }
  );
};
