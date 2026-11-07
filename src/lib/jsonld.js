/**
 * jsonld.js — structured-data extraction.
 * No CSS selectors are used here: JSON-LD <script type="application/ld+json">
 * and Open Graph <meta property="product:*"> are the most reliable
 * machine-readable price/stock sources on these sites.
 *
 * WARNING (research): on Star Tech and PC House the OG/JSON-LD price is the
 * REGULAR price, not the offer price. Callers must reconcile it against the
 * visible price via price.reconcilePrices() — never use it alone.
 *
 * GALLERY IMAGES (extractGalleryImages): a product page usually exposes
 * more than the one OG image — OpenCart pages carry a thumbnail gallery
 * (each thumbnail links to a larger image file), JSON-LD Product.image
 * may be an array, and Next.js pages (PCB Store) serve images through
 * /_next/image?url=... or the /img/w.../q.../ proxy. This extractor
 * collects ALL of them, deduplicated, as absolute URLs. It never invents
 * a URL: every entry comes from the page itself. Logos, banners, icons
 * and payment badges are filtered out by path segment.
 */
import * as cheerio from "cheerio";

function asArray(v) {
  return Array.isArray(v) ? v : v === undefined || v === null ? [] : [v];
}

function findProduct(node) {
  if (!node || typeof node !== "object") return null;
  if (node["@type"] === "Product") return node;
  if (Array.isArray(node["@graph"])) {
    for (const n of node["@graph"]) {
      const hit = findProduct(n);
      if (hit) return hit;
    }
  }
  return null;
}

/** Resolve a possibly-relative URL against a base; returns null when unusable. */
export function absUrl(base, href) {
  if (!href || typeof href !== "string") return null;
  try {
    return new URL(href.trim(), base).toString();
  } catch {
    return null;
  }
}

