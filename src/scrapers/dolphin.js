/**
 * Dolphin Computers — https://www.dolphin.com.bd
 * Platform: Odoo (verified: <meta name="generator" content="Odoo">,
 * /shop/... URLs, oe_currency_value price spans,
 * /web/image/product.template/<id>/... images).
 * CUSTOM DISCOVERY + PARSE — the shared parser cannot handle Odoo:
 * - The sitemap (3,807 locs) contains NO product URLs at all, so
 *   discovery crawls component category pagination:
 *   /shop/category/<slug>-<id> then /page/N (verified pattern:
 *   /shop/category/accessories-electrical-power-7609/page/2).
 * - Product pages carry NO JSON-LD and NO OG product price
 *   (og:type=website). Price lives in Schema.org MICRODATA:
 *   <div itemprop="offers"><span itemprop="price">2707.49…</span>
 *   <span itemprop="priceCurrency">BDT</span> plus a struck-through
 *   itemprop="listPrice" (oe_default_price, hidden when equal).
 * - Stock signals are Odoo DOM flags: #out_of_stock_message carries
 *   d-none when in stock (visible = out of stock); #product_unavailable
 *   ("Call for Price") carries d-none when buyable.
 * - Gallery must be scoped to the product's own template id — related
 *   products on the same page use other template ids.
 * Verified sample: ATX Mid Tower Casing With PSU-D-TECH — 2,707 BDT
 * (2,707.49), In Stock
 *   https://www.dolphin.com.bd/shop/cas128-atx-mid-tower-casing-with-psu-d-tech-16063?category=7519
 */
import * as cheerio from "cheerio";
import { fetchText } from "../lib/http.js";
import { parseAmount } from "../lib/price.js";
import { normalizeProduct, dedupeImages } from "../lib/normalize.js";
import { extractSpecTable, extractDescription, extractOpenGraph, absUrl } from "../lib/jsonld.js";
import { scrapeRetailer } from "./opencart.js";

export const config = {
  id: "dolphin",
  name: "Dolphin Computers",
  baseUrl: "https://www.dolphin.com.bd",
  platform: "Odoo",
  sitemapUrls: ["https://www.dolphin.com.bd/sitemap.xml"],
  // Sitemap has no product URLs — discovery is category pagination
  // (see listProductUrls below). These are component categories from
  // the sitemap; the parent 7519 covers desktop components broadly.
  categoryUrls: [
    "https://www.dolphin.com.bd/shop/category/desktop-desktop-component-7519",
    "https://www.dolphin.com.bd/shop/category/desktop-desktop-component-processor-9639",
    "https://www.dolphin.com.bd/shop/category/desktop-desktop-component-motherboard-9640",
    "https://www.dolphin.com.bd/shop/category/desktop-desktop-component-desktop-ram-9641",
    "https://www.dolphin.com.bd/shop/category/desktop-desktop-component-graphics-card-9643",
    "https://www.dolphin.com.bd/shop/category/desktop-desktop-component-power-supply-9644",
    "https://www.dolphin.com.bd/shop/category/desktop-desktop-component-casing-9645",
    "https://www.dolphin.com.bd/shop/category/desktop-storage-7523",
  ],
  crawlDelayMs: 1500,
  ogIsRegularPrice: false,
  degraded: false,
  notes: "Odoo: custom discovery (category pagination — sitemap has no product URLs) and custom microdata parser. Prices are microdata itemprop=price; stock from #out_of_stock_message / #product_unavailable visibility.",
  isProductUrl: (u) =>
    u.startsWith("https://www.dolphin.com.bd/shop/") &&
    !u.includes("/shop/category/") &&
    !u.includes("/shop/cart") &&
    !u.includes("/shop/checkout") &&
    !u.includes("/shop/all-brands") &&
    /\/shop\/[^/]+-\d+/.test(u),
};

