/**
 * Flora Limited — http://www.floralimited.com
 * Platform: ASP.NET MVC (verified: /bundles/js, /Content/css?v=…,
 * /brandcategory/_breadcrumbinfo AJAX; no JSON-LD, no OG product meta).
 * CUSTOM DISCOVERY + PARSE:
 * - The category page HTML contains NO products or prices — the grid
 *   is loaded by POST /product/_gridclient with form params
 *   (Cataid, BrandId, StokStatus, FilterID, SpecFilterIDs, SortOrder)
 *   into #loadProduct. One POST returns the whole brand/category set
 *   (no pagination parameter found). Brand/category ids come from the
 *   selects on the brand/category page (<option selected>): AMD/Processor
 *   59/65, INTEL/Processor 18/65, HP/Desktop 3/2, HP/Internal Hard Disk
 *   3/67. (On /brands/amd/motherboard the CategoryID select lists only
 *   Processor — that pair is NOT used.)
 * - Product page: <span class="price-new">৳ 17,000</span> (single
 *   price; .price-old when discounted), "Availability: Sold Out" text in
 *   .product-attr-text (the "Sold Out" ribbon is on the listing grid,
 *   NOT on the product page — ribbon-based stock detection was wrong and
 *   published sold-out CPUs as in_stock; fixed 2026-11-08), images under
 *   /Files/Products/<Brand>/RegularImage/…, specs in an HTML table.
 * - TLS NOTE (verified 2026-11-08): https://www.floralimited.com/
 *   times out from this VM (curl 000, 30 s) while http:// returns 200
 *   consistently, so the base URL is http://. If the site's TLS works
 *   from Netlify, switching the base to https is a one-line change.
 * - Catalogue caveat: stock is old (Ryzen 3000-series, many sold out)
 *   and corporate/desktop-heavy — still real, priced products.
 * Verified sample: AMD Ryzen 3 3100 Desktop Processor — 17,000 BDT,
 * SOLD OUT (price goes to last_seen_price)
 *   http://www.floralimited.com/products/amd-ryzen-3-3100-desktop-processor-i7699.html
 */
import * as cheerio from "cheerio";
import { fetchText, postForm } from "../lib/http.js";
import { parseAmount } from "../lib/price.js";
import { normalizeProduct, dedupeImages } from "../lib/normalize.js";
import { extractSpecTable, extractDescription, absUrl } from "../lib/jsonld.js";
import { scrapeRetailer } from "./opencart.js";

/** Verified (brand, category) id pairs for the _gridclient POST. */
export const GRID_PAIRS = [
  { brandId: "59", cataid: "65", label: "AMD / Processor" },
  { brandId: "18", cataid: "65", label: "INTEL / Processor" },
  { brandId: "3", cataid: "2", label: "HP / Desktop" },
  { brandId: "3", cataid: "67", label: "HP / Internal Hard Disk" },
];

export const config = {
  id: "flora",
  name: "Flora Limited",
  baseUrl: "http://www.floralimited.com",
  platform: "ASP.NET MVC",
  sitemapUrls: [],
  categoryUrls: [],
  crawlDelayMs: 3000,
  ogIsRegularPrice: false,
  degraded: false,
  notes: "Custom discovery: POST /product/_gridclient per verified (BrandId, Cataid) pair — the category HTML has no products/prices. HTTP base URL: HTTPS times out from this VM (2026-11-08). Slow site (3 s delay).",
  isProductUrl: (u) =>
    u.startsWith("http://www.floralimited.com/products/") && u.endsWith(".html"),
};

