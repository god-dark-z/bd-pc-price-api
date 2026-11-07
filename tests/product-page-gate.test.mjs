/**
 * Product-page gate + gallery-scope + name-suffix tests — offline, no network.
 * Covers the two bugs found in the 2026-11-07 live run:
 *  BUG 1 — sitemap discovery pulled category/guide pages in as "products"
 *    (Star Tech /lifestyle became "Lifestyle Products Price in Bangladesh"
 *    at ৳45; /blood-pressure-monitor became an out-of-stock "product").
 *    Fix: parseProduct returns null unless the page carries structured
 *    product evidence (JSON-LD Product with offers, og:type=product, or
 *    og product:price:amount).
 *  BUG 2 — images[] included related-products thumbnails (i7-10700,
 *    Ryzen 7 5800X, Ryzen 5 5600G 80x80) that are not this product's gallery.
 *    Fix: images[] keeps only structured images, gallery-container images,
 *    and images sharing the primary image's directory.
 *  MINOR — name/model_key carried the "Price in Bangladesh" SEO suffix.
 *    Fix: cleanProductName strips it in normalisation (and modelKey).
 * Run: npm test   (node --test tests/)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isProductPage, extractGalleryImages } from "../src/lib/jsonld.js";
import { modelKey, normalizeProduct } from "../src/lib/normalize.js";
import { parseProduct } from "../src/scrapers/opencart.js";
import { parseProduct as parsePcbProduct, config as pcbstore } from "../src/scrapers/pcbstore.js";
import { config as startech } from "../src/scrapers/startech.js";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const categoryHtml = readFileSync(join(FIX, "category-page.html"), "utf8");
const productHtml = readFileSync(join(FIX, "opencart-product.html"), "utf8");
const relatedHtml = readFileSync(join(FIX, "related-gallery.html"), "utf8");

// --- BUG 1: the structured-data gate ---
test("gate: a category page (no JSON-LD Product, no og:type=product, no og price) is dropped", () => {
  assert.equal(isProductPage(categoryHtml).isProduct, false);
  assert.equal(
    parseProduct(startech, categoryHtml, "https://www.startech.com.bd/lifestyle"),
    null,
    "the /lifestyle category page must NOT become a product"
  );
  assert.equal(
    parseProduct(startech, categoryHtml, "https://www.startech.com.bd/blood-pressure-monitor"),
    null,
    "the out-of-stock card on a category page must NOT become a product either"
  );
});

test("gate: the PCB Store wrapper also drops a non-product page (null propagates)", () => {
  assert.equal(
    parsePcbProduct(pcbstore, categoryHtml, "https://pcbstore.com.bd/pc-components/casing"),
    null
  );
});

test("gate: a real product page still parses (JSON-LD + OG evidence)", () => {
  assert.equal(isProductPage(productHtml).isProduct, true);
  const p = parseProduct(startech, productHtml, "https://www.startech.com.bd/amd-ryzen-7-5700g-processor");
  assert.notEqual(p, null);
  assert.equal(p.price, 20600);
  assert.equal(p.regular_price, 22500);
  assert.equal(p.savings_pct, 8.4);
  assert.equal(p.stock, "in_stock");
});

test("gate: OG-only evidence is enough (og:type=product + product:price:amount, no JSON-LD)", () => {
  const html = `<!doctype html><html><head>
    <title>Test Widget Price in Bangladesh</title>
    <meta property="og:title" content="Test Widget">
    <meta property="og:type" content="product">
    <meta property="og:image" content="https://example.com/img/widget-500x500.jpg">
    <meta property="product:price:amount" content="1500.00">
    <meta property="product:price:currency" content="BDT">
    <meta property="product:availability" content="InStock">
    </head><body><h1>Test Widget</h1></body></html>`;
  assert.equal(isProductPage(html).isProduct, true);
  const p = parseProduct(startech, html, "https://www.startech.com.bd/test-widget");
  assert.notEqual(p, null);
  assert.equal(p.price, 1500);
});

test("gate: JSON-LD-only evidence is enough (no OG product meta)", () => {
  const html = `<!doctype html><html><head>
    <title>Test Gadget</title>
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Test Gadget","offers":{"@type":"Offer","price":"2500","priceCurrency":"BDT","availability":"https://schema.org/InStock"}}</script>
    </head><body><h1>Test Gadget</h1></body></html>`;
  assert.equal(isProductPage(html).isProduct, true);
  const p = parseProduct(startech, html, "https://www.startech.com.bd/test-gadget");
  assert.notEqual(p, null);
  assert.equal(p.price, 2500);
});

test("gate: a page with price-like text but no structured product data is dropped", () => {
  const html = `<!doctype html><html><head><title>Some Guide</title>
    <meta property="og:type" content="website">
    </head><body><h1>Buying Guide</h1><p>Best deals from 45৳ to 99,000৳. Out of Stock on some items.</p></body></html>`;
  assert.equal(isProductPage(html).isProduct, false);
  assert.equal(parseProduct(startech, html, "https://www.startech.com.bd/some-guide"), null);
});

// --- BUG 2: gallery scope ---
test("gallery: related-products thumbnails are NOT in images[]", () => {
  const images = extractGalleryImages(relatedHtml, "https://www.startech.com.bd/amd-ryzen-7-5700g-processor");
  assert.equal(images.length, 4, images.join("\n"));
  assert.ok(images.includes("https://www.startech.com.bd/image/cache/catalog/processor/amd/ryzen-7-5700ge/ryzen-7-5700g-1200x630.webp"), "og:image (primary) is kept");
  assert.ok(images.includes("https://www.startech.com.bd/image/cache/catalog/processor/amd/ryzen-7-5700ge/ryzen-7-5700g-500x500.webp"));
  assert.ok(images.includes("https://www.startech.com.bd/image/cache/catalog/processor/amd/ryzen-7-5700ge/ryzen-7-5700g-2-1000x1000.jpg"));
  assert.ok(images.includes("https://www.startech.com.bd/image/cache/catalog/processor/amd/ryzen-7-5700ge/ryzen-7-5700g-2-500x500.jpg"));
  assert.ok(images.every((u) => !/i7-10700|5800x|5600g/i.test(u)), "no related-product thumbnail may leak in");
  assert.ok(images.every((u) => !/80x80/.test(u)), "no 80x80 related thumbnail");
  assert.ok(images.every((u) => !/logo|ads\//i.test(u)), "no logo/ad image");
});

test("gallery: parseProduct on the related-products page keeps only the product's own images", () => {
  const p = parseProduct(startech, relatedHtml, "https://www.startech.com.bd/amd-ryzen-7-5700g-processor");
  assert.notEqual(p, null);
  assert.equal(p.images.length, 4);
  assert.ok(p.images.every((u) => u.includes("/ryzen-7-5700ge/")));
  assert.equal(p.price, 20600);
  assert.equal(p.stock, "in_stock");
});

// --- MINOR: "Price in Bangladesh" suffix ---
test("name: the 'Price in Bangladesh / BD' SEO suffix is stripped from name and model_key", () => {
  assert.equal(modelKey("AMD Ryzen 7 5700G Processor Price in Bangladesh"), "amd ryzen 7 5700g");
  assert.equal(modelKey("AMD Ryzen 7 5700G Processor Price in BD"), "amd ryzen 7 5700g");
  assert.equal(modelKey("Blood Pressure Monitor Price in Bangladesh 2026"), "blood pressure monitor");
  const p = normalizeProduct(
    { id: "startech", name: "Star Tech" },
    {
      name: "AMD Ryzen 7 5700G Processor Price in Bangladesh",
      url: "https://www.startech.com.bd/amd-ryzen-7-5700g-processor",
      price: 20600,
      stock: "in_stock",
      conflicts: [],
    }
  );
  assert.equal(p.name, "AMD Ryzen 7 5700G Processor");
  assert.equal(p.model_key, "amd ryzen 7 5700g");
});

test("name: parseProduct prefers the clean h1 and strips the og:title suffix", () => {
  const html = `<!doctype html><html><head>
    <title>AMD Ryzen 7 5700G Processor Price in Bangladesh</title>
    <meta property="og:title" content="AMD Ryzen 7 5700G Processor Price in Bangladesh">
    <meta property="og:type" content="product">
    <meta property="product:price:amount" content="22500.00">
    <meta property="product:availability" content="InStock">
    </head><body>
    <h1>AMD Ryzen 7 5700G Processor with Radeon Graphics</h1>
    <p>The latest price of AMD Ryzen 7 5700G Processor in Bangladesh is 20,600৳.</p>
    </body></html>`;
  const p = parseProduct(startech, html, "https://www.startech.com.bd/amd-ryzen-7-5700g-processor");
  assert.notEqual(p, null);
  assert.equal(p.name, "AMD Ryzen 7 5700G Processor with Radeon Graphics");
  assert.equal(p.model_key, "amd ryzen 7 5700g");
  assert.equal(p.price, 20600);
  assert.equal(p.regular_price, 22500);
});
