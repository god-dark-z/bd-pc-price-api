/**
 * opencart.js — generic adapter for the OpenCart retailers (8 of the 10
 * Tier-1 sites: Star Tech, Ultra, PC House, Sell Tech, Speed Tech,
 * Index IT, Onix BD, and — with its own overrides — Techland).
 *
 * Shared, research-verified behaviour:
 * - Discovery is SITEMAP-FIRST. Category ?page=N is the fallback.
 *   Never crawl with sort/limit/search params (robots-disallowed).
 * - Listing cards: offer price first, regular price second.
 * - Product page: JSON-LD offers / OG product meta give price + stock;
 *   the Specification tab is a grouped key|value table; the Description
 *   tab is prose + a "latest price … is X" sentence.
 * - NO CSS class selectors are used anywhere: price is found from
 *   structured data + generic price regexes, specs from heading text.
 *
 * A per-retailer config only supplies: id, name, baseUrl, sitemapUrls,
 * categoryUrls, crawlDelayMs, and the flags that differ (ogIsRegularPrice,
 * degraded/browserRequired, notes). Everything else is shared code.
 */
import * as cheerio from "cheerio";
import { fetchText, parseSitemapUrls, isSitemapIndex } from "../lib/http.js";
import { parseAmount, parseAmounts, pricePair, reconcilePrices } from "../lib/price.js";
import { normalizeProduct } from "../lib/normalize.js";
import {
  extractJsonLd,
  extractOpenGraph,
  extractSpecTable,
  extractDescription,
  extractLatestPriceSentence,
  extractGalleryImages,
  isProductPage,
} from "../lib/jsonld.js";

