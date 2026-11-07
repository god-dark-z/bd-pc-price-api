/**
 * Onix BD — https://www.onixbd.com
 * Platform: OpenCart. No challenge observed on successful fetches.
 * - Main listing: /component, ?page=N inferred from /component-combo?page=3
 *   (direct /component?page=2 verification was blocked by a fetch-service
 *   429, not by the site — re-check live).
 * - Listing card (search-index snippets): name/link, spec bullets, price
 *   single or pair (offer / old), "Save: X৳". Page size varies by category
 *   (15–16/page) — do not hard-code it.
 * - EXCLUDE /component-combo (bundles only, 66 combos) from single-product scraping.
 * - Product page (second-hand, from search snippets — direct fetch failed):
 *   explicit IN STOCK label, price pair, grouped spec table, OG product meta.
 * - Sitemap: single flat file, ~23.3k lines, whole catalogue.
 * Verified sample: Ryzen 5 PRO 5650GE — 17,000 (old 18,000), In Stock
 *   https://www.onixbd.com/amd-ryzen-5-pro-5650ge-processor
 */
import { listProductUrls, parseProduct as parseProductShared, scrapeRetailer } from "./opencart.js";

export const config = {
  id: "onix",
  name: "Onix BD",
  baseUrl: "https://www.onixbd.com",
  platform: "OpenCart",
  sitemapUrls: ["https://www.onixbd.com/sitemap.xml"],
  categoryUrls: ["https://www.onixbd.com/component"],
  crawlDelayMs: 1500,
  ogIsRegularPrice: false,
  degraded: false,
  notes: "Exclude /component-combo (bundles). LIVE 2026-11-08 (VM): /component sitemap discovery works (10,431 URLs), 5/5 products parsed, 0 blocked; C920 verified live at 12,400 BDT (see script-blob price bug fix in opencart.js/jsonld.js).",
  isProductUrl: (u) =>
    u.startsWith("https://www.onixbd.com/") &&
    !u.includes("/component") &&
    !u.includes("?") &&
    !u.endsWith(".com.bd/"),
};

export { listProductUrls };

/**
 * parseProduct — shared OpenCart parser (src/scrapers/opencart.js).
 * Gallery: og:image + OpenCart thumbnail gallery (/image/cache/catalog/...-500x500.jpg.webp) + JSON-LD images.
 * Returns the full normalised schema including images[] (all gallery
 * images, deduplicated, absolute URLs; [] when the page exposes none).
 */
export function parseProduct(config, html, url) {
  return parseProductShared(config, html, url);
}
export const scrape = (opts) => scrapeRetailer(config, opts);
export default config;
