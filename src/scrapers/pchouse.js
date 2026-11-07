/**
 * PC House BD — https://www.pchouse.com.bd
 * Platform: OpenCart (strong evidence). No challenge observed.
 * - Main components list: /pc-components?page=N, 16/page, 2,476 models, 155 pages.
 * - Listing card: image, name/link, spec bullets, offer first, old second, "Save:".
 * - PRICE TRAP: OG product:price:amount is the REGULAR price, not the offer
 *   (RX 9060 XT: listing 83,900 / 92,500, OG 92,500). ogIsRegularPrice=true.
 * - 5700G CONFLICT: listing price table 21,900 vs detail OG 25,500 — logged.
 * - Product page: long description; no spec table visible in text fetch;
 *   two page templates exist (new + older with explicit Regular Price field).
 * - Sitemap index: 7 product sitemaps — best crawl seed.
 * - PHASE 1 (2026-11-08, verified live from this VM): discovery returns
 *   12,107 URLs and the first products parse cleanly (1STPLAYER NGDP
 *   750W: 11,700 / was 12,900, In Stock). The 00:20 Netlify run's
 *   0/0/0 was NOT reproduced here — the pre-diagnostics code swallowed
 *   discovery failures silently, and the most likely cause is the same
 *   transient Cloudflare/rate-limit burst that hit Ryans + Techland at
 *   00:20 (all 10 retailers fired at once). Discovery now retries
 *   blocked fetches with a long back-off and records every failure in
 *   discovery_errors, so a repeat will be diagnosable.
 * Verified sample: ASUS Dual RX 9060 XT 16GB — 83,900 (was 92,500), In Stock.
 */
import { listProductUrls, parseProduct as parseProductShared, scrapeRetailer } from "./opencart.js";

export const config = {
  id: "pchouse",
  name: "PC House BD",
  baseUrl: "https://www.pchouse.com.bd",
  platform: "OpenCart",
  sitemapUrls: [
    "https://www.pchouse.com.bd/sitemap.xml",
    "https://www.pchouse.com.bd/product-sitemap-1.xml",
    "https://www.pchouse.com.bd/product-sitemap-2.xml",
    "https://www.pchouse.com.bd/product-sitemap-3.xml",
    "https://www.pchouse.com.bd/product-sitemap-4.xml",
    "https://www.pchouse.com.bd/product-sitemap-5.xml",
    "https://www.pchouse.com.bd/product-sitemap-6.xml",
    "https://www.pchouse.com.bd/product-sitemap-7.xml",
  ],
  categoryUrls: ["https://www.pchouse.com.bd/pc-components"],
  crawlDelayMs: 1500,
  ogIsRegularPrice: true,
  degraded: false,
  notes: "OG price is the regular price. 5700G conflict: listing 21,900 vs OG 25,500. Two page templates exist. Live-verified from VM 2026-11-08 (12,107 sitemap URLs, 5/5 parsed); Netlify 00:20 failure not reproduced — likely transient rate-limit burst, now retried + recorded.",
  isProductUrl: (u) =>
    u.startsWith("https://www.pchouse.com.bd/") &&
    !u.includes("/pc-components") &&
    !u.includes("?") &&
    !u.endsWith(".com.bd/"),
};

export { listProductUrls };

/**
 * parseProduct — shared OpenCart parser (src/scrapers/opencart.js).
 * Gallery: og:image + OpenCart thumbnail gallery (/image/cache/catalog/...-228x228.*) + JSON-LD images.
 * Returns the full normalised schema including images[] (all gallery
 * images, deduplicated, absolute URLs; [] when the page exposes none).
 */
export function parseProduct(config, html, url) {
  return parseProductShared(config, html, url);
}
export const scrape = (opts) => scrapeRetailer(config, opts);
export default config;
