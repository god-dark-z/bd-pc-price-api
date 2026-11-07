/**
 * Sell Tech BD — https://www.selltech.com.bd
 * Platform: OpenCart (strong evidence). HIGHEST-RISK site for plain fetch:
 * - Intermittent Cloudflare challenge ("One moment, please…") on listing
 *   and some product pages; another page opened normally in the same session.
 *   Expect a real browser / challenge handling for reliable coverage.
 * - Main components list: /Computer-Parts?page=N. Sub-categories exist.
 * - Listing card: name, spec bullets, price pair offer first / regular second,
 *   "Ex Tax:", sometimes "Save:", stock badge.
 * - Product page: Specification / Description / Video / Review tabs. Spec is
 *   a grouped table. Description has a "latest price … is X" line.
 *   Price/stock via JSON-LD Product.offers.
 * - Sitemap index: sitemaps/product-sitemap.xml — reliable URL source.
 * - Variant warning: same model at different prices + an "Unofficial" variant
 *   — dedupe by URL, never by name.
 * Verified sample: MSI PRO B650M-P — 16,900 BDT, InStock (JSON-LD).
 */
import { listProductUrls, parseProduct as parseProductShared, scrapeRetailer } from "./opencart.js";

export const config = {
  id: "selltech",
  name: "Sell Tech BD",
  baseUrl: "https://www.selltech.com.bd",
  platform: "OpenCart",
  sitemapUrls: ["https://www.selltech.com.bd/sitemaps/product-sitemap.xml"],
  categoryUrls: [
    "https://www.selltech.com.bd/Computer-Parts",
    "https://www.selltech.com.bd/AMD-Processor-BD",
  ],
  crawlDelayMs: 3000,
  ogIsRegularPrice: false,
  degraded: true,
  browserRequired: true,
  notes:
    "DEGRADED: intermittent Cloudflare challenge — highest-risk retailer for plain fetch. Use sitemap for URLs; expect browser-based fetching for full coverage.",
  isProductUrl: (u) =>
    u.startsWith("https://www.selltech.com.bd/") &&
    !u.includes("/Computer-Parts") &&
    !u.includes("/Processor/") &&
    !u.includes("/DESKTOP-PC/") &&
    !u.includes("?") &&
    !u.endsWith(".com.bd/"),
};

export { listProductUrls };

/**
 * parseProduct — shared OpenCart parser (src/scrapers/opencart.js).
 * Gallery: og:image + OpenCart thumbnail gallery (/image/cache/catalog/...-500x500.jpg) + JSON-LD images.
 * Returns the full normalised schema including images[] (all gallery
 * images, deduplicated, absolute URLs; [] when the page exposes none).
 */
export function parseProduct(config, html, url) {
  return parseProductShared(config, html, url);
}
export const scrape = (opts) => scrapeRetailer(config, opts);
export default config;
