/**
 * Speed Tech (Speed Technology) — https://www.speedtech.com.bd
 * Platform: OpenCart (strong evidence). No challenge observed — the easy one.
 * - Main components list: /component?page=N (page 19 fetched OK).
 *   Listing cards were NOT visible in a text fetch (SEO guide text only) —
 *   card markup is unverified, so discovery is sitemap-first.
 * - Sitemap: single flat file, 7,625 lines, product URL + image + title per
 *   entry. BEST discovery route for this site.
 * - Product page: Specification / Description tabs, grouped spec table,
 *   "latest price … is X" sentence. Price/stock via OG product meta.
 * - No old/regular price seen on product pages in text fetch — regular_price
 *   stays null unless raw HTML shows one.
 * Verified sample: Ryzen 7 5700G — 20,000 BDT, In Stock
 *   https://www.speedtech.com.bd/amd-ryzen-7-5700g-processor
 */
import { listProductUrls, parseProduct as parseProductShared, scrapeRetailer } from "./opencart.js";

export const config = {
  id: "speedtech",
  name: "Speed Tech",
  baseUrl: "https://www.speedtech.com.bd",
  platform: "OpenCart",
  sitemapUrls: ["https://www.speedtech.com.bd/sitemap.xml"],
  categoryUrls: ["https://www.speedtech.com.bd/component"],
  crawlDelayMs: 1500,
  ogIsRegularPrice: false,
  degraded: false,
  notes: "Listing-card markup unverified — use the sitemap for discovery. No regular price seen on product pages.",
  isProductUrl: (u) =>
    u.startsWith("https://www.speedtech.com.bd/") &&
    !u.includes("/component") &&
    !u.includes("?") &&
    !u.endsWith(".com.bd/"),
};

export { listProductUrls };

/**
 * parseProduct — shared OpenCart parser (src/scrapers/opencart.js).
 * Gallery: og:image + /image/catalog/... images on the page + JSON-LD images. (The sitemap also carries an <image:loc> per product — a future discovery-side fallback, not a page-gallery source.)
 * Returns the full normalised schema including images[] (all gallery
 * images, deduplicated, absolute URLs; [] when the page exposes none).
 */
export function parseProduct(config, html, url) {
  return parseProductShared(config, html, url);
}
export const scrape = (opts) => scrapeRetailer(config, opts);
export default config;
