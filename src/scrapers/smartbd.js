/**
 * Smart Technologies (BD) — https://smartbd.com
 * Platform: WordPress 7.1.4 + WooCommerce (verified: generator meta,
 * wp-content/uploads/... images, /product-category/.../page/N/
 * pagination, /product-tag/new/, "Add to cart", "Call for Price").
 * Distributor (Gigabyte/Intel) BUT the store publishes stable
 * per-product prices + stock status, so it gets a full adapter.
 * - Sitemap: sitemap.xml is a Yoast index (sitemap_index.xml):
 *   product-sitemap.xml, product-sitemap2.xml, product-sitemap3.xml,
 *   post/page/category sitemaps. Shared discovery follows the product
 *   sub-sitemaps.
 * - QUIRK (verified in raw HTML): Yoast JSON-LD nests the price —
 *   offers[0].priceSpecification[0].price ("29500.00") — with NO flat
 *   offers.price and NO OG product-price meta (og:type=article).
 *   src/lib/jsonld.js extractJsonLd was extended to read
 *   priceSpecification[0].price, so the shared parser works.
 *   Visible prices are split across spans (<span>৳</span>29,500.00),
 *   so structured data is the only price source.
 * - Sale items show a struck-through regular price in <del>; the
 *   adapter adds a <del> post-pass for it (none on the sample page).
 * - "Call for Price" products have no price → unpublishable.
 * Verified sample: GIGABYTE AMD B650M A ELITE AX ICE Motherboard —
 * 29,500 BDT, InStock
 *   https://smartbd.com/product/gigabyte-amd-b650m-a-elite-ax-ice-motherboard/
 */
import * as cheerio from "cheerio";
import { listProductUrls, parseProduct as parseProductShared, scrapeRetailer } from "./opencart.js";
import { parseAmounts, savingsPct } from "../lib/price.js";

export const config = {
  id: "smartbd",
  name: "Smart Technologies (BD)",
  baseUrl: "https://smartbd.com",
  platform: "WordPress + WooCommerce",
  sitemapUrls: ["https://smartbd.com/sitemap.xml"],
  categoryUrls: [],
  crawlDelayMs: 1500,
  ogIsRegularPrice: false,
  degraded: false,
  notes: "WooCommerce/Yoast: price lives in JSON-LD offers.priceSpecification[0].price (see src/lib/jsonld.js). Discovery is sitemap-only — WooCommerce /page/N/ pagination differs from the shared ?page=N fallback. <del> regular-price post-pass for sale items.",
  isProductUrl: (u) =>
    u.startsWith("https://smartbd.com/product/") && !u.includes("?"),
};

export { listProductUrls };

/**
 * parseProduct — shared parser (price from JSON-LD priceSpecification)
 * + <del> regular-price post-pass. The shared parser cannot see the
 * visible regular price (currency symbol sits in its own span), so a
 * struck-through <del> amount above the offer price becomes
 * regular_price and savings_pct is recomputed from the two prices.
 */
export function parseProduct(config, html, url) {
  const product = parseProductShared(config, html, url);
  if (product === null) return null;
  if (product.price === null) return product;
  const $ = cheerio.load(html || "");
  let regular = null;
  $("del").each((_, el) => {
    for (const amount of parseAmounts($(el).text())) {
      if (amount > product.price && (regular === null || amount > regular)) regular = amount;
    }
  });
  if (regular !== null) {
    return {
      ...product,
      regular_price: regular,
      savings_pct: savingsPct(product.price, regular),
    };
  }
  return product;
}

// Attach the override so the engine dispatch in scrapeRetailer (and
// scrape-live) actually uses the <del> post-pass.
config.parseProduct = parseProduct;

export const scrape = (opts) => scrapeRetailer(config, opts);
export default config;
