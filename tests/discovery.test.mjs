/**
 * Discovery diagnostics + empty-blob guard tests.
 * Covers the failures found in the live 00:20 Dhaka test run (2026-11-08):
 *  - 4 retailers failed with "scrape returned 0 publishable products"
 *    and NO cause was visible: the message did not say how many URLs
 *    discovery found or dropped, and sitemap fetch failures were silently
 *    swallowed in listProductUrls. Fix: listProductUrls returns
 *    { urls, discovery_errors }, scrapeRetailer carries discovery_errors,
 *    and the background function puts urls_found / dropped / the first
 *    discovery errors into its failure message and the status blob.
 *  - Sitemap fetches now use a 60s timeout (large XML files) while
 *    product pages keep the 20s default.
 *  - An empty Blobs payload (items missing or []) used to be returned
 *    as-is and shadow the bundled-JSON / seed fallbacks. Fix:
 *    pickRetailerPayload skips empty payloads at every level.
 * Run: npm test   (node --test tests/)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { pickRetailerPayload } from "../netlify/functions/api.mjs";
import { SITEMAP_TIMEOUT_MS, scrapeRetailer } from "../src/scrapers/opencart.js";

const seedDoc = {
  retailer_id: "startech",
  retailer: "Star Tech",
  items: [{ url: "https://www.startech.com.bd/amd-ryzen-7-5700g-processor", name: "AMD Ryzen 7 5700G", price: 20600 }],
};
const bundledDoc = {
  retailer_id: "startech",
  retailer: "Star Tech",
  items: [{ url: "https://www.startech.com.bd/amd-ryzen-7-5700g-processor", name: "AMD Ryzen 7 5700G", price: 20600 }],
};
const blobDoc = {
  retailer_id: "startech",
  retailer: "Star Tech",
  items: [{ url: "https://www.startech.com.bd/amd-ryzen-7-5700g-processor", name: "AMD Ryzen 7 5700G", price: 20600 }],
};

test("pickRetailerPayload: non-empty blob wins", () => {
  assert.equal(pickRetailerPayload({ blob: blobDoc, bundled: bundledDoc, seed: seedDoc }), blobDoc);
});

test("pickRetailerPayload: empty blob falls through to bundled JSON", () => {
  const emptyBlob = { retailer_id: "startech", items: [] };
  assert.equal(pickRetailerPayload({ blob: emptyBlob, bundled: bundledDoc, seed: seedDoc }), bundledDoc);
});

test("pickRetailerPayload: empty blob + missing items falls through to seed", () => {
  assert.equal(pickRetailerPayload({ blob: { retailer_id: "startech" }, bundled: null, seed: seedDoc }), seedDoc);
  assert.equal(pickRetailerPayload({ blob: { retailer_id: "startech", items: [] }, bundled: { retailer_id: "startech", items: [] }, seed: seedDoc }), seedDoc);
});

test("pickRetailerPayload: empty at every level returns null, never an empty payload", () => {
  assert.equal(pickRetailerPayload({ blob: { items: [] }, bundled: null, seed: null }), null);
  assert.equal(pickRetailerPayload({ blob: null, bundled: null, seed: null }), null);
});

test("sitemap fetches use a 60s timeout, not the 20s product-page default", () => {
  assert.equal(SITEMAP_TIMEOUT_MS, 60000);
});

// One live-network test (unreachable local address — connection refused
// immediately; fetchText still spends ~9s on its two retry back-offs).
// It proves a failed sitemap fetch is RECORDED, not swallowed.
test("scrapeRetailer surfaces discovery errors when the sitemap cannot be fetched", async () => {
  const config = {
    id: "testbad",
    name: "Test Bad",
    baseUrl: "https://example.invalid",
    sitemapUrls: ["http://127.0.0.1:1/sitemap.xml"],
    categoryUrls: [],
    crawlDelayMs: 0,
  };
  const result = await scrapeRetailer(config, { limit: 5 });
  assert.equal(result.urls_found, 0);
  assert.equal(result.items.length, 0);
  assert.ok(Array.isArray(result.discovery_errors), "result must carry discovery_errors");
  assert.ok(result.discovery_errors.length >= 1, "the failed sitemap fetch must be recorded");
  assert.equal(result.discovery_errors[0].url, "http://127.0.0.1:1/sitemap.xml");
  assert.ok(typeof result.discovery_errors[0].error === "string" && result.discovery_errors[0].error.length > 0);
});
