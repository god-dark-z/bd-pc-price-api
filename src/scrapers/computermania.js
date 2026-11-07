/**
 * Computer Mania BD — https://computermania.com.bd
 * Platform: WordPress + WooCommerce (verified: robots.txt lists
 * /wp-admin/, /wp-content/uploads/woocommerce_*, /*?orderby=,
 * /*?add-to-cart=; sitemap declared as sitemap_index.xml — Yoast).
 * DEGRADED — Cloudflare challenge on HTML pages (2026-11-08): the
 * product page and sitemap.xml returned HTTP 403 via curl, while
 * robots.txt returned 200 (Cloudflare serves robots but challenges
 * pages). A search-crawl copy of the HP Victus page confirms JSON-LD
 * Product.offers prices exist, but plain fetch cannot reach them.
 * Verified sample (search crawl, 2026-08-02): HP Victus 15
 * (i5-13420H, 16GB, 512GB SSD, RTX4050 6GB) — 118,900 BDT, InStock
 *   https://computermania.com.bd/product/hp-victus-15-rtx4050-gaming-laptop/
 */
import { listProductUrls, parseProduct as parseProductShared, scrapeRetailer } from "./opencart.js";

export const config = {
  id: "computermania",
  name: "Computer Mania BD",
  baseUrl: "https://computermania.com.bd",
  platform: "WordPress + WooCommerce",
  sitemapUrls: ["https://computermania.com.bd/sitemap_index.xml"],
  categoryUrls: [],
  crawlDelayMs: 2000,
  ogIsRegularPrice: false,
  degraded: true,
  browserRequired: true,
  notes:
    "DEGRADED: Cloudflare 403 on product pages + sitemap (robots.txt 200). Sitemap index unverified (CF-blocked). Needs a headless browser for real coverage. Discovery is sitemap-only (no verified component category URL).",
  isProductUrl: (u) =>
    u.startsWith("https://computermania.com.bd/product/") && !u.includes("?"),
};

export { listProductUrls };

/**
 * parseProduct — shared OpenCart parser (src/scrapers/opencart.js).
 * WooCommerce product pages carry JSON-LD Product.offers (flat price)
 * + spec tables; the shared parser reads both.
 */
export function parseProduct(config, html, url) {
  return parseProductShared(config, html, url);
}
export const scrape = (opts) => scrapeRetailer(config, opts);
export default config;
