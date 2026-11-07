/**
 * Phase-4 tests (offline, no network) — the three new retailers
 * (Dream Electronics BD, Sys Computers Ltd, AVA Technology BD).
 *
 * Covers the two parsing hazards found live on 2026-11-08:
 *  - DRM: related-products carousel renders BEFORE the main price in DOM
 *    order, so the shared parser's labelled-price regex takes a related
 *    product's price (MacBook page: AirPods Pro 16,000৳ for a 175,000৳
 *    laptop; Ryzen 5 5600 page: 17,800৳ for a 13,800৳ CPU). The DRM
 *    adapter corrects to the page's own JSON-LD Offer price.
 *  - SYS: the "latest price … is X" prose sentence is stale (i5-10400:
 *    sentence says 16,300৳, displayed block + JSON-LD say 14,500৳).
 *    The Sys adapter corrects to JSON-LD when the price came from that
 *    sentence.
 * Also covers the isProductUrl filters (DRM's slug keyword filter in
 * particular) and the config.parseProduct dispatch hook that
 * scrapeRetailer uses (see src/scrapers/opencart.js).
 *
 * Run: npm test   (node --test tests/phase4.test.mjs)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { parseProduct as parseDrm, config as drm } from "../src/scrapers/drm.js";
import { parseProduct as parseSys, config as syscomputers } from "../src/scrapers/syscomputers.js";
import { parseProduct as parseAva, config as ava } from "../src/scrapers/ava.js";
import { isPublishable } from "../src/lib/normalize.js";

function productHtml({ h1, jsonLdPrice, jsonLdAvailability = "http://schema.org/InStock", body }) {
  return `<!DOCTYPE html><html><head><title>${h1} Price in Bangladesh</title>
<meta property="og:type" content="product"/>
<meta property="og:title" content="${h1}"/>
<meta property="og:image" content="https://example.invalid/img.jpg"/>
<script type="application/ld+json">{"@context":"http://schema.org/","@type":"Product","name":"${h1}","image":"https://example.invalid/img.jpg","description":"Test product.","brand":{"@type":"Brand","name":"AMD"},"offers":{"@type":"Offer","priceCurrency":"BDT","price":"${jsonLdPrice}","availability":"${jsonLdAvailability}"}}</script>
</head><body><h1>${h1}</h1>${body}</body></html>`;
}

// --- DRM: related-product price BEFORE the main price (MacBook shape:
// related price LOWER than the JSON-LD price, so the reconciler also
// misassigns JSON-LD as the regular price) ---
const drmMacbookShape = productHtml({
  h1: "Apple Mac Book Pro 13 Inch M2 Space Gray Laptop with 512GB SSD",
  jsonLdPrice: 175000,
  body: `<div class="related">Apple AirPods Pro Price in Bangladesh Brand: Apple 16,000৳ Ex Tax:16,000৳</div>
<div class="price">Price: 175,000৳ Ex Tax: 175,000৳</div>
<h2>Specification</h2><table><tr><th>Model</th><td>MacBook Pro 13 M2</td></tr></table>`,
});

// --- DRM: related-product price HIGHER than JSON-LD (Ryzen 5 5600 shape) ---
const drmRyzenShape = productHtml({
  h1: "AMD Ryzen 5 5600 Processor",
  jsonLdPrice: 13800,
  body: `<div class="related">AMD Ryzen 5 5600X Processor Price in Bangladesh 17,800৳</div>
<div class="price">Price: 13,800৳ Regular Price: 14,500৳</div>`,
});

// --- DRM: out-of-stock page, poisoned visible price ---
const drmOutOfStock = productHtml({
  h1: "AMD Ryzen 5 5600 Processor",
  jsonLdPrice: 13800,
  jsonLdAvailability: "http://schema.org/OutOfStock",
  body: `<div class="related">AMD Ryzen 5 5600X Processor Price in Bangladesh 17,800৳</div>
<div class="price">Out of Stock</div>`,
});

// --- SYS: stale "latest price" sentence vs displayed block + JSON-LD ---
const sysStaleSentence = productHtml({
  h1: "Intel 10th Gen Core i5-10400 Processor",
  jsonLdPrice: 14500,
  body: `<div class="price">14,500৳ Ex Tax: 14,500৳</div>
<p>The latest price of Intel Core i5-10400 Processor in Bangladesh is 16,300৳. You can buy the Intel Core i5-10400 Processor at best price from our website.</p>`,
});

// --- AVA: clean offer/regular pair, no sentence, no poisoning ---
const avaClean = productHtml({
  h1: "AMD Ryzen 3 3200G Processor with Radeon RX Vega 8 Graphics",
  jsonLdPrice: 8900,
  body: `<div class="price">Price: 8,900৳ Regular Price: 9,500৳ Ex Tax: 8,900৳</div>
<h2>Specification</h2><table><tr><th>Cores</th><td>4</td></tr></table>`,
});

test("drm: related-product price (MacBook shape) is corrected to JSON-LD", () => {
  const p = parseDrm(drm, drmMacbookShape, "https://www.drm.com.bd/apple-macbook-pro-13-inch-m2-space-gray-price-in-bd-512gb-ssd");
  assert.ok(p, "expected a product, not a drop");
  assert.equal(p.price, 175000);
  assert.equal(p.regular_price, null); // JSON-LD was misassigned as regular — dropped
  assert.equal(p.stock, "in_stock");
  assert.ok(isPublishable(p));
  assert.ok(p.conflicts.some((c) => c.startsWith("drm: visible price 16000")));
  assert.ok(p.price_sources.includes("structured:jsonld (drm jsonld-wins)"));
});

test("drm: related-product price (Ryzen shape) is corrected to JSON-LD", () => {
  const p = parseDrm(drm, drmRyzenShape, "https://www.drm.com.bd/amd-ryzen-5-5600-processor-price-in-bd");
  assert.equal(p.price, 13800);
  assert.equal(p.stock, "in_stock");
  assert.ok(p.conflicts.some((c) => c.startsWith("drm: visible price 17800")));
});

test("drm: out-of-stock correction lands in last_seen_price, never price", () => {
  const p = parseDrm(drm, drmOutOfStock, "https://www.drm.com.bd/amd-ryzen-5-5600-processor-price-in-bd");
  assert.equal(p.stock, "out_of_stock");
  assert.equal(p.price, null);
  assert.equal(p.last_seen_price, 13800);
  assert.ok(isPublishable(p)); // out-of-stock products are publishable as such
});

test("syscomputers: stale 'latest price' sentence is corrected to JSON-LD", () => {
  const p = parseSys(syscomputers, sysStaleSentence, "https://www.syscomputersltd.com/Intel Core i5-10400");
  assert.equal(p.price, 14500);
  assert.equal(p.stock, "in_stock");
  assert.ok(p.conflicts.some((c) => c.startsWith("sys: visible price 16300")));
});

test("ava: clean pair parses with no correction", () => {
  const p = parseAva(ava, avaClean, "https://www.avatechnologybd.com/amd-ryzen-3-3200g-processor");
  assert.equal(p.price, 8900);
  assert.equal(p.stock, "in_stock");
  assert.deepEqual(p.conflicts, []);
  assert.ok(isPublishable(p));
});

// --- isProductUrl filters ---

test("drm isProductUrl: component slugs pass, appliances/category/bundles do not", () => {
  const ok = drm.isProductUrl;
  assert.equal(ok("https://www.drm.com.bd/amd-ryzen-5-5600-processor-price-in-bd"), true);
  assert.equal(ok("https://www.drm.com.bd/gigabyte-h610m-k-ddr4-micro-atx-motherboard-bangladesh"), true);
  assert.equal(ok("https://www.drm.com.bd/warrior-256gb-2.5-sata-ssd-bd"), true);
  assert.equal(ok("https://www.drm.com.bd/midea-mgfa-36cr-3-ton-floor-standing-ac"), false);
  assert.equal(ok("https://www.drm.com.bd/haier-h55p7-pro-55-inch-4k-uhd-qled-google-tv"), false);
  assert.equal(ok("https://www.drm.com.bd/processor-price-in-bd"), false); // bare category page
  assert.equal(ok("https://www.drm.com.bd/component-price-in-bangladesh"), false);
  assert.equal(ok("https://www.drm.com.bd/amd-ryzen-7-5700g-16gb-ram-256gb-ssd-drm-custom-pc"), false); // full-PC bundle
  assert.equal(ok("https://www.drm.com.bd/component-price-in-bangladesh?product_id=4479"), false);
  assert.equal(ok("https://www.drm.com.bd/blog/air-conditioner-tips-bangladesh"), false);
});

test("syscomputers isProductUrl: product slugs pass, sitemap/category/homepage do not", () => {
  const ok = syscomputers.isProductUrl;
  assert.equal(ok("https://www.syscomputersltd.com/amd-ryzen-7-5800x-processor"), true);
  assert.equal(ok("https://www.syscomputersltd.com/Intel-Core-i3-10105F-10th-Gen-Processor"), true);
  assert.equal(ok("https://www.syscomputersltd.com/sitemaps/product-sitemap.xml"), false);
  assert.equal(ok("https://www.syscomputersltd.com/pc-components"), false);
  assert.equal(ok("https://www.syscomputersltd.com/"), false);
  assert.equal(ok("https://www.syscomputersltd.com/pc-components?page=25"), false);
});

test("ava isProductUrl: product slugs pass, homepage/query URLs do not", () => {
  const ok = ava.isProductUrl;
  assert.equal(ok("https://www.avatechnologybd.com/amd-ryzen-3-3200g-processor"), true);
  assert.equal(ok("https://www.avatechnologybd.com/1stplayer-ar-55-armour-550w-80-plus-gold-power-supply"), true);
  assert.equal(ok("https://www.avatechnologybd.com/"), false);
  assert.equal(ok("https://www.avatechnologybd.com/index.php?route=product/category&path=288"), false);
});

// --- dispatch hook: the adapter parser must be reachable from the config,
// because scrapeRetailer / scrape-live call config.parseProduct when set ---
test("dispatch: drm and syscomputers expose their parseProduct on the config", () => {
  assert.equal(typeof drm.parseProduct, "function");
  assert.equal(drm.parseProduct, parseDrm);
  assert.equal(typeof syscomputers.parseProduct, "function");
  assert.equal(syscomputers.parseProduct, parseSys);
});
