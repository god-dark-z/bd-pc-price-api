/**
 * AVA Technology BD — https://www.avatechnologybd.com
 * Platform: OpenCart (strong evidence: /image/cache/catalog/...,
 * index.php?route=product/category&path=288, "Ex Tax:" lines, JSON-LD
 * Product + Offer, og:type=product). Self-described "computer parts
 * distributor since 2022", Elephant Road, Dhaka: processors, motherboards,
 * SSD, RAM, power supplies, coolers and monitors.
 * - Sitemap: flat urlset, 623 URLs (parts-focused catalogue, smallest of
 *   the Phase-4 three). Brand pages (e.g. /gamdias, /thermaltake) are in
 *   the sitemap and are dropped by the product-page gate.
 * - Product page: offer/regular price pair + JSON-LD
 *   Product.offers.price. No "latest price … is X" sentence.
 * - robots.txt: User-agent * Allow / + standard OpenCart disallows
 *   (/*?route=checkout/, /*?route=account/, /*?route=product/search,
 *   /*?limit, /*?sort, /*?order, /*?price, …). Our crawl uses the sitemap
 *   + plain product URLs and never those params. No Crawl-Delay, no
 *   challenge observed.
 * Verified samples: AMD Ryzen 3 3200G — 8,900 BDT (regular 9,500), In Stock
 *   https://www.avatechnologybd.com/amd-ryzen-3-3200g-processor
 *   AMD Ryzen 7 5700G — 21,900 BDT (regular 22,500), In Stock
 *   https://www.avatechnologybd.com/amd-ryzen-7-5700g-radeon-graphics-processor
 */
import { listProductUrls, parseProduct as parseProductShared, scrapeRetailer } from "./opencart.js";

export const config = {
  id: "ava",
  name: "AVA Technology BD",
  baseUrl: "https://www.avatechnologybd.com",
  platform: "OpenCart",
  sitemapUrls: ["https://www.avatechnologybd.com/sitemap.xml"],
  categoryUrls: ["https://www.avatechnologybd.com/index.php?route=product/category&path=288"],
  crawlDelayMs: 2000,
  ogIsRegularPrice: false,
  degraded: false,
  notes: "Parts-focused catalogue (623 sitemap URLs). Brand pages in the sitemap are dropped by the product-page gate. No regular-price guarantee — sampled pages show an offer/regular pair.",
  isProductUrl: (u) =>
    u.startsWith("https://www.avatechnologybd.com/") &&
    !u.includes("?") &&
    !u.endsWith(".com/"),
};

export { listProductUrls };

/**
 * parseProduct — shared OpenCart parser (src/scrapers/opencart.js).
 * Gallery: og:image + JSON-LD images + /image/cache/catalog/... images on
 * the page. Returns the full normalised schema including images[] (all
 * gallery images, deduplicated, absolute URLs; [] when the page exposes
 * none).
 */
export function parseProduct(config, html, url) {
  return parseProductShared(config, html, url);
}
export const scrape = (opts) => scrapeRetailer(config, opts);
export default config;
