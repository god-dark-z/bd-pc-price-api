/**
 * Star Tech — https://www.startech.com.bd
 * Platform: very likely OpenCart. No Cloudflare challenge observed.
 * - Main component list: /component — 1,537 products, 20/page, ?page=N verified.
 * - Sitemap: single flat file, ~165k lines — NOT usable as the first URL
 *   source (PHASE 1, 2026-11-08): its first ~4,000 URLs are category/brand
 *   pages and the first real product sits at index 4,182, so a 200-URL run
 *   fetched 200 category pages and published 0. Discovery is therefore
 *   CATEGORY-FIRST (discoveryMode: "category"): /component holds 20 product
 *   links per page inside .product-listing (verified live 2026-11-08).
 *   The sitemap stays as the fallback if category discovery yields nothing.
 * - PRICE TRAP: OG product:price:amount is the REGULAR price, not the sale
 *   price (5700G: OG 22,500 vs visible latest price 20,600). ogIsRegularPrice=true.
 * - Verified sample: Ryzen 7 5700G — 20,600 (visible), OG 22,500, In Stock.
 */
import { listProductUrls, parseProduct as parseProductShared, scrapeRetailer } from "./opencart.js";

export const config = {
  id: "startech",
  name: "Star Tech",
  baseUrl: "https://www.startech.com.bd",
  platform: "OpenCart (likely)",
  sitemapUrls: ["https://www.startech.com.bd/sitemap.xml"],
  categoryUrls: [
    "https://www.startech.com.bd/component",
    "https://www.startech.com.bd/component/processor",
    "https://www.startech.com.bd/component/motherboard",
    "https://www.startech.com.bd/component/graphics-card",
    "https://www.startech.com.bd/component/CPU-Cooler",
  ],
  crawlDelayMs: 1500,
  ogIsRegularPrice: true,
  degraded: false,
  // PHASE 1 FIX: category-first discovery (see header). /component has
  // 77 pages of 20; categoryPages caps the crawl, minUrls stops it early
  // once enough URLs are collected. listingSelector scopes link
  // collection to the product grid — the page nav alone carries ~1,480 links.
  discoveryMode: "category",
  categoryPages: 80,
  listingSelector: ".product-listing",
  notes: "OG price is the regular price — visible offer price wins. Discovery is category-first: the sitemap's first ~4,000 URLs are category/brand pages, so sitemap-first published 0.",
  isProductUrl: (u) =>
    u.startsWith("https://www.startech.com.bd/") &&
    !u.includes("/component") &&
    !u.includes("?") &&
    !/\/(laptop|desktop|monitor|camera|accessories|gadget|ups|printer|networking|software|brand)\b/.test(u),
};

export { listProductUrls };

/**
 * parseProduct — shared OpenCart parser (src/scrapers/opencart.js).
 * Gallery: og:image + OpenCart thumbnail gallery (/image/cache/catalog/...-500x500.jpg) + JSON-LD images.
 * Returns the full normalised schema including images[] (all gallery
 * images, deduplicated, absolute URLs; [] when the page exposes none).
 */
export function parseProduct(config, html, url) {
  return parseProductShared(config, html, url);
}
export const scrape = (opts) => scrapeRetailer(config, opts);
export default config;
