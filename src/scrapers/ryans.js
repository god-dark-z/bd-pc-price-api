/**
 * Ryans Computers — canonical domain RYANS.COM (ryanscomputers.com is an alias).
 * Platform: unverified / custom cart. Cloudflare present.
 * DEGRADED — do not trust plain-fetch results for this retailer:
 * - Listing pages are likely JS-rendered: a text fetch returned product
 *   names/images only, NO prices and NO product links.
 * - Sitemap and pagination are UNVERIFIED (sitemap fetch was rate-limited).
 * - Out-of-stock products show price 0 — treated as no-price, never a deal.
 * - Duplicate SKUs: boxed 5700G (21,900) vs tray/AM4 listing — dedupe by URL.
 * This adapter still works for product pages (JSON-LD/OG + spec table),
 * but a headless browser is probably required for full coverage.
 * Verified sample: Ryzen 7 5700G 8 Core — 21,900 BDT, In Stock
 *   https://www.ryans.com/amd-ryzen-7-5700g-8-core-desktop-processor
 */
import { listProductUrls, parseProduct as parseProductShared, scrapeRetailer } from "./opencart.js";

export const config = {
  id: "ryans",
  name: "Ryans Computers",
  baseUrl: "https://www.ryans.com",
  platform: "Custom cart (unverified)",
  sitemapUrls: ["https://www.ryans.com/sitemap.xml"],
  categoryUrls: ["https://www.ryans.com/category/computer-desktop-component"],
  crawlDelayMs: 2000,
  ogIsRegularPrice: false,
  degraded: true,
  browserRequired: true,
  notes:
    "DEGRADED: Cloudflare + likely JS-rendered listing prices. Product-page parsing works; full listing crawl probably needs a headless browser. Sitemap/pagination unverified.",
  isProductUrl: (u) =>
    u.startsWith("https://www.ryans.com/") &&
    !u.includes("/category/") &&
    !u.includes("?") &&
    !u.endsWith(".com/"),
};

export { listProductUrls };

/**
 * parseProduct — shared OpenCart parser (src/scrapers/opencart.js).
 * Gallery: og:image + JSON-LD images + /storage/products/small/*.webp images exposed on the page.
 * Returns the full normalised schema including images[] (all gallery
 * images, deduplicated, absolute URLs; [] when the page exposes none).
 */
export function parseProduct(config, html, url) {
  return parseProductShared(config, html, url);
}
export const scrape = (opts) => scrapeRetailer(config, opts);
export default config;
