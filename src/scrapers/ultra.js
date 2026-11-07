/**
 * Ultra Technology — https://www.ultratech.com.bd
 * Platform: OpenCart (strong evidence). No challenge observed.
 * - All-products listing: /products?page=N (pages seen up to 329).
 * - Listing card: discount badge, offer first, old second, "Ex Tax:" line.
 * - TRAP: first items on page 1 show 0৳ — "call for price". Treat 0 as no price.
 * - Product page: "Summary" block with inline specs; price/stock via
 *   JSON-LD Product.offers. No separate spec table seen in text fetch.
 * - robots.txt: Crawl-Delay: 20 — 20 SECONDS between requests. Respected here.
 * - Sitemap: index.php?route=feed/sitemaps (contents unverified — timed out once).
 * Verified sample: GearUP K450 webcam — 3,900; T-Wolf V1 mouse — 200 (was 220).
 */
import { listProductUrls, parseProduct as parseProductShared, scrapeRetailer } from "./opencart.js";

export const config = {
  id: "ultra",
  name: "Ultra Technology",
  baseUrl: "https://www.ultratech.com.bd",
  platform: "OpenCart",
  sitemapUrls: ["https://www.ultratech.com.bd/index.php?route=feed/sitemaps"],
  categoryUrls: [
    "https://www.ultratech.com.bd/products",
    "https://www.ultratech.com.bd/pc-components/power-supply",
  ],
  crawlDelayMs: 20000,
  ogIsRegularPrice: false,
  degraded: false,
  notes: "Crawl-Delay: 20 (robots.txt) — this retailer crawls very slowly by design. 0৳ = call-for-price, not a deal. LIVE 2026-11-08 (VM): sitemap index.php?route=feed/sitemaps works (13,313 URLs; research timeout was transient), 5/5 products parsed, 0 blocked; 5600GT verified live at 18,000 BDT (regular 18,500).",
  isProductUrl: (u) =>
    u.startsWith("https://www.ultratech.com.bd/") &&
    !u.includes("/products") &&
    !u.includes("/pc-components/") &&
    !u.includes("?") &&
    !u.endsWith(".com.bd/"),
};

export { listProductUrls };

/**
 * parseProduct — shared OpenCart parser (src/scrapers/opencart.js).
 * Gallery: og:image + JSON-LD images + OpenCart thumbnail-gallery images on the page (exact image paths unverified — the extractor takes whatever the page exposes, never invents one).
 * Returns the full normalised schema including images[] (all gallery
 * images, deduplicated, absolute URLs; [] when the page exposes none).
 */
export function parseProduct(config, html, url) {
  return parseProductShared(config, html, url);
}
export const scrape = (opts) => scrapeRetailer(config, opts);
export default config;