/** Collect product URLs from the component category pages (?page=N is Odoo's /page/N path form). */
export async function listProductUrls(config, { maxPages = 2 } = {}) {
  const found = new Set();
  const discoveryErrors = [];
  for (const cat of config.categoryUrls || []) {
    for (let page = 1; page <= maxPages; page++) {
      const url = page === 1 ? cat : `${cat}/page/${page}`;
      const res = await fetchText(url, { delayMs: config.crawlDelayMs });
      if (!res.ok) {
        discoveryErrors.push({ url, error: res.error || `HTTP ${res.status}`, status: res.status ?? null, blocked: !!res.blocked });
        break;
      }
      const $ = cheerio.load(res.html);
      let added = 0;
      $("a[href]").each((_, a) => {
        const href = $(a).attr("href");
        if (!href) return;
        const u = absUrl(config.baseUrl, href.split("?")[0]);
        if (u && config.isProductUrl(u) && !found.has(u)) {
          found.add(u);
          added++;
        }
      });
      if (added === 0) break; // no new links — end of pagination
    }
  }
  return { urls: [...found], discovery_errors: discoveryErrors };
}

/**
 * Parse one Odoo product page. Returns null when the page is not a
 * buyable product page (no h1, or no microdata offers price and no
 * call-for-price marker) — dropped, never published.
 */
export function parseProduct(config, html, url) {
  const $ = cheerio.load(html || "");
  const name = $("h1").first().text().trim() || null;
  if (!name) return null;

  const offersScope = $('[itemprop="offers"]').first();
  const priceRaw = offersScope.find('[itemprop="price"]').first().text().trim();
  const listRaw = offersScope.find('[itemprop="listPrice"]').first().text().trim();
  let price = parseAmount(priceRaw);
  let regularPrice = null;
  const listPrice = parseAmount(listRaw);
  if (listPrice && price && listPrice > price) regularPrice = listPrice;

  // Stock: Odoo hides the out-of-stock message (d-none) while in stock.
  const oosEl = $("#out_of_stock_message");
  const unavEl = $("#product_unavailable");
  const unavVisible = unavEl.length > 0 && !unavEl.hasClass("d-none");
  let stock = "unknown";
  if (unavVisible) {
    // "Call for Price" — no buyable price; unpublishable (price null +
    // unknown stock). Keep price null so it can never look like a deal.
    price = null;
    regularPrice = null;
    stock = "unknown";
  } else if (oosEl.length > 0 && !oosEl.hasClass("d-none")) {
    stock = "out_of_stock";
  } else if (price !== null) {
    stock = "in_stock";
  }
  if (price === null && stock === "in_stock") {
    // Should not happen (stock is only in_stock when a price exists),
    // but guard it the same way the shared parser does.
    stock = "unknown";
  }
  // A page with neither a price nor a stock signal is not a product page.
  if (price === null && stock === "unknown" && !unavVisible) return null;

  const og = extractOpenGraph(html);
  // Gallery: og:image + this product's own template images only
  // (related products on the page use other template ids). Prefer the
  // large variants; drop 128px thumbnails.
  const templateId =
    (og.image && /product\.template\/(\d+)\//.exec(og.image)?.[1]) ||
    /-(\d+)(?:[?#]|$)/.exec(url)?.[1] ||
    null;
  const images = [];
  const push = (raw) => {
    if (!raw) return;
    const abs = absUrl(url, raw);
    if (!abs) return;
    if (templateId && !abs.includes(`/product.template/${templateId}/`)) return;
    if (/image_128/.test(abs)) return;
    if (!images.includes(abs)) images.push(abs);
  };
  if (og.image) push(og.image);
  $("img").each((_, img) => {
    push($(img).attr("src") || $(img).attr("data-src"));
  });
  const gallery = dedupeImages(images);

  const description = extractDescription(html);
  const specs = extractSpecTable(html);

  return normalizeProduct(
    { id: config.id, name: config.name },
    {
      name,
      url,
      image: gallery[0] || og.image || null,
      images: gallery,
      price,
      regular_price: regularPrice,
      stock,
      description,
      specs,
      brand: null,
      category: null,
      price_sources: price !== null || regularPrice !== null ? ["microdata:itemprop-price"] : [],
      conflicts: [],
    }
  );
}

// Attach the overrides so the engine dispatch in scrapeRetailer (and
// scrape-live) actually uses the Odoo discovery/parser.
config.listProductUrls = listProductUrls;
config.parseProduct = parseProduct;

export const scrape = (opts) => scrapeRetailer(config, opts);
export default config;
