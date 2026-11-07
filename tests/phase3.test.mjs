/**
 * Phase 3 offline tests — Tier 2 + Tier 3 adapters (2026-11-08).
 * Fixtures are minimal HTML built from the verified live page shapes
 * recorded in research/tier2-tier3.md (Nexus CS-Cart JSON-LD with
 * full-URL @type, Dolphin Odoo microdata, Flora ASP.NET price-new,
 * SmartBD Yoast priceSpecification, Computer Source OG-regular price).
 * Run: npm test   (node --test tests/)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isPublishable } from "../src/lib/normalize.js";
import { extractGalleryImages } from "../src/lib/jsonld.js";
import { parseProduct as parseProductShared } from "../src/scrapers/opencart.js";
import { config as nexus, parseProduct as parseNexus, normaliseSchemaOrgTypes } from "../src/scrapers/nexus.js";
import { config as dolphin, parseProduct as parseDolphin } from "../src/scrapers/dolphin.js";
import { config as flora, parseProduct as parseFlora } from "../src/scrapers/flora.js";
import { config as smartbd, parseProduct as parseSmartbd } from "../src/scrapers/smartbd.js";
import { config as computersource } from "../src/scrapers/computersource.js";
import { config as potakait } from "../src/scrapers/potakait.js";
import { config as creatus } from "../src/scrapers/creatus.js";
import { RETAILERS } from "../src/scrapers/index.js";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const nexusHtml = readFileSync(join(FIX, "nexus-product.html"), "utf8");
const dolphinHtml = readFileSync(join(FIX, "dolphin-product.html"), "utf8");
const floraHtml = readFileSync(join(FIX, "flora-product.html"), "utf8");
const smartbdHtml = readFileSync(join(FIX, "smartbd-product.html"), "utf8");

// --- Nexus (CS-Cart: schema.org-URL @type, offers array, "InStock") ---
test("nexus: normaliseSchemaOrgTypes rewrites full-URL @type to bare Product/Offer", () => {
  const raw = '{"@type":"http:\\/\\/schema.org\\/Product","offers":[{"@type":"http:\\/\\/schema.org\\/Offer","price":26200}]}';
  const out = normaliseSchemaOrgTypes(raw);
  assert.ok(out.includes('"@type":"Product"'));
  assert.ok(out.includes('"@type":"Offer"'));
  assert.ok(!out.includes("schema.org"));
  // Already-bare types and unrelated JSON pass through unchanged.
  assert.equal(normaliseSchemaOrgTypes('{"@type":"Product","price":1}'), '{"@type":"Product","price":1}');
});

test("nexus parse (fixture): 26,200 in stock, specs, gallery from /images/detailed/", () => {
  const p = parseNexus(nexus, nexusHtml, "https://www.nexus.com.bd/asus-tuf-gaming-b760m-plus-wifi-d4-ddr4-motherboard/");
  assert.equal(p.retailer_id, "nexus");
  assert.equal(p.price, 26200);
  assert.equal(p.regular_price, null);
  assert.equal(p.stock, "in_stock");
  assert.equal(p.brand, "ASUS");
  assert.equal(p.specs.Chipset, "Intel B760");
  assert.ok(p.image.includes("/images/detailed/"));
  assert.equal(p.conflicts.length, 0);
  assert.equal(isPublishable(p), true);
});

test("nexus parse: price 0 is no price (legacy OutOfStock product shape)", () => {
  const zero = nexusHtml
    .replace('"price":26200', '"price":0')
    .replace('"availability":"InStock"', '"availability":"OutOfStock"')
    .replaceAll("26,200", "0");
  const p = parseNexus(nexus, zero, "https://www.nexus.com.bd/asus-vivobook-x415ma/");
  assert.equal(p.price, null);
  assert.equal(p.stock, "out_of_stock");
  assert.equal(p.last_seen_price, null); // nothing to remember — 0 is not a price
});

test("nexus parse: empty CS-Cart brand object never leaks through (name-guess fills it)", () => {
  // Live B760M page (2026-11-08): brand is {"@type":"Thing","name":""}.
  // The old fallback (`brand?.name || brand`) returned the object itself,
  // which would serialize as an object in the API output. The fixed
  // extractor returns null for an empty brand, and normalizeProduct then
  // guesses the brand from the name ("ASUS TUF GAMING …" → "ASUS") — so
  // the final brand must be the STRING "ASUS", never an object.
  const noBrand = nexusHtml.replace(
    /"brand":\{[^}]*\}/,
    '"brand":{"@type":"Thing","name":""}'
  );
  const p = parseNexus(nexus, noBrand, "https://www.nexus.com.bd/asus-tuf-gaming-b760m-plus-wifi-d4-ddr4-motherboard/");
  assert.equal(typeof p.brand, "string");
  assert.equal(p.brand, "ASUS");
  assert.equal(p.price, 26200);
});

test("nexus + binarylogic + computersource + potakait discovery: category-first (sitemap leads with categories)", () => {
  // All four sitemaps lead with category/brand pages, so sitemap-first
  // runs burned all 153 attempts on categories and published 0 (live,
  // 2026-11-08). Category-first is the Star Tech Phase-1 pattern.
  const nx = RETAILERS.find((r) => r.id === "nexus");
  assert.equal(nx.discoveryMode, "category");
  assert.equal(nx.listingSelector, ".grid-list");
  assert.ok(nx.categoryUrls.length >= 1);
  const bl = RETAILERS.find((r) => r.id === "binarylogic");
  assert.equal(bl.discoveryMode, "category");
  assert.equal(bl.listingSelector, ".shop_wrapper");
  // robots.txt disallows /*?page= — only page 1 of each category.
  assert.equal(bl.categoryPages, 1);
  assert.ok(bl.categoryUrls.length >= 4);
  const cs = RETAILERS.find((r) => r.id === "computersource");
  assert.equal(cs.discoveryMode, "category");
  assert.equal(cs.listingSelector, ".product-listing");
  assert.equal(cs.categoryPages, 20);
  const pk = RETAILERS.find((r) => r.id === "potakait");
  assert.equal(pk.discoveryMode, "category");
  assert.equal(pk.listingSelector, ".product-listing");
  assert.equal(pk.categoryPages, 5);
  // Potaka's /components grid: 24 cards/page, ?page=2 is 24 different
  // products (verified live 2026-11-08).
  assert.deepEqual(pk.categoryUrls, ["https://potakait.com/components"]);
});

// --- Dolphin (Odoo microdata) ---
test("dolphin parse (fixture): 2,707.49 offer, 2,900 listPrice as regular, in stock", () => {
  const p = parseDolphin(dolphin, dolphinHtml, "https://www.dolphin.com.bd/shop/cas128-atx-mid-tower-casing-with-psu-d-tech-16063?category=7519");
  assert.equal(p.retailer_id, "dolphin");
  assert.equal(p.price, 2707); // parseAmount rounds microdata 2707.49 to whole taka
  assert.equal(p.regular_price, 2900);
  assert.equal(p.savings_pct, 6.7);
  assert.equal(p.stock, "in_stock");
  assert.equal(p.specs.Brand, "D-TECH");
  // Gallery is scoped to this product's template id (16063) — the
  // related product's 17100 image and the 128px thumbnail are excluded.
  assert.ok(p.images.every((u) => u.includes("/product.template/16063/")), p.images.join(", "));
  assert.ok(!p.images.some((u) => u.includes("image_128")));
  assert.equal(p.conflicts.length, 0);
  assert.equal(isPublishable(p), true);
});

test("dolphin parse: visible #out_of_stock_message -> out_of_stock, price to last_seen_price", () => {
  const oos = dolphinHtml.replace('id="out_of_stock_message" class="d-none align-items-center"', 'id="out_of_stock_message" class="align-items-center"');
  const p = parseDolphin(dolphin, oos, "https://www.dolphin.com.bd/shop/cas128-atx-mid-tower-casing-with-psu-d-tech-16063");
  assert.equal(p.stock, "out_of_stock");
  assert.equal(p.price, null);
  assert.equal(p.last_seen_price, 2707);
  assert.equal(isPublishable(p), true);
});

test("dolphin parse: visible #product_unavailable (Call for Price) -> no price, unknown stock, unpublishable", () => {
  const cfp = dolphinHtml.replace('id="product_unavailable" class="d-none"', 'id="product_unavailable" class=""');
  const p = parseDolphin(dolphin, cfp, "https://www.dolphin.com.bd/shop/some-call-for-price-item-99999");
  assert.equal(p.price, null);
  assert.equal(p.stock, "unknown");
  assert.equal(isPublishable(p), false);
});

test("dolphin parse: page without microdata offers is dropped (not a product page)", () => {
  const noOffers = dolphinHtml.replace(/<div itemprop="offers"[^]*?<\/div>\n/, "");
  const p = parseDolphin(dolphin, noOffers, "https://www.dolphin.com.bd/shop/category/desktop-desktop-component-7519");
  assert.equal(p, null);
});

// --- Flora (ASP.NET price-new / Sold Out ribbon / RegularImage) ---
test("flora parse (fixture): 17,000 sold out -> last_seen_price, RegularImage gallery only", () => {
  const p = parseFlora(flora, floraHtml, "http://www.floralimited.com/products/amd-ryzen-3-3100-desktop-processor-i7699.html");
  assert.equal(p.retailer_id, "flora");
  assert.equal(p.price, null);
  assert.equal(p.last_seen_price, 17000);
  assert.equal(p.stock, "out_of_stock");
  assert.equal(p.specs.Cores, "4");
  assert.ok(p.images.length >= 2);
  assert.ok(p.images.every((u) => u.includes("/RegularImage/")), p.images.join(", "));
  assert.equal(isPublishable(p), true);
});

test("flora parse: in-stock with .price-old -> regular price + savings", () => {
  const inStock = floraHtml
    .replace("Sold Out", "In Stock")
    .replace(
      '<span class="price-new"><span class="sym">৳&nbsp;</span>17,000</span>',
      '<span class="price-new"><span class="sym">৳&nbsp;</span>25,000</span><span class="price-old"><span class="sym">৳&nbsp;</span>28,000</span>'
    );
  const p = parseFlora(flora, inStock, "http://www.floralimited.com/products/amd-ryzen-5-5600-desktop-processor-i7700.html");
  assert.equal(p.price, 25000);
  assert.equal(p.regular_price, 28000);
  assert.equal(p.savings_pct, 10.7);
  assert.equal(p.stock, "in_stock");
});

test("flora parse: no .price-new (call-for-price) -> dropped", () => {
  const noPrice = floraHtml.replace(/<div class="price-wr">[^]*?<\/div>\n/, "");
  const p = parseFlora(flora, noPrice, "http://www.floralimited.com/products/some-server-part-i1234.html");
  assert.equal(p, null);
});

// --- SmartBD (Yoast priceSpecification + <del> post-pass) ---
test("smartbd parse (fixture): 29,500 from JSON-LD priceSpecification, in stock", () => {
  const p = parseSmartbd(smartbd, smartbdHtml, "https://smartbd.com/product/gigabyte-amd-b650m-a-elite-ax-ice-motherboard/");
  assert.equal(p.retailer_id, "smartbd");
  assert.equal(p.price, 29500);
  assert.equal(p.regular_price, null);
  assert.equal(p.stock, "in_stock");
  assert.equal(p.brand, "GIGABYTE");
  assert.equal(p.specs.Socket, "AM5");
  assert.equal(p.conflicts.length, 0);
  assert.equal(isPublishable(p), true);
});

test("smartbd parse: struck-through <del> becomes the regular price", () => {
  const sale = smartbdHtml.replace(
    '<div class="price">',
    '<div class="price"><del><span class="woocommerce-Price-amount amount"><span class="woocommerce-Price-currencySymbol">৳</span>32,000.00</span></del>'
  );
  const p = parseSmartbd(smartbd, sale, "https://smartbd.com/product/gigabyte-amd-b650m-a-elite-ax-ice-motherboard/");
  assert.equal(p.price, 29500);
  assert.equal(p.regular_price, 32000);
  assert.equal(p.savings_pct, 7.8);
});

// --- Creatus (shared parser, Journal3 price group + compare table) ---
// Live bug (2026-11-08): the AR-7 page prints offer 5,900৳ / old 6,800৳
// and a compare table "<td>Price</td><td><strike>6,800৳</strike> 5,900৳</td>".
// The old parser took the struck 6,800 as the offer (conflict: "jsonld
// price 5900 disagrees with visible price 6800"). Struck-through text is
// an old price, never the offer.
test("creatus parse (AR-7 shape): struck 6,800 is the regular price, offer is 5,900", () => {
  const html = `<!doctype html><html><head>
<title>1STPLAYER AR-7 ATX Gaming Case</title>
<meta property="og:type" content="product">
<meta property="og:title" content="1STPLAYER AR-7 ATX Gaming Case">
<meta property="og:image" content="https://www.creatus.com.bd/image/cache/catalog/1stplayer/1stplayer-ar-7-gaming-case-500x500.jpg">
<meta property="product:price:amount" content="5900.00">
<meta property="product:price:currency" content="BDT">
<meta property="product:availability" content="InStock">
<script type="application/ld+json">{"@type":"Product","name":"1STPLAYER AR-7 ATX Gaming Case","brand":{"@type":"Brand","name":"1STPLAYER"},"offers":{"@type":"Offer","price":5900,"priceCurrency":"BDT","availability":"https://schema.org/InStock"}}</script>
</head><body><h1>1STPLAYER AR-7 ATX Gaming Case</h1>
<div class="price-wrapper"><div class="price-group"><div class="product-price-new">5,900৳</div><div class="product-price-old">6,800৳</div></div><div class="product-tax">Ex Tax: 5,900৳</div></div>
<table class="compare"><tr class="compare-price"><td>Price</td><td><strike>6,800৳</strike> 5,900৳</td><td><strike>6,200৳</strike> 5,900৳</td></tr></table>
<p>Tempered glass side panel, ATX/M-ATX/ITX support, RGB-ready design.</p>
</body></html>`;
  const p = parseProductShared(creatus, html, "https://www.creatus.com.bd/1stplayer-ar-7-gaming-case");
  assert.equal(p.retailer_id, "creatus");
  assert.equal(p.price, 5900);
  assert.equal(p.regular_price, 6800);
  assert.equal(p.savings_pct, 13.2);
  assert.equal(p.stock, "in_stock");
  assert.equal(p.conflicts.length, 0);
  assert.equal(isPublishable(p), true);
});

test("creatus gallery (flat-folder store): related-product 60x60/120x120 thumbs are NOT in images[]", () => {
  // Real AR-7 page shape: Creatus stores a whole brand's products in
  // one flat folder (/catalog/1stplayer/), so the related B7-A SIR
  // thumbs share the primary image's directory — the directory check
  // alone admitted them (live, 2026-11-08: 4 related thumbs in a
  // 23-image gallery). Related thumbs are lazy-loaded data-src/data-srcset.
  const html = `<!doctype html><html><head>
<meta property="og:image" content="https://www.creatus.com.bd/image/cache/catalog/1stplayer/1stplayer-ar-7-gaming-case-600x315w.jpg">
</head><body>
<div class="product-image"><div class="swiper main-image">
<img src="https://www.creatus.com.bd/image/cache/catalog/1stplayer/1stplayer-ar-7-gaming-case-500x500.jpg">
<img src="https://www.creatus.com.bd/image/cache/catalog/1stplayer/1stplayer-ar-7-gaming-case-1-1000x1000.jpg">
<img src="https://www.creatus.com.bd/image/cache/catalog/1stplayer/1stplayer-ar-7-gaming-case-80x80.jpg">
</div></div>
<div class="related-products">
<img data-src="https://www.creatus.com.bd/image/cache/catalog/1stplayer/1stplayer-b7-a-sir-atx-gaming-case-60x60.jpg" data-srcset="https://www.creatus.com.bd/image/cache/catalog/1stplayer/1stplayer-b7-a-sir-atx-gaming-case-60x60.jpg 1x, https://www.creatus.com.bd/image/cache/catalog/1stplayer/1stplayer-b7-a-sir-atx-gaming-case-120x120.jpg 2x" width="60" height="60" alt="1stPlayer B7-A SIR ATX Gaming Case">
<img data-src="https://www.creatus.com.bd/image/cache/catalog/1stplayer/1stplayer-bs-2-gaming-casing-60x60.jpg" data-srcset="https://www.creatus.com.bd/image/cache/catalog/1stplayer/1stplayer-bs-2-gaming-casing-120x120.jpg 2x" width="60" height="60" alt="1STPLAYER BS-2 mATX Gaming Casing">
</div>
</body></html>`;
  const images = extractGalleryImages(html, "https://www.creatus.com.bd/1stplayer-ar-7-gaming-case");
  assert.ok(images.includes("https://www.creatus.com.bd/image/cache/catalog/1stplayer/1stplayer-ar-7-gaming-case-500x500.jpg"));
  assert.ok(images.includes("https://www.creatus.com.bd/image/cache/catalog/1stplayer/1stplayer-ar-7-gaming-case-1-1000x1000.jpg"));
  assert.ok(images.every((u) => !/b7-a-sir|bs-2/i.test(u)), "no related-product thumbnail may leak in");
  assert.ok(images.every((u) => !/60x60|120x120/.test(u)), "no tiny related thumbnail");
});

// --- Computer Source (shared parser, ogIsRegularPrice: true) ---
test("computersource parse (shared parser): OG 7,300 is regular, visible 7,100 is the offer", () => {
  const html = `<!doctype html><html><head>
<title>ADATA SU650 256GB 2.5-inch SATAIII SSD</title>
<meta property="og:type" content="product">
<meta property="og:title" content="ADATA SU650 256GB 2.5-inch SATAIII SSD">
<meta property="product:price:amount" content="7300.0000">
<meta property="product:price:currency" content="BDT">
<meta property="product:availability" content="InStock">
<script type="application/ld+json">{"@type":"Product","name":"ADATA SU650 256GB 2.5-inch SATAIII SSD","brand":{"@type":"Brand","name":"ADATA"},"offers":{"@type":"Offer","price":7300,"priceCurrency":"BDT","availability":"https://schema.org/InStock"}}</script>
</head><body><h1>ADATA SU650 256GB 2.5-inch SATAIII SSD</h1>
<p>The latest price of ADATA SU650 256GB 2.5-inch SATAIII SSD in Bangladesh is 7,100৳. Status: In Stock.</p>
</body></html>`;
  const p = parseProductShared(computersource, html, "https://computersource.com.bd/ADATA-SU650-256GB-2.5-inch-SATAIII-SSD");
  assert.equal(p.retailer_id, "computersource");
  assert.equal(p.price, 7100);
  assert.equal(p.regular_price, 7300);
  assert.equal(p.savings_pct, 2.7);
  assert.equal(p.stock, "in_stock");
});

// --- Potaka IT (shared parser, ogIsRegularPrice: true) ---
test("potakait parse (shared parser): OG 15,000 is regular, visible + JSON-LD 14,000 is the offer", () => {
  // Live Warframe 420 White page shape (verified 2026-11-08): visible
  // "latest price … is 14,000৳" + JSON-LD "price": 14000 vs OG
  // product:price:amount 15000.0000. The research file originally said
  // OG = offer (from the ASRock sample, where OG 32,000 was quoted
  // without cross-checking JSON-LD 29,650) — the discriminating pages
  // prove OG is the regular price.
  // Faithful detail: Potaka's real JSON-LD block is MALFORMED (a literal
  // newline inside a string), so JSON.parse fails and extractJsonLd
  // returns null — OG becomes the structured source. A valid inline
  // JSON-LD would take the structured slot instead and the test would
  // not exercise the production path.
  const html = `<!doctype html><html><head>
<title>Thermalright Frozen Warframe 420 White ARGB CPU Liquid Cooler</title>
<meta property="og:type" content="product">
<meta property="og:title" content="Thermalright Frozen Warframe 420 White ARGB CPU Liquid Cooler">
<meta property="product:price:amount" content="15000.0000">
<meta property="product:price:currency" content="BDT">
<meta property="product:availability" content="In Stock">
<script type="application/ld+json">{"@context":"https://schema.org/","@type":"Product","name":"Thermalright Frozen Warframe 420 White ARGB CPU Liquid Cooler","description":"Premium cooling
solution","offers":{"@type":"Offer","price":14000,"priceCurrency":"BDT","availability":"https://schema.org/InStock"}}</script>
</head><body><h1>Thermalright Frozen Warframe 420 White ARGB CPU Liquid Cooler</h1>
<p>The latest price of Thermalright Frozen Warframe 420 White ARGB in Bangladesh is 14,000৳. You can buy the Thermalright Frozen Warframe 420 White ARGB at best price in Bangladesh. Status: In Stock.</p>
</body></html>`;
  assert.equal(potakait.ogIsRegularPrice, true);
  const p = parseProductShared(potakait, html, "https://potakait.com/thermalright-frozen-warframe-420-white-argb-cpu-liquid-cooler");
  assert.equal(p.retailer_id, "potakait");
  assert.equal(p.price, 14000);
  assert.equal(p.regular_price, 15000);
  assert.equal(p.savings_pct, 6.7);
  assert.equal(p.stock, "in_stock");
  assert.equal(p.conflicts.length, 0);
});

// --- Phase 3 registry ---
test("registry (Phase 3): 27 retailers, Tier-1 order preserved, degraded list", () => {
  assert.equal(RETAILERS.length, 27);
  const ids = RETAILERS.map((r) => r.id);
  assert.equal(new Set(ids).size, 27);
  // Tier 1 first, in original order.
  assert.deepEqual(ids.slice(0, 10), [
    "startech", "ryans", "techland", "pcbstore", "ultra",
    "pchouse", "selltech", "speedtech", "indexit", "onix",
  ]);
  assert.deepEqual(ids.slice(10), [
    "computervillage", "skyland", "computermania", "nexus", "dolphin",
    "creatus", "potakait", "binarylogic", "computersource", "flora",
    "globalbrand", "ucc", "smartbd", "itsource",
    "drm", "syscomputers", "ava",
  ]);
  const degraded = RETAILERS.filter((r) => r.degraded).map((r) => r.id).sort();
  // Techland was flagged degraded by the concurrent Phase-1 fixes work
  // (2026-11-08) — it is a Tier-1 file this task does not touch; the
  // test pins the current registry state, whatever set it.
  assert.deepEqual(degraded, ["computermania", "computervillage", "pcbstore", "potakait", "ryans", "selltech", "techland"]);
  for (const r of RETAILERS) {
    assert.ok(r.id && r.name && r.baseUrl && r.platform, r.id);
    assert.ok(Number.isFinite(r.crawlDelayMs) && r.crawlDelayMs >= 1000, r.id);
    assert.equal(typeof r.isProductUrl, "function", r.id);
  }
  // Flora is the documented exception: HTTP base (its HTTPS times out
  // from this VM, 2026-11-08) and no sitemap (POST-grid discovery).
  const floraCfg = RETAILERS.find((r) => r.id === "flora");
  assert.equal(floraCfg.baseUrl, "http://www.floralimited.com");
  assert.deepEqual(floraCfg.sitemapUrls, []);
  // Every other retailer has an https base and at least one sitemap.
  for (const r of RETAILERS) {
    if (r.id === "flora") continue;
    assert.ok(r.baseUrl.startsWith("https://"), r.id);
    assert.ok(Array.isArray(r.sitemapUrls) && r.sitemapUrls.length > 0, r.id);
  }
  // Custom-parse adapters attach their overrides to the config so the
  // engine dispatch in scrapeRetailer actually runs them.
  for (const id of ["nexus", "dolphin", "flora", "smartbd"]) {
    assert.equal(typeof RETAILERS.find((r) => r.id === id).parseProduct, "function", id);
  }
  for (const id of ["dolphin", "flora"]) {
    assert.equal(typeof RETAILERS.find((r) => r.id === id).listProductUrls, "function", id);
  }
});
