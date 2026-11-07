/**
 * Computer Village — https://www.computervillage.com.bd
 * Platform: OpenCart (strong evidence: /component/<category> routes,
 * listing cards offer-first + Ex Tax + Save, JSON-LD Product.offers).
 * DEGRADED — Cloudflare challenge on every plain fetch (2026-11-08):
 * robots.txt, sitemap.xml, homepage and a product page all returned
 * HTTP 403 + "Just a moment..." challenge HTML via curl. fetchText
 * detects the challenge and reports blocked. The site is indexed by
 * search crawlers, so the data exists — plain fetch cannot reach it
 * from this VM. A headless browser is required for real coverage.
 * Verified sample (search crawl): ASUS TUF GAMING B850-PLUS WIFI
 * Motherboard — 38,000 BDT, OutOfStock
 *   https://www.computervillage.com.bd/asus-tuf-gaming-b850-plus-wifi-motherboard
 */
import { listProductUrls, parseProduct as parseProductShared, scrapeRetailer } from "./opencart.js";

export const config = {
  id: "computervillage",
  name: "Computer Village",
  baseUrl: "https://www.computervillage.com.bd",
  platform: "OpenCart",
  sitemapUrls: ["https://www.computervillage.com.bd/sitemap.xml"],
  categoryUrls: ["https://www.computervillage.com.bd/component"],
  crawlDelayMs: 1500,
  ogIsRegularPrice: false,
  degraded: true,
  browserRequired: true,
  notes:
    "DEGRADED: Cloudflare challenge on every plain fetch (robots/sitemap/homepage/product all 403, 2026-11-08). Sitemap URL unverified (CF-blocked). Needs a headless browser for real coverage.",
  isProductUrl: (u) =>
    u.startsWith("https://www.computervillage.com.bd/") &&
    !u.includes("/component") &&
    !u.includes("?") &&
    !u.endsWith(".com.bd/"),
};

export { listProductUrls };

/**
 * parseProduct — shared OpenCart parser (src/scrapers/opencart.js).
 * Price/stock via JSON-LD offers / OG product meta; specs from the
 * Specification tab table; gallery via og:image + JSON-LD images.
 */
export function parseProduct(config, html, url) {
  return parseProductShared(config, html, url);
}
export const scrape = (opts) => scrapeRetailer(config, opts);
export default config;
