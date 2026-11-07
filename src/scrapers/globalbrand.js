/**
 * Global Brand PLC — https://www.globalbrand.com.bd
 * Platform: OpenCart (verified: flat sitemap.xml with <image:loc> under
 * image/cache/catalog/... via tenbytecdn, catalog/view/theme/journal3
 * assets, /components/... and /laptop/... category routes, ?page=N).
 * Distributor (sole ASUS distributor in BD) BUT the store sells retail
 * with stable per-product prices + stock status, so it gets a full
 * adapter (not a not-a-retailer verdict).
 * - Sitemap: single flat file, 6,932 URLs — overwhelmingly products,
 *   plus a few top-level categories (/laptop, /laptop-accessories).
 * - Product page: JSON-LD Product.offers gives the OFFER price
 *   (25,000 on the ROG Delta S page matches the visible ৳25,000.00).
 *   No OG product-price meta on the sample page.
 * Verified sample: ASUS ROG Delta S Wireless Lightweight Wireless
 * Gaming Headphone — 25,000 BDT, InStock
 *   https://www.globalbrand.com.bd/gaming-headphone/asus-rog-delta-s-wireless-lightweight-wireless-gaming-headphone
 */
import { listProductUrls, parseProduct as parseProductShared, scrapeRetailer } from "./opencart.js";

export const config = {
  id: "globalbrand",
  name: "Global Brand PLC",
  baseUrl: "https://www.globalbrand.com.bd",
  platform: "OpenCart",
  sitemapUrls: ["https://www.globalbrand.com.bd/sitemap.xml"],
  categoryUrls: ["https://www.globalbrand.com.bd/components/motherboard/asus-motherboard"],
  crawlDelayMs: 1500,
  ogIsRegularPrice: false,
  degraded: false,
  notes: "Distributor with real retail product prices. Sitemap is product-heavy (6,932 URLs); category pages in it are dropped by the product-page gate. Products can live under category prefixes (e.g. /gaming-headphone/<slug>), so the filter only excludes queries and the homepage.",
  isProductUrl: (u) =>
    u.startsWith("https://www.globalbrand.com.bd/") &&
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
