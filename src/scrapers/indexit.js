/**
 * Index IT — https://www.indexit.com.bd
 * Platform: OpenCart. No challenge observed (robots hints at Cloudflare
 * via /cdn-cgi/, unconfirmed).
 * - Main listing: /component?page=N, ~16/page, verified pages 2,3,6,7,8.
 * - Listing card: image, name/link, spec bullets, price single or pair
 *   (offer first, old second), "Save: X ৳ (-Y%)". Bottom SEO price table
 *   is a cross-check only (offer price, no old price).
 * - Product page: Specification / Description tabs, grouped spec table,
 *   "latest price … is X" block. Stock via OG availability.
 * - Sitemap: single flat file, ~71.6k lines, whole catalogue (not components
 *   only) — filter by category/listing.
 * - Robots: clean ?page=N only. No sort/limit/search crawling.
 * Verified sample: Ryzen 9 7950X — 50,500 BDT, In Stock
 *   https://www.indexit.com.bd/amd-ryzen-9-7950x-processor
 */
import { listProductUrls, parseProduct as parseProductShared, scrapeRetailer } from "./opencart.js";

export const config = {
  id: "indexit",
  name: "Index IT",
  baseUrl: "https://www.indexit.com.bd",
  platform: "OpenCart",
  sitemapUrls: ["https://www.indexit.com.bd/sitemap.xml"],
  categoryUrls: ["https://www.indexit.com.bd/component"],
  crawlDelayMs: 1500,
  ogIsRegularPrice: false,
  degraded: false,
  notes: "Sitemap covers the whole catalogue — filter to components. Clean ?page=N only.",
  isProductUrl: (u) =>
    u.startsWith("https://www.indexit.com.bd/") &&
    !u.includes("/component") &&
    !u.includes("?") &&
    !u.endsWith(".com.bd/"),
};

export { listProductUrls };

/**
 * parseProduct — shared OpenCart parser (src/scrapers/opencart.js).
 * Gallery: og:image + OpenCart thumbnail gallery (/image/cache/catalog/...-228x228.jpg) + JSON-LD images.
 * Returns the full normalised schema including images[] (all gallery
 * images, deduplicated, absolute URLs; [] when the page exposes none).
 */
export function parseProduct(config, html, url) {
  return parseProductShared(config, html, url);
}
export const scrape = (opts) => scrapeRetailer(config, opts);
export default config;
