/**
 * Star Tech — https://www.startech.com.bd
 * Platform: very likely OpenCart. No Cloudflare challenge observed.
 * - Main component list: /component — 1,537 products, 20/page, ?page=N verified.
 * - Sitemap: single flat file, ~165k lines, all product slugs. Best URL source.
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
  notes: "OG price is the regular price — visible offer price wins.",
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
