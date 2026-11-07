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
  visibleBodyText,
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
 * Sitemap fetches get a longer timeout than product pages: sitemap XML
 * files are large (Star Tech's is ~165k lines) and a 20s default timeout
 * can kill discovery before a single product URL is seen. Product-page
 * fetches keep the default 20s timeout — do not raise that one.
 */
export const SITEMAP_TIMEOUT_MS = 60000;

/**
 * Collect product URLs for a retailer.
 * Strategy: sitemap index -> sub-sitemaps -> product URLs (filtered to
 * same-origin http(s) URLs, excluding category/brand/info pages by the
 * retailer's own exclude patterns). Falls back to category pagination
 * when no sitemap yields URLs. `maxPages` caps the fallback crawl.
 *
 * Returns { urls, discovery_errors }: every sitemap / category-page
 * fetch that fails is recorded here (URL + HTTP status / error) so a
 * 0-product scrape can say WHY it found nothing instead of failing
 * silently. A fetch that succeeds but yields 0 product URLs is also
 * recorded — "sitemap OK but empty" is a different cause from "sitemap
 * fetch failed".
 */
export const DISCOVERY_BLOCKED_RETRIES = 2;
/** Long pauses between retries of a Cloudflare-blocked discovery fetch
 * (see src/lib/http.js BLOCKED_BACKOFF_MS). A per-retailer override lives
 * on config.discoveryBlockedBackoffMs (tests use tiny values). */
export const DISCOVERY_BLOCKED_BACKOFF_MS = [20000, 60000];

export async function listProductUrls(config, { maxPages = 5, minUrls = 0 } = {}) {
  const found = new Set();
  const seenSitemaps = new Set();
  const discoveryErrors = [];
  const blockedBackoffMs = config.discoveryBlockedBackoffMs || DISCOVERY_BLOCKED_BACKOFF_MS;
  const blockedRetries = config.discoveryBlockedRetries ?? DISCOVERY_BLOCKED_RETRIES;
  // Long pauses between retries of reset/terminated discovery fetches
  // (see src/lib/http.js errorBackoffMs). Per-retailer override lives
  // on config.discoveryErrorBackoffMs (tests use tiny values).
  const errorBackoffMs = config.discoveryErrorBackoffMs || DISCOVERY_BLOCKED_BACKOFF_MS;
  const recordError = (url, res) => {
    discoveryErrors.push({
      url,
      error: res?.error || (res ? `HTTP ${res.status}` : "fetch failed"),
      status: res?.status ?? null,
      blocked: !!res?.blocked,
    });
  };

  async function readSitemap(url) {
    if (seenSitemaps.has(url)) return;
    seenSitemaps.add(url);
    const res = await fetchText(url, {
      delayMs: config.crawlDelayMs,
      timeoutMs: SITEMAP_TIMEOUT_MS,
      blockedRetries,
      blockedBackoffMs,
      errorBackoffMs,
    });
    if (!res.ok) {
      recordError(url, res);
      return;
    }
    if (isSitemapIndex(res.html)) {
      let subCount = 0;
      for (const sub of parseSitemapUrls(res.html)) {
        if (sub.includes("product")) {
          subCount++;
          await readSitemap(sub);
        }
      }
      if (subCount === 0) discoveryErrors.push({ url, error: "sitemap index lists no product sitemaps", status: res.status, blocked: false });
      return;
    }
    const before = found.size;
    for (const u of parseSitemapUrls(res.html)) {
      if (config.isProductUrl ? config.isProductUrl(u) : true) found.add(u);
    }
    if (found.size === before) {
      discoveryErrors.push({ url, error: "sitemap fetched OK but yielded 0 product URLs", status: res.status, blocked: false });
    }
  }

  // PHASE 1 FIX (2026-11-08, Star Tech): sitemap-first discovery is
  // WRONG for Star Tech. Its single sitemap lists ~26,800 URLs whose
  // first ~4,000 are category/brand pages (e.g. /lifestyle,
  // /philips-trimmer) — the first real product (Ryzen 7 5700G) sits at
  // index 4,182 — so a run capped at 200 URLs fetched 200 category
  // pages, dropped them all at the product-page gate, and published 0.
  // For a retailer flagged discoveryMode: "category", crawl the category
  // listing pages FIRST (their product grid holds exactly 20 product
  // links per page) and only use the sitemap if that yields nothing.
  if (config.discoveryMode === "category") {
    await crawlCategories();
    if (found.size > 0) return { urls: [...found], discovery_errors: discoveryErrors };
  }

  for (const sm of config.sitemapUrls || []) await readSitemap(sm);
  if (found.size > 0) return { urls: [...found], discovery_errors: discoveryErrors };

  // Fallback: category pagination (clean ?page=N only — no sort/limit).
  await crawlCategories();
  return { urls: [...found], discovery_errors: discoveryErrors };

  // Category pagination shared by the category-first path above and the
  // sitemap fallback. Stops early once minUrls URLs are collected (a
  // limit-200 run needs ~11 pages of 20, not all 77), and stops a
  // category when a page adds no new links (end of pagination).
  // When config.listingSelector is set, links are collected ONLY inside
  // that container: a Star Tech /component page carries ~1,480 links in
  // its nav menus but only 20 product links inside .product-listing
  // (verified against the live page 2026-11-08). Without the scope, the
  // nav links would flood discovery with category pages.
  async function crawlCategories() {
    const pages = config.categoryPages ?? maxPages;
    for (const cat of config.categoryUrls || []) {
      for (let page = 1; page <= pages; page++) {
        if (minUrls > 0 && found.size >= minUrls) return;
        const url = page === 1 ? cat : `${cat}${cat.includes("?") ? "&" : "?"}page=${page}`;
        const res = await fetchText(url, {
          delayMs: config.crawlDelayMs,
          blockedRetries: 1,
          blockedBackoffMs: [30000],
          errorBackoffMs,
        });
        if (!res.ok) {
          recordError(url, res);
          break;
        }
        const $ = cheerio.load(res.html);
        const links = config.listingSelector
          ? $(config.listingSelector).find("a[href]")
          : $("a[href]");
        let added = 0;
        links.each((_, a) => {
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
      if (minUrls > 0 && found.size >= minUrls) return;
    }
  }
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
 *     Journal3 .product-price-new block, then the first price pair in
 *     the page body near a price label;
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

  // All visible-price regexes below run on the SCRIPT-STRIPPED body text
  // (see visibleBodyText): raw HTML / whole-document text contains
  // embedded JSON blobs whose "price":"12,980৳" is NOT a visible price
  // (Onix C920 live bug, 2026-11-08 — structured sources said 12,400).
  const bodyText = visibleBodyText(html);

  // --- visible regular price: the "Regular Price: X" label OpenCart
  // pages print next to the offer price (Sell Tech 7800X3D: 41,790;
  // Speed Tech C920: 13,375; Index IT HP P204v: 12,700 — all live,
  // 2026-11-08). Previously dropped: the parser never looked for this
  // label, so every product came back with regular_price null and no
  // savings %. reconcilePrices() still guards it (>80% discount drops it).
  let visibleRegular = null;
  const regularMatch = bodyText.match(/regular price[^0-9]{0,20}([\d,]+)\s*(?:৳|BDT|Tk)?/i);
  if (regularMatch) visibleRegular = parseAmount(regularMatch[1]);

  // --- Journal3 price group: .product-price-new (offer) /
  // .product-price-old (regular) — Creatus / Global Brand / UCC print
  // the offer and the old price in adjacent divs, and the generic label
  // regex below used to read a compare table's struck old price as the
  // offer (Creatus AR-7 live bug, 2026-11-08: 6,800 instead of 5,900).
  // Runs before the label fallback; the "latest price" sentence above
  // still wins when present.
  if (!visiblePrice) {
    const newPrice = parseAmount($(".product-price-new").first().text().trim());
    if (newPrice) {
      visiblePrice = newPrice;
      priceSources.push("visible:price-new");
      if (!visibleRegular) {
        const oldPrice = parseAmount($(".product-price-old").first().text().trim());
        if (oldPrice && oldPrice > newPrice) visibleRegular = oldPrice;
      }
    }
  }

  // --- then: price-like text in the main content (first pair wins) ---
  if (!visiblePrice) {
    // Look near a price label first, else take the first plausible pair.
    // The (?<!regular ) guard keeps a lone "Regular Price: X" line from
    // being misread as the offer price when no offer label is present.
    const labelled = bodyText.match(/(?<!regular )(?:price|offer price)[^0-9]{0,40}([\d,]+)\s*৳/i);
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
    // Script-stripped text again: a JSON blob can contain "out of stock"
    // for a different (related) product.
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
 * 20) — they are never published. `products` counts only parsed pages.
 * Discovery failures (sitemap fetch errors, empty sitemaps) are returned
 * in `discovery_errors` — a 0-product result always carries its cause. */
export async function scrapeRetailer(config, { limit = 50, onProduct = null } = {}) {
  const started = new Date().toISOString();
  // Dispatch: an adapter may override discovery and/or parsing on its
  // config (config.listProductUrls / config.parseProduct) — e.g. Nexus
  // (CS-Cart JSON-LD normalisation), Dolphin (Odoo microdata), Flora
  // (AJAX grid). Adapters that do not override fall back to the shared
  // OpenCart discovery/parser below. (Previously the overrides exported
  // by adapters were only honoured by scrape-live; the main scrape path
  // silently ignored them — e.g. pcbstore's Next.js gallery merge never
  // ran in production. Dispatching here makes the adapter pattern real.)
  const discover =
    typeof config.listProductUrls === "function" ? config.listProductUrls : listProductUrls;
  // Ask discovery for a few more URLs than the product cap: a handful of
  // discovered links are always category pages that the gate drops.
  const { urls, discovery_errors } = await discover(config, { minUrls: limit + 20 });
  const products = [];
  const errors = [];
  const droppedUrls = [];
  let dropped = 0;
  let blocked = 0;
  // DISPATCH (Phase 4, 2026-11-08): an adapter may override parseProduct
  // (e.g. DRM's JSON-LD-wins price correction, PCB Store's Next.js gallery
  // merge). Previously scrapeRetailer always called this module's own
  // parseProduct, so per-adapter overrides were dead code in production —
  // the live DRM test proved it (a ৳16,000 related-product price survived
  // despite the adapter's correction). A config without its own
  // parseProduct keeps the shared parser, so Tier-1 behaviour is unchanged.
  const parse =
    typeof config.parseProduct === "function" ? config.parseProduct : parseProduct;
  // PHASE 1 FIX (2026-11-08): the old `urls.slice(0, limit)` spent the
  // whole budget on the FIRST N discovered URLs. When those are category
  // pages (Star Tech sitemap) the run published 0 despite thousands of
  // product URLs sitting further down the list. Now the cap counts
  // PARSED products, not attempted URLs: dropped / errored / blocked
  // URLs do not consume the budget. maxAttempts bounds the total work
  // so a pathological list cannot run past the 15-minute background
  // limit (limit + 150 attempts at ~2 s each is ~8 min worst case for
  // limit 200, plus discovery).
  const maxAttempts = limit + 150;
  let attempts = 0;
  for (const url of urls) {
    if (products.length >= limit || attempts >= maxAttempts) break;
    attempts++;
    const res = await fetchText(url, { delayMs: config.crawlDelayMs });
    if (!res.ok) {
      if (res.blocked) blocked++;
      errors.push({ url, error: res.error || `HTTP ${res.status}` });
      continue;
    }
    try {
      const product = parse(config, res.html, url);
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
    // Discovery failures are kept separate from product-fetch errors:
    // a 0-product result must be diagnosable ("sitemap timed out" vs
    // "0 URLs discovered" vs "all URLs dropped by the product-page gate").
    discovery_errors: discovery_errors.slice(0, 20),
    errors: errors.slice(0, 20),
    items: products,
  };
}
