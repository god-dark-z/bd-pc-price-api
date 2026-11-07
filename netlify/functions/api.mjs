/**
 * api.mjs — the public API for the price-comparison site.
 *
 * DATA SOURCE: stored scraped data ONLY. This function reads Netlify Blobs
 * store "products" (written once a day by the background scrape functions)
 * and falls back to the bundled data/*.json files shipped with the deploy,
 * so the API still answers before the first scrape runs. It NEVER performs
 * a live scrape per request — prices here are at most one refresh old.
 * The separate manual admin function scrape-live.mjs is the ONLY live
 * fetch in this project, and the website must NOT call it (see its header).
 *
 * Endpoints (full documentation: API_DOCUMENTATION.md):
 *   GET /api/search?q=<query>&retailer=<id>&category=<cat>&in_stock=true
 *       &sort=lowest|highest&limit=<n>&page=<n>
 *   GET /api/product?url=<product-url>
 *   GET /api/retailers
 *   GET /api/stats
 *   GET /api/status   — data freshness: last_refresh, per-retailer status,
 *                        product counts, failures
 *
 * Lowest/highest prices are computed from ELIGIBLE prices only: in-stock,
 * non-null, unflagged (see src/lib/price.js eligibleForLowest). Out-of-
 * stock products (price stored as last_seen_price) and flagged prices
 * (absurd / 10x cross-retailer outlier) never win lowest/highest.
 * Savings are always computed from price vs regular_price, never from a
 * site's "Save:" field.
 */
import { getStore } from "@netlify/blobs";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { computeLowestHighest, applyCrossRetailerOutliers } from "../../src/lib/price.js";
import { readStatus, buildStatusFromRetailers, emptyStatus } from "../../src/lib/store.js";
import { SEED_BY_RETAILER } from "../../src/lib/seed-data.js";

const BUNDLED_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data");

/**
 * Pick the first NON-EMPTY retailer payload, in priority order:
 * Blobs (live daily scrape) -> bundled data/*.json -> seed module.
 * An empty payload (blob exists but items is missing or []) must NEVER
 * shadow the fallbacks — it means "no data yet", not "0 products".
 * Exported so tests can verify the guard without a live Blobs store.
 */
export function pickRetailerPayload({ blob, bundled, seed }) {
  for (const candidate of [blob, bundled, seed]) {
    if (candidate && Array.isArray(candidate.items) && candidate.items.length > 0) return candidate;
  }
  return null;
}

async function loadRetailer(id) {
  let blob = null;
  try {
    const store = getStore("products");
    blob = await store.get(`${id}.json`, { type: "json" });
  } catch {
    // Blobs unavailable (local dev / first deploy) — fall through.
  }
  let bundled = null;
  try {
    const raw = await readFile(join(BUNDLED_DIR, `${id}.json`), "utf8");
    bundled = JSON.parse(raw);
  } catch {
    bundled = null;
  }
  // Last resort: the seed module. JSON files read with fs.readFile work
  // locally but are NOT in the deployed Netlify bundle (ENOENT in
  // production) unless declared in netlify.toml `included_files` — the
  // imported seed module is always bundled, so the API answers even
  // before the first nightly refresh has written anything to Blobs.
  return pickRetailerPayload({ blob, bundled, seed: SEED_BY_RETAILER[id] || null });
}

async function loadAll() {
  const { RETAILERS } = await import("../../src/scrapers/index.js");
  const out = [];
  for (const r of RETAILERS) {
    const data = await loadRetailer(r.id);
    if (data) out.push(data);
  }
  return out;
}

/** All products across retailers, with cross-retailer outlier flags applied defensively. */
async function loadAllProducts() {
  const all = await loadAll();
  const products = all.flatMap((d) => d.items || []);
  // Defensive re-check at read time: even if stored data predates the
  // flagging step, a 10x outlier can never win lowest/highest here.
  const { items } = applyCrossRetailerOutliers(products);
  const lastUpdated = all.map((d) => d.finished).filter(Boolean).sort().pop() || null;
  return { all, products: items, lastUpdated };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "public, max-age=300" },
  });
}

function error(message, status, extra = {}) {
  return json({ error: message, ...extra }, status);
}