/** Resolve a possibly-relative URL against a base. */
export function absUrl(base, href) {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

/**
 * Collect product URLs for a retailer.
 * Strategy: sitemap index -> sub-sitemaps -> product URLs (filtered to
 * same-origin http(s) URLs, excluding category/brand/info pages by the
 * retailer's own exclude patterns). Falls back to category pagination
 * when no sitemap yields URLs. `maxPages` caps the fallback crawl.
 */
export async function listProductUrls(config, { maxPages = 5 } = {}) {
  const found = new Set();
  const seenSitemaps = new Set();

  async function readSitemap(url) {
    if (seenSitemaps.has(url)) return;
    seenSitemaps.add(url);
    const res = await fetchText(url, { delayMs: config.crawlDelayMs });
    if (!res.ok) return;
    if (isSitemapIndex(res.html)) {
      for (const sub of parseSitemapUrls(res.html)) {
        if (sub.includes("product")) await readSitemap(sub);
      }
      return;
    }
    for (const u of parseSitemapUrls(res.html)) {
      if (config.isProductUrl ? config.isProductUrl(u) : true) found.add(u);
    }
  }

  for (const sm of config.sitemapUrls || []) await readSitemap(sm);
  if (found.size > 0) return [...found];

  // Fallback: category pagination (clean ?page=N only — no sort/limit).
  for (const cat of config.categoryUrls || []) {
    for (let page = 1; page <= maxPages; page++) {
      const url = page === 1 ? cat : `${cat}${cat.includes("?") ? "&" : "?"}page=${page}`;
      const res = await fetchText(url, { delayMs: config.crawlDelayMs });
      if (!res.ok) break;
      const $ = cheerio.load(res.html);
      let added = 0;
      $("a[href]").each((_, a) => {
        const href = $(a).attr("href");
        const u = absUrl(config.baseUrl, href);
        if (u && u.startsWith(config.baseUrl) && (config.isProductUrl ? config.isProductUrl(u) : true)) {
          if (!found.has(u)) {
            found.add(u);
            added++;
          }
        }
      });
      if (added === 0) break; // no new links — end of pagination
    }
  }
  return [...found];
}

/**
 * Parse one product detail page (HTML string) into a normalised product.
 * Returns NULL when the page is not a product page (see isProductPage in
 * src/lib/jsonld.js — BUG 1 fix: sitemaps list category/guide pages too,
 * e.g. Star Tech /lifestyle and /blood-pressure-monitor, which the old
 * parser turned into fake "products" from price-like text). Callers must
 * skip null and count it as dropped, never publish it.
 * Price resolution order:
 *  1. visible offer price — "latest price … is X" sentence, then the
 *     first price pair in the page body near a price label;
 *  2. JSON-LD offers.price / OG product:price:amount (structured);
 *  3. reconcilePrices() decides, and logs a conflict when they disagree.
 * On sites flagged ogIsRegularPrice (Star Tech, PC House) the structured
 * price is treated as the regular price when it is higher than the offer.
 */
export function parseProduct(config, html, url) {
  // --- structured-data gate: not a product page, drop it ---
  const gate = isProductPage(html);
  if (!gate.isProduct) {
    console.warn(`[drop] not a product page (${gate.evidence}): ${url}`);
    return null;
  }

  const $ = cheerio.load(html || "");
  const conflicts = [];
  const priceSources = [];

  const jsonLd = extractJsonLd(html);
  const og = extractOpenGraph(html);

  // Name: the on-page <h1> is the product name ("AMD Ryzen 7 5700G
  // Processor with Radeon Graphics"); og:title carries the SEO suffix
  // ("… Processor Price in Bangladesh"), which normalizeProduct strips.
  const name =
    $("h1").first().text().trim() ||
    jsonLd?.name ||
    og.title ||
    $("title").text().trim() ||
    null;

  // --- visible price: "latest price … is X" sentence first ---
  let visiblePrice = extractLatestPriceSentence(html);
  if (visiblePrice) priceSources.push("visible:latest-price-sentence");

  // --- then: price-like text in the main content (first pair wins) ---
  let visibleRegular = null;
  if (!visiblePrice) {
    const bodyText = $("body").text().replace(/\s+/g, " ");
    // Look near a price label first, else take the first plausible pair.
    const labelled = bodyText.match(/(?:price|offer price)[^0-9]{0,40}([\d,]+)\s*৳/i);
    if (labelled) {
      visiblePrice = parseAmount(labelled[1]);
      priceSources.push("visible:price-label");
    }
  }

  // Structured price (JSON-LD preferred, OG fallback).
  const structured = jsonLd?.price ?? og.price ?? null;
  const structuredSource = jsonLd?.price ? "jsonld" : og.price ? "opengraph" : null;
  if (structuredSource) priceSources.push(`structured:${structuredSource}`);

  let { price, regularPrice, conflicts: priceConflicts } = reconcilePrices({
    visiblePrice,
    visibleRegular,
    structuredPrice: structured,
    source: structuredSource,
  });
  conflicts.push(...priceConflicts);

  // If the structured source is flagged as regular-price-only and we still
  // have no regular price, record it as such (it is not the offer price).
  if (config.ogIsRegularPrice && structured && price && structured > price && !regularPrice) {
    regularPrice = structured;
  }

  // Stock: structured availability wins; visible "out of stock" text is a fallback.
  let stock = jsonLd?.stock && jsonLd.stock !== "unknown" ? jsonLd.stock : og.stock;
  if (stock === "unknown" || !stock) {
    const bodyText = $("body").text();
    if (/out of stock/i.test(bodyText)) stock = "out_of_stock";
    else if (/in stock/i.test(bodyText)) stock = "in_stock";
    else stock = "unknown";
  }
  if (price === null && stock === "in_stock") {
    // A product listed in stock with no price is suspicious (0৳ placeholder
    // class) — do not publish it as a priced deal.
    conflicts.push("in-stock but no price found — possible call-for-price item");
  }

  // Gallery images: OG image + JSON-LD images + every thumbnail-gallery
  // image link and <img> on the page, deduplicated, absolute URLs
  // (see src/lib/jsonld.js extractGalleryImages). The primary image is
  // images[0]. When the page exposes no image at all, images is [] and
  // normalizeProduct records image_missing: true — never invent a URL.
  const images = extractGalleryImages(html, url);
  const image = images[0] || og.image || jsonLd?.image || null;

  const description = jsonLd?.description || extractDescription(html);
  const specs = extractSpecTable(html);

  // Category guess from the URL path (e.g. /component/processor/...).
  let category = null;
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    if (parts.length > 1) category = decodeURIComponent(parts[parts.length - 2]);
  } catch {
    category = null;
  }

  return normalizeProduct(
    { id: config.id, name: config.name },
    {
      name,
      url,
      image,
      images,
      price,
      regular_price: regularPrice,
      stock,
      description,
      specs,
      brand: jsonLd?.brand || null,
      category,
      price_sources: priceSources,
      conflicts,
    }
  );
}

/** Scrape one retailer end-to-end (URLs -> products), with a per-URL cap.
 * Pages that fail the structured-data gate return null from parseProduct
 * and are counted in `dropped` (with URLs in `dropped_urls`, capped at
 * 20) — they are never published. `products` counts only parsed pages. */
export async function scrapeRetailer(config, { limit = 50, onProduct = null } = {}) {
  const started = new Date().toISOString();
  const urls = await listProductUrls(config);
  const products = [];
  const errors = [];
  const droppedUrls = [];
  let dropped = 0;
  let blocked = 0;
  for (const url of urls.slice(0, limit)) {
    const res = await fetchText(url, { delayMs: config.crawlDelayMs });
    if (!res.ok) {
      if (res.blocked) blocked++;
      errors.push({ url, error: res.error || `HTTP ${res.status}` });
      continue;
    }
    try {
      const product = parseProduct(config, res.html, url);
      if (product === null) {
        // Not a product page (category/guide) — dropped, not an error.
        dropped++;
        if (droppedUrls.length < 20) droppedUrls.push(url);
        continue;
      }
      products.push(product);
      if (onProduct) await onProduct(product);
    } catch (e) {
      errors.push({ url, error: String(e.message || e) });
    }
  }
  return {
    retailer_id: config.id,
    retailer: config.name,
    started,
    finished: new Date().toISOString(),
    urls_found: urls.length,
    products: products.length,
    dropped,
    dropped_urls: droppedUrls,
    blocked,
    errors: errors.slice(0, 20),
    items: products,
  };
}
