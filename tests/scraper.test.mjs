/**
 * Offline tests — no network calls. Fixtures are small HTML/XML strings
 * built from the verified research examples (Star Tech 5700G page shape,
 * Techland listing-card price pair, Ultra 0৳ placeholder).
 * Run: npm test   (node --test tests/)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseAmount,
  parseAmounts,
  pricePair,
  savingsPct,
  isPlausibleDiscount,
  reconcilePrices,
} from "../src/lib/price.js";
import { modelKey, normalizeProduct, isPublishable } from "../src/lib/normalize.js";
import { parseSitemapUrls, isSitemapIndex, isChallengePage } from "../src/lib/http.js";
import {
  extractJsonLd,
  extractOpenGraph,
  extractSpecTable,
  extractDescription,
  extractLatestPriceSentence,
} from "../src/lib/jsonld.js";
import { parseProduct } from "../src/scrapers/opencart.js";
import { config as startech } from "../src/scrapers/startech.js";
import { RETAILERS } from "../src/scrapers/index.js";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const productHtml = readFileSync(join(FIX, "opencart-product.html"), "utf8");
const sitemapXml = readFileSync(join(FIX, "sitemap.xml"), "utf8");

// --- price parsing ---
test("parseAmount: BDT formats, commas, taka sign", () => {
  assert.equal(parseAmount("20,600৳"), 20600);
  assert.equal(parseAmount("৳20,600"), 20600);
  assert.equal(parseAmount("22500.00 BDT"), 22500);
  assert.equal(parseAmount("Tk 1,500"), 1500);
  assert.equal(parseAmount(21900), 21900);
});

test("parseAmount: zero is no price, never a deal", () => {
  assert.equal(parseAmount("0৳"), null);
  assert.equal(parseAmount("0"), null);
  assert.equal(parseAmount(0), null);
  assert.equal(parseAmount("Call for price"), null);
});

test("pricePair: offer first, regular second (listing-card order)", () => {
  assert.deepEqual(pricePair([36300, 39000]), { price: 36300, regularPrice: 39000 });
  assert.deepEqual(pricePair([3900]), { price: 3900, regularPrice: null });
  // Reversed/garbage pair: keep only the offer price.
  assert.deepEqual(pricePair([39000, 36300]), { price: 39000, regularPrice: null });
});

test("savings: computed from the two prices, never the Save: field", () => {
  // Techland card: 39,000 -> 36,300 is 6.9%, NOT the card's "Save: 1,000".
  assert.equal(savingsPct(36300, 39000), 6.9);
  assert.equal(savingsPct(20600, 22500), 8.4);
  assert.equal(savingsPct(3900, 3900), 0);
});

test("savings above 80% are implausible (the -94% bug class)", () => {
  assert.equal(isPlausibleDiscount(800, 100000), false);
  assert.equal(isPlausibleDiscount(20600, 22500), true);
});

test("reconcilePrices: visible offer wins, structured regular is kept, conflict logged", () => {
  // Star Tech 5700G: visible 20,600, OG 22,500 (regular).
  const r = reconcilePrices({ visiblePrice: 20600, structuredPrice: 22500, source: "opengraph" });
  assert.equal(r.price, 20600);
  assert.equal(r.regularPrice, 22500);
  assert.equal(r.conflicts.length, 0);
});

test("reconcilePrices: implausible discount drops the suspect regular price", () => {
  const r = reconcilePrices({ visiblePrice: 800, visibleRegular: 100000, structuredPrice: null });
  assert.equal(r.price, 800);
  assert.equal(r.regularPrice, null);
  assert.ok(r.conflicts.length > 0);
});

// --- normalisation ---
test("modelKey groups the same chip across retailers", () => {
  assert.equal(modelKey("AMD Ryzen 7 5700G Processor with Radeon Graphics"), "amd ryzen 7 5700g");
  assert.equal(modelKey("AMD Ryzen 7 5700G 8 Core Processor"), "amd ryzen 7 5700g");
});

test("isPublishable: needs name + URL + (price or stock reason)", () => {
  const base = { name: "X", url: "https://example.com/x", price: 100, stock: "in_stock" };
  assert.equal(isPublishable(normalizeProduct({ id: "t", name: "T" }, base)), true);
  assert.equal(
    isPublishable(normalizeProduct({ id: "t", name: "T" }, { ...base, price: null, stock: "unknown" })),
    false
  );
});

// --- sitemap / challenge detection ---
test("parseSitemapUrls extracts loc URLs, deduped", () => {
  const urls = parseSitemapUrls(sitemapXml);
  assert.equal(urls.length, 3);
  assert.ok(urls.includes("https://www.startech.com.bd/amd-ryzen-7-5700g-processor"));
  assert.equal(isSitemapIndex(sitemapXml), false);
});

test("isChallengePage detects a Cloudflare challenge", () => {
  assert.equal(isChallengePage("<html>One moment, please... Please wait while your request is being verified</html>"), true);
  assert.equal(isChallengePage("<html><h1>Product</h1></html>"), false);
});

// --- structured data ---
test("extractJsonLd reads Product.offers price + stock", () => {
  const ld = extractJsonLd(productHtml);
  assert.equal(ld.price, 22500);
  assert.equal(ld.stock, "in_stock");
  assert.equal(ld.brand, "AMD");
});

test("extractOpenGraph reads OG product price (regular on Star Tech)", () => {
  const og = extractOpenGraph(productHtml);
  assert.equal(og.price, 22500);
  assert.equal(og.stock, "in_stock");
});

test("extractLatestPriceSentence finds the visible offer, not the model number", () => {
  // The sentence contains "5700G" — a naive regex would return 5700.
  assert.equal(extractLatestPriceSentence(productHtml), 20600);
});

test("extractSpecTable groups rows by section heading", () => {
  const specs = extractSpecTable(productHtml);
  assert.equal(specs["Basic Information"].Cores, "8");
  assert.equal(specs["Basic Information"].Threads, "16");
  assert.equal(specs["Warranty Information"]["Manufacturing Warranty"], "03 Years (No Warranty for Fan or Cooler)");
});

test("extractDescription returns the Description section prose", () => {
  const d = extractDescription(productHtml);
  assert.ok(d.includes("8-core desktop processor"));
});

// --- full product parse (Star Tech fixture) ---
test("parseProduct (Star Tech fixture): offer 20,600, regular 22,500, specs, in stock", () => {
  const p = parseProduct(
    startech,
    productHtml,
    "https://www.startech.com.bd/amd-ryzen-7-5700g-processor"
  );
  assert.equal(p.retailer_id, "startech");
  assert.equal(p.price, 20600);
  assert.equal(p.regular_price, 22500);
  assert.equal(p.savings_pct, 8.4);
  assert.equal(p.stock, "in_stock");
  assert.equal(p.model_key, "amd ryzen 7 5700g");
  assert.equal(p.specs["Basic Information"].Cores, "8");
  assert.ok(p.image.includes("startech.com.bd"));
  assert.equal(p.conflicts.length, 0);
});

// --- registry ---
test("registry: 10 Tier-1 retailers, unique ids, sitemaps present", () => {
  assert.equal(RETAILERS.length, 10);
  const ids = RETAILERS.map((r) => r.id);
  assert.equal(new Set(ids).size, 10);
  for (const r of RETAILERS) {
    assert.ok(r.baseUrl.startsWith("https://"), r.id);
    assert.ok(Array.isArray(r.sitemapUrls) && r.sitemapUrls.length > 0, r.id);
    assert.ok(Number.isFinite(r.crawlDelayMs) && r.crawlDelayMs >= 1000, r.id);
  }
  // Ultra's 20-second crawl delay is respected in its config.
  assert.equal(RETAILERS.find((r) => r.id === "ultra").crawlDelayMs, 20000);
  // Degraded retailers are flagged.
  const degraded = RETAILERS.filter((r) => r.degraded).map((r) => r.id).sort();
  assert.deepEqual(degraded, ["pcbstore", "ryans", "selltech"]);
});
