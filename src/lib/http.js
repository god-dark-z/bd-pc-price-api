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
 */

export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function isChallengePage(html) {
  if (!html) return false;
  return (
    html.includes("One moment, please") ||
    html.includes("Attention Required") ||
    html.includes("cf-browser-verification") ||
    html.includes("Please wait while your request is being verified")
  );
}

/**
 * Fetch a URL as text. Returns { ok, status, html, blocked, error }.
 * `delayMs` is the polite delay to wait BEFORE this request.
 */
export async function fetchText(url, { delayMs = 1500, timeoutMs = 20000, retries = 2 } = {}) {
  if (delayMs > 0) await sleep(delayMs);
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
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
