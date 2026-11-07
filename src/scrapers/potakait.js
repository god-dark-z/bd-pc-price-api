/**
 * Potaka IT — https://potakait.com
 * Platform: OpenCart (verified: robots disallows /*route=product/search,
 * /*?sort, /*?order, /cdn-cgi/; listing cards offer-first + Ex Tax +
 * Save + "Showing 1 to 24 of 25 (2 Pages)"; /components category routes).
 * DEGRADED — intermittent Cloudflare challenge (2026-11-08): robots.txt
 * and the homepage return 200, but sitemap.xml and a product page
 * returned a "One moment, please..." challenge page (HTTP 200 body)
 * via curl. fetchText detects the challenge text and reports blocked.
 * The challenge is intermittent (an earlier probe saw 200s), so plain
 * fetch sometimes works — marked degraded, not browser-required.
 * Verified sample (search crawl): ASRock Z790 Pro RS 13th Gen & 12th Gen
 * ATX Motherboard — 32,000 BDT, In Stock
 *   https://potakait.com/asrock-z790-pro-rs-motherboard
 * CORRECTION (2026-11-08, live HTML): OG product:price:amount is the
 * REGULAR price, not the offer — Frozen Warframe 420 White: visible
 * "latest price … is 14,000৳" + JSON-LD "price": 14000 vs OG 15000.0000;
 * ASRock Z790 Pro RS: JSON-LD "price": 29650 vs OG 32000.0000 (32,000
 * appears nowhere in the visible text). ogIsRegularPrice: true, same
 * class as Star Tech / PC House / Computer Source.
 * Note: OG availability can be "Up Coming" (e.g. Corsair RM650e) — the
 * shared parser treats that as unknown stock, never in_stock.
 * DISCOVERY FIX (2026-11-08): sitemap-first burns the attempt budget —
 * the 7,157-URL sitemap leads with brand/category pages
 * (/colorful-graphics-cards, /powercolor-graphics-card, …), so a limit-3
 * run spent all 153 attempts on gate-dropped categories and published 0.
 * Now category-first (Star Tech pattern): /components grid has 24
 * product cards inside .product-listing per page; ?page=2 returns 24
 * different products (verified live 2026-11-08).
 */
import { listProductUrls, parseProduct as parseProductShared, scrapeRetailer } from "./opencart.js";

export const config = {
  id: "potakait",
  name: "Potaka IT",
  baseUrl: "https://potakait.com",
  platform: "OpenCart",
  sitemapUrls: ["https://potakait.com/sitemap.xml"],
  categoryUrls: ["https://potakait.com/components"],
  discoveryMode: "category",
  listingSelector: ".product-listing",
  categoryPages: 5,
  crawlDelayMs: 1500,
  ogIsRegularPrice: true,
  degraded: true,
  browserRequired: false,
  notes:
    "DEGRADED: intermittent Cloudflare challenge on sitemap + product pages (200-status challenge body, 2026-11-08). Category fallback uses clean ?page=N only — robots disallows ?sort/?order/?limit. Category-first discovery (2026-11-08): sitemap leads with brand pages, burning the attempt budget (0/153 on limit-3 sitemap-first run).",
  isProductUrl: (u) =>
    u.startsWith("https://potakait.com/") &&
    !u.startsWith("https://potakait.com/components") &&
    !u.includes("?") &&
    !u.endsWith(".com/"),
};

export { listProductUrls };

/**
 * parseProduct — shared OpenCart parser (src/scrapers/opencart.js).
 * OG product:price:amount = REGULAR price (ogIsRegularPrice: true);
 * offer comes from the visible "latest price" sentence / JSON-LD.
 */
export function parseProduct(config, html, url) {
  return parseProductShared(config, html, url);
}
export const scrape = (opts) => scrapeRetailer(config, opts);
export default config;
