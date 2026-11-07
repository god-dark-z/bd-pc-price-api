/**
 * Sys Computers Ltd — https://www.syscomputersltd.com
 * Platform: OpenCart (strong evidence: /image/cache/catalog/...,
 * index.php?route=product/search, "Ex Tax:" lines, JSON-LD Product +
 * Offer, og:type=product). Since 2002, BCS Computer City (IDB Bhaban),
 * Dhaka; #10 in Onix BD's 2026 top-10 list. Sells processors,
 * motherboards, RAM, SSDs, monitors, laptops and networking gear.
 * - Sitemap: index with 4 sub-sitemaps; product sitemap
 *   /sitemaps/product-sitemap.xml, 2,069 product URLs, lastmods up to
 *   2026-11-06 (fresh). Product-only sitemap, so no keyword filter is
 *   needed (same as the Tier-1 adapters).
 * - Product page: single visible price + JSON-LD Product.offers.price.
 *   No "latest price … is X" sentence; no regular price seen on the
 *   sampled page (regular_price stays null unless raw HTML shows one).
 * - robots.txt: User-agent * Allow / (only AI-training bots Disallow'ed).
 *   No Crawl-Delay, no challenge observed. Note: /pc-components returned
 *   HTTP 406 once, then 200 on retry (transient); sitemap-first discovery
 *   is unaffected. Category fallback: /pc-components?page=N (verified 200).
 * Verified sample: AMD Ryzen 7 5800X Processor — 24,000 BDT, In Stock
 *   https://www.syscomputersltd.com/amd-ryzen-7-5800x-processor
 */
import { listProductUrls, parseProduct as parseProductShared, scrapeRetailer } from "./opencart.js";
import { extractJsonLd } from "../lib/jsonld.js";
import { savingsPct } from "../lib/price.js";

export const config = {
  id: "syscomputers",
  name: "Sys Computers Ltd",
  baseUrl: "https://www.syscomputersltd.com",
  platform: "OpenCart",
  sitemapUrls: ["https://www.syscomputersltd.com/sitemap.xml"],
  categoryUrls: ["https://www.syscomputersltd.com/pc-components"],
  crawlDelayMs: 1500,
  ogIsRegularPrice: false,
  degraded: false,
  notes: "Product-only sitemap (2,069 URLs) — no keyword filter needed. No regular price seen on product pages. /pc-components returned a transient HTTP 406 once.",
  isProductUrl: (u) =>
    u.startsWith("https://www.syscomputersltd.com/") &&
    !u.includes("/sitemaps/") &&
    !u.includes("/pc-components") &&
    !u.includes("?") &&
    !u.endsWith(".com/"),
};

export { listProductUrls };

/**
 * parseProduct — shared OpenCart parser (src/scrapers/opencart.js) PLUS a
 * Sys-only price correction (see below).
 * Gallery: og:image + JSON-LD images + /image/cache/catalog/... images on
 * the page. Returns the full normalised schema including images[] (all
 * gallery images, deduplicated, absolute URLs; [] when the page exposes
 * none).
 *
 * SYS PRICE CORRECTION — verified 2026-11-08 on the live Intel Core
 * i5-10400 page: the page's prose says "The latest price of Intel Core
 * i5-10400 Processor in Bangladesh is 16,300৳", but the displayed price
 * block AND the page's own JSON-LD Offer price both say 14,500৳. The
 * "latest price" sentence is stale prose (the price block was updated,
 * the sentence was not), yet the shared parser trusts the sentence first —
 * so it published 16,300 with only a conflict logged. On every Sys page
 * checked, JSON-LD == the displayed price block (5800X: 24,000 == 24,000;
 * 10400: 14,500 == 14,500), so when the parsed price came from the
 * "latest price" sentence and JSON-LD disagrees, JSON-LD wins. The same
 * >50% rule as DRM also applies for a related-product-poisoned visible
 * price. Small disagreements from any other source keep the standard
 * Tier-1 behaviour (visible wins, conflict logged).
 */
const JSONLD_WINS_GAP = 0.5;

export function parseProduct(config, html, url) {
  const product = parseProductShared(config, html, url);
  if (product === null) return null;
  const jsonLdPrice = extractJsonLd(html)?.price ?? null;
  if (!jsonLdPrice) return product;
  const effective =
    product.stock === "out_of_stock" ? product.last_seen_price : product.price;
  if (effective === null || effective === jsonLdPrice) return product;
  const fromSentence = (product.price_sources || []).includes(
    "visible:latest-price-sentence"
  );
  const gap = Math.abs(effective - jsonLdPrice) / jsonLdPrice;
  if (!fromSentence && gap <= JSONLD_WINS_GAP) return product;
  const reason = fromSentence
    ? "the 'latest price' sentence is stale prose (displayed price block and JSON-LD agree)"
    : "the visible-price regex matched a related product's price";
  const corrected = {
    ...product,
    conflicts: [
      ...product.conflicts,
      `sys: visible price ${effective} disagrees with this page's own JSON-LD Offer price ${jsonLdPrice} — ${reason}, so JSON-LD wins`,
    ],
    price_sources: [...product.price_sources, "structured:jsonld (sys jsonld-wins)"],
  };
  if (product.stock === "out_of_stock") corrected.last_seen_price = jsonLdPrice;
  else corrected.price = jsonLdPrice;
  if (
    corrected.regular_price !== null &&
    (corrected.regular_price === jsonLdPrice || corrected.regular_price < jsonLdPrice)
  ) {
    corrected.regular_price = null;
  }
  corrected.savings_pct = savingsPct(corrected.price, corrected.regular_price);
  return corrected;
}

// Dispatch hook: scrapeRetailer (src/scrapers/opencart.js) and the admin
// live-check call config.parseProduct when the adapter defines one.
config.parseProduct = parseProduct;
export const scrape = (opts) => scrapeRetailer(config, opts);
export default config;
