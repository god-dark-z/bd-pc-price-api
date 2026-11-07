/**
 * Skyland Computer BD — https://www.skyland.com.bd
 * Platform: OpenCart (verified: flat sitemap.xml with <image:loc> under
 * /image/cache/catalog/..., catalog/ asset paths, listing cards
 * offer-first + Save).
 * - Sitemap: single flat file, 19,047 URLs, 9.0 MB — discovery uses the
 *   60 s sitemap timeout in the shared listProductUrls.
 * - Product page: JSON-LD Product.offers + OG product:price:amount give
 *   the OFFER price (FAQ "latest price … is 11,999৳" agrees with OG
 *   11999.00 on the PN750M page). Specs in prose/FAQ, not a table.
 * Verified sample: DeepCool PN750M 750W 80 Plus Gold Fully Modular
 * Power Supply — 11,999 BDT, In Stock
 *   https://www.skyland.com.bd/deepcool-pn750m-750w-80-plus-gold-power-supply
 */
import { listProductUrls, parseProduct as parseProductShared, scrapeRetailer } from "./opencart.js";

export const config = {
  id: "skyland",
  name: "Skyland Computer BD",
  baseUrl: "https://www.skyland.com.bd",
  platform: "OpenCart",
  sitemapUrls: ["https://www.skyland.com.bd/sitemap.xml"],
  categoryUrls: ["https://www.skyland.com.bd/component"],
  crawlDelayMs: 1500,
  ogIsRegularPrice: false,
  degraded: false,
  notes: "Sitemap is large (19,047 URLs / 9 MB). Product URLs are slug-only or /<category>/<slug>; category pages live under /component.",
  isProductUrl: (u) =>
    u.startsWith("https://www.skyland.com.bd/") &&
    !u.includes("/component") &&
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
