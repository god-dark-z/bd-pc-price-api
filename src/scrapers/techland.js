/**
 * Techland BD — https://www.techlandbd.com
 * Platform: mixed — Laravel Livewire signals + OpenCart-legacy routes in
 * robots.txt. Do not assume pure OpenCart or pure Laravel.
 * - Listing: /pc-components/motherboard/shop-intel-motherboard, ?page=N,
 *   20/page. Header counts are inconsistent — count scraped links, not headers.
 * - Listing card: offer first, old second, then "Save:" — NEVER trust Save
 *   (39,000-36,300=2,700 but card said Save 1,000). Savings are computed.
 * - Product page price/stock: JSON-LD Product.offers only.
 * - 5700G CONFLICT (research): JSON-LD 20,600 vs page text 22,500 (from 23,500).
 *   The reconciler logs this as a conflict; neither figure is ground truth
 *   until the live page is re-checked.
 * - Sitemap index: 4 product sitemaps. No Cloudflare challenge observed.
 * Verified sample: GIGABYTE Z790M AORUS ELITE AX — 36,300 (old 39,000).
 */
import { listProductUrls, parseProduct as parseProductShared, scrapeRetailer } from "./opencart.js";

export const config = {
  id: "techland",
  name: "Techland BD",
  baseUrl: "https://www.techlandbd.com",
  platform: "Laravel Livewire + OpenCart-legacy (mixed)",
  sitemapUrls: [
    "https://www.techlandbd.com/sitemaps/product-sitemap-1.xml",
    "https://www.techlandbd.com/sitemaps/product-sitemap-2.xml",
    "https://www.techlandbd.com/sitemaps/product-sitemap-3.xml",
    "https://www.techlandbd.com/sitemaps/product-sitemap-4.xml",
  ],
  categoryUrls: [
    "https://www.techlandbd.com/pc-components/motherboard/shop-intel-motherboard",
    "https://www.techlandbd.com/pc-components/shop-desktop-ram/colorful-ram",
  ],
  crawlDelayMs: 1500,
  ogIsRegularPrice: false,
  degraded: false,
  notes: "Never trust the Save: field. 5700G price conflict (JSON-LD 20,600 vs text 22,500) must be logged, not silently picked.",
  isProductUrl: (u) =>
    u.startsWith("https://www.techlandbd.com/") &&
    !u.includes("/pc-components/") &&
    !u.includes("/computers/") &&
    !u.includes("/sitemaps/") &&
    !u.includes("?"),
};

export { listProductUrls };

/**
 * parseProduct — shared OpenCart parser (src/scrapers/opencart.js).
 * Gallery: og:image + JSON-LD images + /cache/images/uploads/products/<id>/<slug>-cover.webp images on the page.
 * Returns the full normalised schema including images[] (all gallery
 * images, deduplicated, absolute URLs; [] when the page exposes none).
 */
export function parseProduct(config, html, url) {
  return parseProductShared(config, html, url);
}
export const scrape = (opts) => scrapeRetailer(config, opts);
export default config;
