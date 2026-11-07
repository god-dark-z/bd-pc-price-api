/**
 * UCC BD — https://www.ucc.com.bd
 * Platform: OpenCart (verified: sitemap index with
 * /sitemaps/product-sitemap.xml etc. — same generator shape as
 * Creatus; catalog/motherboard/msi/... image paths;
 * route=product/search in page JS).
 * Distributor (AMD / Acer / MSI / Sapphire / Thermaltake / Zotac) BUT
 * the store publishes stable per-product MRP-style prices + stock
 * status, so it gets a full adapter.
 * - Sitemap index: product-sitemap.xml, category-sitemap.xml,
 *   manufacturer-sitemap.xml, information-sitemap.xml (lastmod
 *   2026-11-07). Shared discovery follows the product sub-sitemap.
 * - Product page: JSON-LD Product.offers = single price (no
 *   regular/offer split seen; visible "৳9,900" matches JSON-LD on the
 *   B450M MORTAR MAX sample). Many boards are OutOfStock in JSON-LD —
 *   the out-of-stock rule applies.
 * Verified sample: MSI B650M GAMING PLUS WIFI AM5 Motherboard —
 * 24,500 BDT, InStock
 *   https://www.ucc.com.bd/msi-b650m-gaming-plus-wifi-am5-motherboard
 */
import { listProductUrls, parseProduct as parseProductShared, scrapeRetailer } from "./opencart.js";

export const config = {
  id: "ucc",
  name: "UCC BD",
  baseUrl: "https://www.ucc.com.bd",
  platform: "OpenCart",
  sitemapUrls: ["https://www.ucc.com.bd/sitemap.xml"],
  categoryUrls: ["https://www.ucc.com.bd/motherboards/amd-motherboards"],
  crawlDelayMs: 1500,
  ogIsRegularPrice: false,
  degraded: false,
  notes: "Distributor with real per-product MRP prices. Product URLs are slug-only or /<category>/…/<slug>; category pages are dropped by the product-page gate.",
  isProductUrl: (u) =>
    u.startsWith("https://www.ucc.com.bd/") &&
    !u.includes("/sitemaps/") &&
    !u.includes("?") &&
    !u.endsWith(".com.bd/"),
};

export { listProductUrls };

/**
 * parseProduct — shared OpenCart parser (src/scrapers/opencart.js).
 * Gallery: og:image + JSON-LD images + /catalog/... images.
 */
export function parseProduct(config, html, url) {
  return parseProductShared(config, html, url);
}
export const scrape = (opts) => scrapeRetailer(config, opts);
export default config;