function matchQuery(product, q) {
  const hay = `${product.name || ""} ${product.model_key || ""} ${product.brand || ""}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((tok) => hay.includes(tok));
}

function parseLimit(value, fallback = 50) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(100, Math.max(1, Math.floor(n)));
}

function parsePage(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

export default async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/$/, "");

  // --- GET /api/retailers -------------------------------------------------
  if (path === "/api/retailers" || path.endsWith("/api/retailers")) {
    const { RETAILERS } = await import("../../src/scrapers/index.js");
    const all = await loadAll();
    const byId = Object.fromEntries(all.map((d) => [d.retailer_id, d]));
    return json({
      retailers: RETAILERS.map((r) => ({
        id: r.id,
        name: r.name,
        base_url: r.baseUrl,
        degraded: !!r.degraded,
        browser_required: !!r.browserRequired,
        products: byId[r.id]?.products ?? byId[r.id]?.items?.length ?? 0,
        last_scrape: byId[r.id]?.finished ?? null,
      })),
    });
  }

  // --- GET /api/stats ------------------------------------------------------
  if (path === "/api/stats" || path.endsWith("/api/stats")) {
    const { all, products, lastUpdated } = await loadAllProducts();
    return json({
      generated_at: new Date().toISOString(),
      last_updated: lastUpdated,
      total_products: all.reduce((n, d) => n + (d.products ?? d.items?.length ?? 0), 0),
      in_stock_products: products.filter((p) => p.stock === "in_stock").length,
      out_of_stock_products: products.filter((p) => p.stock === "out_of_stock").length,
      flagged_products: products.filter((p) => p.price_flagged).length,
      per_retailer: all.map((d) => ({
        retailer_id: d.retailer_id,
        products: d.products ?? d.items?.length ?? 0,
        finished: d.finished,
      })),
    });
  }

  // --- GET /api/status ------------------------------------------------------
  // Data freshness: when the data was last refreshed, per-retailer status,
  // product counts and failures. Prefer the status blob written by the
  // scheduled/background functions; fall back to deriving it from the
  // retailer files when no refresh has written a status blob yet.
  if (path === "/api/status" || path.endsWith("/api/status")) {
    const all = await loadAll();
    let status = null;
    try {
      const store = getStore("products");
      status = await readStatus(store);
    } catch {
      status = null;
    }
    if (!status || typeof status !== "object" || !status.per_retailer) {
      status = buildStatusFromRetailers(all);
      status.note = "no status blob written yet (no scheduled refresh has run) — freshness derived from the retailer files";
    }
    return json({
      ...emptyStatus(),
      ...status,
      refresh_schedule: status.refresh_schedule || "0 18 * * *",
      refresh_schedule_human: status.refresh_schedule_human || "daily at 18:00 UTC (= 00:00 Dhaka)",
      generated_at: new Date().toISOString(),
    });
  }

  // --- GET /api/product?url= ----------------------------------------------
  if (path === "/api/product" || path.endsWith("/api/product")) {
    const want = url.searchParams.get("url");
    if (!want) return error("missing ?url= — e.g. /api/product?url=https://www.startech.com.bd/amd-ryzen-7-5700g-processor", 400);
    const { products } = await loadAllProducts();
    const hit = products.find((p) => p.url === want);
    if (hit) return json(hit);
    return error("product not found in current data — it may not have been scraped yet", 404, { url: want });
  }

  // --- GET /api/search ------------------------------------------------------
  if (path === "/api/search" || path.endsWith("/api/search")) {
    const q = (url.searchParams.get("q") || "").trim();
    if (!q) return error("missing ?q= — e.g. /api/search?q=Ryzen%207%205700G", 400);
    const retailerFilter = (url.searchParams.get("retailer") || "").trim().toLowerCase();
    const categoryFilter = (url.searchParams.get("category") || "").trim().toLowerCase();
    const inStockOnly = url.searchParams.get("in_stock") === "true";
    const sort = url.searchParams.get("sort") === "highest" ? "highest" : "lowest";
    const limit = parseLimit(url.searchParams.get("limit"));
    const page = parsePage(url.searchParams.get("page"));

    const { products, lastUpdated } = await loadAllProducts();
    let matches = products.filter((p) => matchQuery(p, q));
    if (retailerFilter) matches = matches.filter((p) => p.retailer_id === retailerFilter);
    if (categoryFilter) matches = matches.filter((p) => (p.category || "").toLowerCase().includes(categoryFilter));
    if (inStockOnly) matches = matches.filter((p) => p.stock === "in_stock");

    // Sort by buyable price; products without a buyable price sort last.
    const priceKey = (p) => (p.price ?? Infinity);
    matches.sort((a, b) => (sort === "highest" ? priceKey(b) - priceKey(a) : priceKey(a) - priceKey(b)));

    const { lowest_price, highest_price } = computeLowestHighest(matches);
    const savingsPct =
      lowest_price && highest_price && highest_price > lowest_price
        ? Math.round(((highest_price - lowest_price) / highest_price) * 1000) / 10
        : 0;
    const total = matches.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const pageItems = matches.slice((page - 1) * limit, page * limit);
    return json({
      query: q,
      count: total,
      page,
      limit,
      total_pages: totalPages,
      sort,
      retailer: retailerFilter || null,
      category: categoryFilter || null,
      in_stock_only: inStockOnly,
      lowest_price,
      highest_price,
      savings_pct: savingsPct,
      last_updated: lastUpdated,
      results: pageItems,
    });
  }

  // --- unknown /api path -----------------------------------------------------
  return error(`unknown API path: ${path} — see API_DOCUMENTATION.md (GET /api/search, /api/product, /api/retailers, /api/stats, /api/status)`, 404);
};

export const config = { path: "/api/*" };