/** Discovery: POST the grid endpoint once per (brand, category) pair and collect /products/<slug>-i<id>.html links. */
export async function listProductUrls(config) {
  const found = new Set();
  const discoveryErrors = [];
  for (const pair of GRID_PAIRS) {
    const res = await postForm(`${config.baseUrl}/product/_gridclient`, {
      Cataid: pair.cataid,
      BrandId: pair.brandId,
      StokStatus: "",
      FilterID: "",
      SpecFilterIDs: "",
      SortOrder: "",
    }, { delayMs: config.crawlDelayMs, timeoutMs: 60000 });
    if (!res.ok) {
      discoveryErrors.push({ url: `${config.baseUrl}/product/_gridclient (${pair.label})`, error: res.error || `HTTP ${res.status}`, status: res.status ?? null, blocked: !!res.blocked });
      continue;
    }
    const $ = cheerio.load(res.html);
    let added = 0;
    $("a[href]").each((_, a) => {
      const href = $(a).attr("href");
      if (!href) return;
      const u = absUrl(config.baseUrl, href);
      if (u && config.isProductUrl(u) && !found.has(u)) {
        found.add(u);
        added++;
      }
    });
    if (added === 0) {
      discoveryErrors.push({ url: `${config.baseUrl}/product/_gridclient (${pair.label})`, error: "grid POST OK but yielded 0 product URLs", status: res.status, blocked: false });
    }
  }
  return { urls: [...found], discovery_errors: discoveryErrors };
}

/**
 * Parse one Flora product page. Returns null when the page has no h1
 * or no .price-new (not a priced product page) — dropped, never published.
 */
export function parseProduct(config, html, url) {
  const $ = cheerio.load(html || "");
  const name = $("h1").first().text().trim() || null;
  if (!name) return null;
  const priceText = $(".price-new").first().text().trim();
  const price = parseAmount(priceText);
  if (price === null) return null; // no price (call-for-price) — not publishable
  const oldText = $(".price-old").first().text().trim();
  const oldPrice = parseAmount(oldText);
  const regularPrice = oldPrice && oldPrice > price ? oldPrice : null;

  // Stock: the product page prints "Availability: Sold Out" (or "In
  // Stock") once, in .product-attr-text > span.available. (The "Sold Out"
  // ribbon lives on the LISTING grid, NOT on the product page — the
  // first .ribbon on the page does not exist, so ribbon-based detection
  // always said in_stock; live bug 2026-11-08: three sold-out Ryzen 3
  // CPUs were published as in_stock.) Fall back to the body-text
  // "Availability:" label when the attr block is absent.
  const attrText = $(".product-attr-text").first().text().replace(/\s+/g, " ").trim();
  let stock = "unknown";
  if (attrText) {
    if (/Sold\s*Out/i.test(attrText)) stock = "out_of_stock";
    else if (/In\s*Stock/i.test(attrText)) stock = "in_stock";
  } else {
    const bodyText = $("body").text().replace(/\s+/g, " ").trim();
    if (/Availability:\s*Sold\s*Out/i.test(bodyText)) stock = "out_of_stock";
    else if (/Availability:\s*In\s*Stock/i.test(bodyText)) stock = "in_stock";
  }

  // Gallery: this product's RegularImage photos only (ThumbImage is
  // the same photo smaller; ListImage is the listing thumbnail).
  const images = [];
  $("img").each((_, img) => {
    const src = $(img).attr("src") || $(img).attr("data-src") || "";
    if (!src.includes("/RegularImage/")) return;
    const abs = absUrl(url, src);
    if (abs && !images.includes(abs)) images.push(abs);
  });
  const gallery = dedupeImages(images);

  const description = extractDescription(html);
  const specs = extractSpecTable(html);

  return normalizeProduct(
    { id: config.id, name: config.name },
    {
      name,
      url,
      image: gallery[0] || null,
      images: gallery,
      price,
      regular_price: regularPrice,
      stock,
      description,
      specs,
      brand: null,
      category: null,
      price_sources: ["visible:price-new"],
      conflicts: [],
    }
  );
}

// Attach the overrides so the engine dispatch in scrapeRetailer (and
// scrape-live) actually uses the Flora discovery/parser.
config.listProductUrls = listProductUrls;
config.parseProduct = parseProduct;

export const scrape = (opts) => scrapeRetailer(config, opts);
export default config;
