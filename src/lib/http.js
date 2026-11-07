/**
 * http.js — polite fetching.
 * - Browser-like User-Agent (these are public retail pages, not an API).
 * - Per-retailer crawl delay (robots.txt). Ultra Technology declares
 *   Crawl-Delay: 20 — that is 20 SECONDS between requests; the Ultra
 *   adapter therefore crawls very slowly by design. Do not "optimise"
 *   that away or the site will block the scraper.
 * - 2 retries on 429/5xx with back-off. A 403/Cloudflare challenge page
 *   is detected (body contains "One moment, please" / "Attention Required")
 *   and reported as blocked, never parsed as a product.
 * - PHASE 1 FIX (2026-11-08): Cloudflare blocks on Ryans + Techland are
 *   TRANSIENT and rate-based -- live from this VM, node fetch got 403 /
 *   "Just a moment" repeatedly, then the identical request returned 200
 *   after a ~60-90 s pause (curl with identical headers behaved the same
 *   way, so it is not a header problem). The old code gave up on the
 *   FIRST challenge and the whole retailer failed with 0 URLs. fetchText
 *   therefore retries blocked responses with a LONG back-off when the
 *   caller asks for it (blockedRetries / blockedBackoffMs) -- discovery
 *   opts in, product-page fetches do not (fail fast, count blocked).
 *   A bare HTTP 403 is treated as a block too: Cloudflare's bot pages
 *   are served as 403s, and a 403 from a retailer sitemap/product page
 *   is never a "page does not exist" signal.
 */
export const BLOCKED_BACKOFF_MS = [20000, 60000];


export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function isChallengePage(html) {
  if (!html) return false;
  return (
    html.includes("One moment, please") ||
    html.includes("Just a moment...") ||
    html.includes("Attention Required") ||
    html.includes("cf-browser-verification") ||
    html.includes("Please wait while your request is being verified")
  );
}

/**
 * Fetch a URL as text. Returns { ok, status, html, blocked, error }.
 * `delayMs` is the polite delay to wait BEFORE this request.
 */
export async function fetchText(
  url,
  {
    delayMs = 1500,
    timeoutMs = 20000,
    retries = 2,
    // Retries reserved for Cloudflare-blocked responses (challenge page or
    // HTTP 403). Default 0: product-page fetches fail fast and are counted
    // as blocked. Discovery passes blockedRetries: 2 with the long
    // BLOCKED_BACKOFF_MS pauses, because a block is usually a rate-limit
    // window that clears within ~60-90 s (verified live, Ryans/Techland).
    blockedRetries = 0,
    blockedBackoffMs = BLOCKED_BACKOFF_MS,
    // Pause between retries of NETWORK errors (reset / terminated /
    // timeout). Default is the old 3 s / 6 s ladder. Discovery passes
    // [20000, 60000]: Ryans' live failure was "terminated" (the
    // connection reset, no HTTP status at all), i.e. the same Cloudflare
    // block surfacing as a reset instead of a challenge page — a 3 s
    // retry just hits the same closed door.
    errorBackoffMs = null,
  } = {}
) {
  if (delayMs > 0) await sleep(delayMs);
  let lastError = null;
  let blockedAttempts = 0;
  for (let attempt = 0; attempt <= retries + blockedRetries; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(url, {
        headers: {
          "User-Agent": BROWSER_UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal: ctrl.signal,
        redirect: "follow",
      });
      clearTimeout(timer);
      const html = await res.text();
      if (isChallengePage(html) || res.status === 403) {
        // Cloudflare block. Retry with a long pause when the caller opted
        // in (discovery); otherwise report it once and let the caller
        // decide. The body is never parsed as content.
        if (blockedAttempts < blockedRetries) {
          const wait = blockedBackoffMs[Math.min(blockedAttempts, blockedBackoffMs.length - 1)];
          blockedAttempts++;
          await sleep(wait);
          continue;
        }
        return { ok: false, status: res.status, html: "", blocked: true, error: "cloudflare_challenge" };
      }
      if (res.status === 429 || res.status >= 500) {
        lastError = `HTTP ${res.status}`;
        if (attempt < retries) await sleep(5000 * (attempt + 1));
        continue;
      }
      if (!res.ok) return { ok: false, status: res.status, html: "", blocked: false, error: `HTTP ${res.status}` };
      return { ok: true, status: res.status, html, blocked: false, error: null };
    } catch (e) {
      lastError = e.name === "AbortError" ? "timeout" : String(e.message || e);
      if (attempt < retries) {
        const wait = errorBackoffMs
          ? errorBackoffMs[Math.min(attempt, errorBackoffMs.length - 1)]
          : 3000 * (attempt + 1);
        await sleep(wait);
      }
    }
  }
  return { ok: false, status: 0, html: "", blocked: false, error: lastError || "fetch_failed" };
}

/**
 * POST a form-urlencoded body and return the response as text.
 * Same UA / challenge detection / retries as fetchText. Used by Flora
 * Limited, whose product grid is loaded by POST /product/_gridclient
 * (the category page HTML itself contains no products or prices).
 * Returns { ok, status, html, blocked, error } like fetchText.
 */
export async function postForm(url, params, { delayMs = 1500, timeoutMs = 30000, retries = 2 } = {}) {
  if (delayMs > 0) await sleep(delayMs);
  const body = new URLSearchParams(params).toString();
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "User-Agent": BROWSER_UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
        signal: ctrl.signal,
        redirect: "follow",
      });
      clearTimeout(timer);
      const html = await res.text();
      if (isChallengePage(html)) {
        return { ok: false, status: res.status, html: "", blocked: true, error: "cloudflare_challenge" };
      }
      if (res.status === 429 || res.status >= 500) {
        lastError = `HTTP ${res.status}`;
        if (attempt < retries) await sleep(5000 * (attempt + 1));
        continue;
      }
      if (!res.ok) return { ok: false, status: res.status, html: "", blocked: false, error: `HTTP ${res.status}` };
      return { ok: true, status: res.status, html, blocked: false, error: null };
    } catch (e) {
      lastError = e.name === "AbortError" ? "timeout" : String(e.message || e);
      if (attempt < retries) await sleep(3000 * (attempt + 1));
    }
  }
  return { ok: false, status: 0, html: "", blocked: false, error: lastError || "fetch_failed" };
}

/** Parse a sitemap (single file or index) and return all <loc> URLs. */
export function parseSitemapUrls(xml) {
  const urls = [];
  for (const m of String(xml).matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)) {
    urls.push(m[1].trim());
  }
  return [...new Set(urls)];
}

/** True when a sitemap XML is an index (contains <sitemap> entries). */
export function isSitemapIndex(xml) {
  return /<sitemap[\s>]/.test(String(xml));
}