const IMAGE_EXT_RE = /\.(?:jpe?g|png|webp|avif|gif)(?:[?#]|$)/i;
/** Path segments that mark an image as chrome, not a product photo. */
const NON_PRODUCT_RE = /(?:^|\/)(?:logo|logos|banner|banners|icon|icons|sprite|payment|payments|avatar|placeholder|advert|ads?|footer|header|badge|badges|brand-?logo|no-?image|default)(?:[-_./]|$)/i;

function isProductImageUrl(url) {
  if (!url || typeof url !== "string") return false;
  if (!/^https?:\/\//i.test(url)) return false;
  if (NON_PRODUCT_RE.test(url)) return false;
  return IMAGE_EXT_RE.test(url) || url.includes("/_next/image") || /\/img\/w\d+\/q\d+\//.test(url);
}

/** Decode a Next.js /_next/image?url=<encoded> optimiser URL to the real image URL. */
export function decodeNextImageUrl(raw, base) {
  if (!raw || !raw.includes("/_next/image")) return null;
  try {
    const u = new URL(raw, base);
    const inner = u.searchParams.get("url");
    if (!inner) return null;
    const decoded = absUrl(base, inner);
    return isProductImageUrl(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

/** Extract the first JSON-LD Product object, if any. Returns null when absent. */
export function extractJsonLd(html) {
  const $ = cheerio.load(html || "");
  let product = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (product) return;
    try {
      const data = JSON.parse($(el).text());
      for (const item of asArray(data)) {
        const hit = findProduct(item);
        if (hit) {
          product = hit;
          return;
        }
      }
    } catch {
      // Malformed JSON-LD block — ignore it, other sources may still work.
    }
  });
  if (!product) return null;

  const offers = asArray(product.offers)[0] || {};
  const price =
    offers.price !== undefined && offers.price !== null ? Number(offers.price) : null;
  const availability = String(offers.availability || product.availability || "");
  const images = asArray(product.image).filter((i) => typeof i === "string" && i);
  return {
    name: product.name || null,
    description: product.description || null,
    image: images[0] || null,
    images,
    price: Number.isFinite(price) && price > 0 ? price : null,
    currency: offers.priceCurrency || product.currency || "BDT",
    availability,
    stock: /OutOfStock/i.test(availability)
      ? "out_of_stock"
      : /InStock/i.test(availability)
        ? "in_stock"
        : "unknown",
    brand: product.brand?.name || product.brand || null,
  };
}

/** Extract Open Graph product meta: product:price:amount, availability, image, title. */
export function extractOpenGraph(html) {
  const $ = cheerio.load(html || "");
  const meta = (prop) => $(`meta[property="${prop}"]`).attr("content") || null;
  const priceRaw = meta("product:price:amount");
  const price = priceRaw !== null ? Number(priceRaw) : null;
  const availability = meta("product:availability") || meta("og:availability") || "";
  return {
    title: meta("og:title"),
    type: meta("og:type"),
    image: meta("og:image"),
    description: meta("og:description"),
    price: Number.isFinite(price) && price > 0 ? price : null,
    currency: meta("product:price:currency") || "BDT",
    availability,
    stock: /outofstock/i.test(availability)
      ? "out_of_stock"
      : /instock/i.test(availability)
        ? "in_stock"
        : "unknown",
  };
}

/**
 * isProductPage — the structured-data gate (BUG 1 fix, 2026-11-07 live run).
 * Sitemaps list category/guide pages alongside real products (e.g. Star
 * Tech's /lifestyle and /blood-pressure-monitor), and a category page can
 * contain price-like text ("45৳") that the old parser happily turned into
 * a "product". A page is a product page ONLY when it carries structured
 * product evidence:
 *   - JSON-LD Product WITH offers (price or availability present), OR
 *   - Open Graph og:type=product, OR
 *   - Open Graph product:price:amount.
 * Anything else is dropped by the caller (parseProduct returns null) —
 * never published, never counted as a product. URL heuristics alone
 * cannot tell a category slug from a product slug, so this gate is the
 * primary defence. Returns { isProduct, evidence } for logging.
 */
export function isProductPage(html) {
  const ld = extractJsonLd(html);
  if (ld && (ld.price !== null || Boolean(ld.availability))) {
    return { isProduct: true, evidence: "jsonld:Product with offers" };
  }
  const og = extractOpenGraph(html);
  if (og.type && og.type.toLowerCase() === "product") {
    return { isProduct: true, evidence: "og:type=product" };
  }
  if (og.price !== null) {
    return { isProduct: true, evidence: "og:product:price:amount" };
  }
  return { isProduct: false, evidence: "no JSON-LD Product offers, no og:type=product, no og product price" };
}

/**
 * Canonical image directory of an image URL, for the gallery rule below.
 * PCB Store serves the same underlying file two ways — the /img/w<w>/q<q>/
 * proxy and the raw /storage/... path — so the proxy prefix is stripped
 * first; otherwise the primary image and its own gallery images would
 * look like they live in different folders. /_next/image optimiser URLs
 * are decoded to the real image URL before the directory is taken.
 */
export function canonicalImageDir(rawUrl, baseUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  let url = rawUrl.trim();
  if (url.includes("/_next/image")) {
    const decoded = decodeNextImageUrl(url, baseUrl);
    if (!decoded) return null;
    url = decoded;
  }
  try {
    const u = new URL(url, baseUrl);
    let p = decodeURIComponent(u.pathname);
    p = p.replace(/^\/img\/w\d+\/q\d+/, "");
    const i = p.lastIndexOf("/");
    return i > 0 ? p.slice(0, i) : "/";
  } catch {
    return null;
  }
}

/** Class tokens that mark an element as the product's own image gallery. */
const GALLERY_CLASS_RE = /(^|\s)(product-images?|image-gallery|product-gallery|gallery|thumbnails|image-additional|additional-images)(\s|$)/i;

function isGalleryContainer(el, $) {
  const cls = $(el).attr("class") || "";
  return GALLERY_CLASS_RE.test(cls);
}

/**
 * Extract the product's OWN gallery images, deduplicated, absolute.
 * BUG 2 fix (2026-11-07 live run): the old extractor took EVERY <img> on
 * the page, so images[] included related-products thumbnails (Star Tech
 * 5700G page: i7-10700, Ryzen 7 5800X, Ryzen 5 5600G 80x80 thumbs) that
 * are NOT this product's gallery. Now an image is kept ONLY if:
 *  1. it is a structured source — og:image / og:image:secure_url /
 *     JSON-LD Product.image (these are the product's own by definition), or
 *  2. it lives inside the product's own image-gallery container
 *     (class contains product-image(s), image-gallery, gallery,
 *     thumbnails, image-additional), or
 *  3. it shares the primary image's canonical directory — OpenCart
 *     stores a product's images in one catalog subfolder
 *     (…/processor/amd/ryzen-7-5700ge/) while related products live in
 *     other subfolders, so directory equality separates them.
 * Logos, banners, ads and icons are still filtered by path segment, and
 * no URL is ever invented — every entry comes from the page itself.
 * Returns [] when the page exposes no product image at all.
 */
export function extractGalleryImages(html, baseUrl) {
  const $ = cheerio.load(html || "");
  const seen = new Set();
  const out = [];
  const push = (raw) => {
    if (!raw || typeof raw !== "string") return;
    let url = raw.trim();
    if (!url) return;
    if (url.startsWith("//")) url = `https:${url}`;
    if (url.includes("/_next/image")) {
      const decoded = decodeNextImageUrl(url, baseUrl);
      if (decoded) push(decoded);
      return;
    }
    const abs = absUrl(baseUrl, url);
    if (!abs || seen.has(abs)) return;
    if (!isProductImageUrl(abs)) return;
    seen.add(abs);
    out.push(abs);
  };

  // 1. Structured sources first — the canonical product images. The
  // primary image's directory anchors rule 3 below.
  const og = extractOpenGraph(html);
  if (og.image) push(og.image);
  const ogSecure = $('meta[property="og:image:secure_url"]').attr("content");
  if (ogSecure) push(ogSecure);
  const ld = extractJsonLd(html);
  for (const img of ld?.images || []) push(img);
  if (ld?.image) push(ld.image);
  const primaryDir = canonicalImageDir(og.image || ld?.image || null, baseUrl);
  const sameDir = (raw) => {
    if (!primaryDir) return false;
    const dir = canonicalImageDir(raw, baseUrl);
    return dir !== null && dir === primaryDir;
  };

  // 2. Images inside the product's own gallery container (any directory).
  // NOTE: a "related products" block must NOT match — its class tokens
  // are "related-products"/"related", which GALLERY_CLASS_RE does not match.
  $("img").each((_, img) => {
    let inGallery = false;
    $(img)
      .parents()
      .each((__, ancestor) => {
        if (isGalleryContainer(ancestor, $)) inGallery = true;
      });
    if (!inGallery) return;
    push($(img).attr("src") || $(img).attr("data-src") || $(img).attr("data-lazy-src"));
    const srcset = $(img).attr("srcset") || $(img).attr("data-srcset") || "";
    for (const part of srcset.split(",")) {
      const candidate = part.trim().split(/\s+/)[0];
      if (candidate) push(candidate);
    }
  });
  $("a[href]").each((_, a) => {
    let inGallery = false;
    $(a)
      .parents()
      .each((__, ancestor) => {
        if (isGalleryContainer(ancestor, $)) inGallery = true;
      });
    if (!inGallery) return;
    const href = $(a).attr("href");
    if (href && IMAGE_EXT_RE.test(href)) push(href);
  });

  // 3. All other <img> / <a> / embedded-URL candidates: same directory
  // as the primary image only. When there is no primary image (no
  // og:image / JSON-LD image), there is no directory to anchor on, so
  // nothing outside the gallery container is accepted.
  $("img").each((_, img) => {
    const src = $(img).attr("src") || $(img).attr("data-src") || $(img).attr("data-lazy-src");
    if (src && sameDir(src)) push(src);
    const srcset = $(img).attr("srcset") || $(img).attr("data-srcset") || "";
    for (const part of srcset.split(",")) {
      const candidate = part.trim().split(/\s+/)[0];
      if (candidate && sameDir(candidate)) push(candidate);
    }
  });
  $('a[href]').each((_, a) => {
    const href = $(a).attr("href");
    if (href && IMAGE_EXT_RE.test(href) && sameDir(href)) push(href);
  });
  const raw = String(html || "");
  for (const m of raw.matchAll(/\/_next\/image\?url=([^"'&\s]+)/g)) {
    try {
      const decoded = decodeURIComponent(m[1]);
      if (sameDir(decoded)) push(decoded);
    } catch {
      // Undecodable — skip, other sources may still cover it.
    }
  }
  for (const m of raw.matchAll(/["'`](https?:\/\/[^"'`\s]+?\.(?:jpe?g|png|webp|avif))["'`]/gi)) {
    if (sameDir(m[1])) push(m[1]);
  }
  for (const m of raw.matchAll(/["'`](\/img\/w\d+\/q\d+\/[^"'`\s]+?\.(?:jpe?g|png|webp|avif))["'`]/gi)) {
    if (sameDir(m[1])) push(m[1]);
  }

  return out;
}

/** PCB Store (Next.js) gallery: same extractor, kept as a named entry point for the adapter. */
export function extractNextJsImages(html, baseUrl) {
  return extractGalleryImages(html, baseUrl);
}

/**
 * Extract a specification table by heading text, not by class name.
 * Finds any heading containing "Specification" (case-insensitive), then
 * reads the first <table> after it; also reads any table whose rows look
 * like key | value pairs. Group headings (a row with a single cell, or a
 * <th colspan>) become group names in the returned object.
 * Returns {} when no spec table is found.
 */
export function extractSpecTable(html) {
  const $ = cheerio.load(html || "");
  const specs = {};
  const tables = [];
  $("table").each((_, table) => {
    const rows = [];
    $(table)
      .find("tr")
      .each((__, tr) => {
        const cells = $(tr)
          .find("th, td")
          .map((___, c) => $(c).text().trim())
          .get()
          .filter(Boolean);
        if (cells.length) rows.push(cells);
      });
    if (rows.length >= 2) tables.push(rows);
  });
  // Prefer a table that follows a "Specification" heading; otherwise the
  // largest key|value-looking table.
  let chosen = null;
  $("h1, h2, h3, h4, h5").each((_, h) => {
    if (/specification/i.test($(h).text()) && !chosen) {
      const next = $(h).nextAll("table").first();
      if (next.length) {
        const rows = [];
        next.find("tr").each((__, tr) => {
          const cells = $(tr).find("th, td").map((___, c) => $(c).text().trim()).get().filter(Boolean);
          if (cells.length) rows.push(cells);
        });
        if (rows.length >= 2) chosen = rows;
      }
    }
  });
  if (!chosen && tables.length) {
    chosen = tables.sort((a, b) => b.length - a.length)[0];
  }
  if (!chosen) return specs;
  let group = "General";
  for (const cells of chosen) {
    if (cells.length === 1) {
      group = cells[0];
      specs[group] = specs[group] || {};
    } else {
      const [key, ...rest] = cells;
      if (!key) continue;
      if (!specs[group] || typeof specs[group] !== "object") specs[group] = {};
      specs[group][key] = rest.join(" ").trim();
    }
  }
  // Flatten when there was only one group and it is "General".
  if (Object.keys(specs).length === 1 && specs.General) return specs.General;
  return specs;
}

/**
 * Extract the description: prefer the block after a "Description" heading,
 * else the meta description, else the longest paragraph block.
 * Returns plain text (tags stripped), capped at 4000 chars.
 */
export function extractDescription(html) {
  const $ = cheerio.load(html || "");
  let text = "";
  $("h1, h2, h3, h4, h5").each((_, h) => {
    if (/^description$/i.test($(h).text().trim()) && !text) {
      const parts = [];
      $(h)
        .nextAll("p, div, ul")
        .slice(0, 8)
        .each((__, el) => {
          const t = $(el).text().trim();
          if (t) parts.push(t);
        });
      text = parts.join("\n");
    }
  });
  if (!text) text = $('meta[name="description"]').attr("content") || "";
  if (!text) {
    const paras = $("p")
      .map((_, p) => $(p).text().trim())
      .get()
      .filter((t) => t.length > 80);
    text = paras.slice(0, 3).join("\n");
  }
  return text.replace(/\s+/g, " ").trim().slice(0, 4000) || null;
}

/** The visible "latest price … is X" sentence many OpenCart sites print. Returns the amount or null. */
export function extractLatestPriceSentence(html) {
  const $ = cheerio.load(html || "");
  const body = $.text();
  // "The latest price of AMD Ryzen 7 5700G … is 20,600৳" — the "is" before
  // the amount is essential: without it the regex would match the model
  // number (5700) instead of the price.
  const m = body.match(/latest price of[\s\S]{0,200}?is\s+([\d,]+)\s*(?:৳|BDT|Tk)/i);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}
