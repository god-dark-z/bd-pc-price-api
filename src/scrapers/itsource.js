/**
 * IT Source BD — https://www.itsource-bd.com
 * Platform: OpenCart (verified: catalog/website/logo/... assets,
 * route=product/product/review&product_id=2542 in page JS).
 * - Sitemap index: product-sitemap-1.xml, category-sitemap.xml,
 *   brands-sitemap.xml, information-sitemap.xml, blog-sitemap.xml.
 *   Shared discovery follows the product sub-sitemap.
 * - Product page: JSON-LD Product.offers + OG product:price:amount
 *   agree (2,450.0000 on the LEXAR E350 page = offer price; page text
 *   "Price: 2,450৳, Status: In Stock, Product Code: 2542").
 * - Catalogue is accessories/storage-heavy (SSD enclosures, HDD/SSD,
 *   PSU) — still real component prices.
 * Verified sample: LEXAR E350 M.2 SATA/NVMe SSD Enclosure — 2,450 BDT,
 * In Stock
 *   https://www.itsource-bd.com/lexar-e350-m.2-sata-nvme-ssd-enclosure
 */
import { listProductUrls, parseProduct as parseProductShared, scrapeRetailer } from "./opencart.js";

export const config = {
  id: "itsource",
  name: "IT Source BD",
  baseUrl: "https://www.itsource-bd.com",
  platform: "OpenCart",
  sitemapUrls: ["https://www.itsource-bd.com/sitemap.xml"],
  categoryUrls: [],
  crawlDelayMs: 1500,
  ogIsRegularPrice: false,
  degraded: false,
  notes: "Discovery is sitemap-only (no verified component category URL). JSON-LD and OG prices agree.",
  isProductUrl: (u) =>
    u.startsWith("https://www.itsource-bd.com/") &&
    !u.includes("?") &&
    !u.endsWith(".com/"),
};

export { listProductUrls };

/**
 * parseProduct — shared OpenCart parser (src/scrapers/opencart.js).
 * Gallery: og:image + JSON-LD images.
 */
export function parseProduct(config, html, url) {
  return parseProductShared(config, html, url);
}
export const scrape = (opts) => scrapeRetailer(config, opts);
export default config;
