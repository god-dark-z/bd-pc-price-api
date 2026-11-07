/**
 * Creatus Computer — https://www.creatus.com.bd
 * Platform: OpenCart (verified: catalog/view/theme/journal3 assets,
 * route=product/product in page JS, robots disallows /*?route=checkout/,
 * /*?sort, /*?limit; listing cards offer-first + Ex Tax + Save).
 * - Sitemap index: sitemaps/product-sitemap.xml (plus category /
 *   manufacturer / information). Shared discovery follows the product
 *   sub-sitemap. No Cloudflare challenge observed.
 * - Product page: JSON-LD Product.offers gives the OFFER price
 *   (47,500 on the Gigabyte RTX 3050 page matches the listing pair
 *   47,500/52,000). Watch for typo'd listing pairs (one snippet showed
 *   "669,000৳ 68,000৳" for an RTX 5060) — the >80%/outlier guards cover it.
 * Verified sample: GIGABYTE GeForce RTX 3050 WINDFORCE OC V2 8G GDDR6
 * Graphics Card — 47,500 BDT, InStock
 *   https://www.creatus.com.bd/gigabyte-geforce-rtxtm-3050-windforce-oc-v2-8g-gpu
 */
import { listProductUrls, parseProduct as parseProductShared, scrapeRetailer } from "./opencart.js";

export const config = {
  id: "creatus",
  name: "Creatus Computer",
  baseUrl: "https://www.creatus.com.bd",
  platform: "OpenCart",
  sitemapUrls: ["https://www.creatus.com.bd/sitemap.xml"],
  categoryUrls: ["https://www.creatus.com.bd/components/graphics-card"],
  crawlDelayMs: 1500,
  ogIsRegularPrice: false,
  degraded: false,
  notes: "Listing pages occasionally show typo'd prices (e.g. 669,000৳ vs 68,000৳) — price guards apply. Category pages live under /components/.",
  isProductUrl: (u) =>
    u.startsWith("https://www.creatus.com.bd/") &&
    !u.includes("/components/") &&
    !u.includes("/index.php") &&
    !u.includes("?") &&
    !u.endsWith(".com.bd/"),
};

export { listProductUrls };

/**
 * parseProduct — shared OpenCart parser (src/scrapers/opencart.js).
 * Gallery: og:image + JSON-LD images + /image/cache/catalog/... images.
 */
export function parseProduct(config, html, url) {
  return parseProductShared(config, html, url);
}
export const scrape = (opts) => scrapeRetailer(config, opts);
export default config;
