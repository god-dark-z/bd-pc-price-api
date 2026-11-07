/**
 * Phase 1 fixes (2026-11-08) — regression tests for the four failed Tier-1
 * retailers in the 00:20 Dhaka live run (startech, ryans, techland, pchouse
 * all returned 0 publishable products).
 *
 * Root causes + what each test pins down:
 *  1. Ryans / Techland — Cloudflare blocks are TRANSIENT and rate-based:
 *     node fetch got 403 / "Just a moment" repeatedly, then the identical
 *     request returned 200 after a ~60-90 s pause. The old fetchText gave
 *     up on the first challenge. Tests: fetchText retries a challenge
 *     (and a bare 403) with a long back-off when the caller opts in, and
 *     still fails fast with blocked:true when it does not; listProductUrls
 *     recovers from a flaky sitemap that challenges twice then serves XML.
 *  2. Star Tech — its sitemap's first ~4,000 URLs are category/brand
 *     pages (first real product at index 4,182), so sitemap-first +
 *     slice(0, limit) published 0. Discovery is now category-first for
 *     Star Tech, scoped to the .product-listing grid (verified live:
 *     20 product links per page; the page nav alone carries ~1,480
 *     links). Test: category-first collects only product links and never
 *     touches the sitemap.
 *  3. Shared — scrapeRetailer capped ATTEMPTED urls (slice(0, limit)),
 *     so dropped category pages consumed the whole budget. The cap now
 *     counts PARSED products. Test: a sitemap whose first URL is a
 *     category page still yields `limit` products.
 *
 * All tests use a local HTTP server on 127.0.0.1 (no external network).
 * Run: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchText } from "../src/lib/http.js";
import { listProductUrls, scrapeRetailer } from "../src/scrapers/opencart.js";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const categoryHtml = readFileSync(join(FIX, "category-page.html"), "utf8");
const productHtml = readFileSync(join(FIX, "opencart-product.html"), "utf8");
const componentHtml = readFileSync(join(FIX, "startech-component.html"), "utf8");

const CHALLENGE_BODY =
  '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>One moment, please</body></html>';

/** Start a local server; `routes` maps "METHOD path" to a handler (req, res, hits). */
async function startServer(routes) {
  const hits = {};
  const server = createServer((req, res) => {
    const key = `${req.method} ${req.url}`;
    hits[key] = (hits[key] || 0) + 1;
    const handler = routes[key] || routes[req.url];
    if (handler) return handler(req, res, hits[key]);
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  return { server, base: `http://127.0.0.1:${port}`, hits };
}

// --- 1. Cloudflare-block retries (Ryans / Techland) ---

test("fetchText retries a Cloudflare challenge with back-off and then succeeds", async () => {
  const { server, base, hits } = await startServer({
    "/flaky": (_req, res, n) => {
      if (n <= 2) {
        res.writeHead(403, { "Content-Type": "text/html" });
        res.end(CHALLENGE_BODY);
      } else {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("OK");
      }
    },
  });
  try {
    const r = await fetchText(`${base}/flaky`, {
      delayMs: 0,
      blockedRetries: 2,
      blockedBackoffMs: [5, 5],
    });
    assert.equal(r.ok, true);
    assert.equal(r.html, "OK");
    assert.equal(hits["GET /flaky"], 3, "two challenges + one success");
  } finally {
    server.close();
  }
});

test("fetchText treats a bare HTTP 403 as a block (Cloudflare bot pages are 403s)", async () => {
  const { server, base, hits } = await startServer({
    "/forbidden": (_req, res) => {
      res.writeHead(403, { "Content-Type": "text/html" });
      res.end("<html><body>Forbidden</body></html>");
    },
  });
  try {
    const r = await fetchText(`${base}/forbidden`, {
      delayMs: 0,
      blockedRetries: 2,
      blockedBackoffMs: [5, 5],
    });
    assert.equal(r.ok, false);
    assert.equal(r.blocked, true);
    assert.equal(r.error, "cloudflare_challenge");
    assert.equal(hits["GET /forbidden"], 3, "bare 403 is retried like a challenge");
  } finally {
    server.close();
  }
});

test("fetchText retries reset connections with the long error back-off (Ryans terminated)", async () => {
  const { server, base, hits } = await startServer({
    "/resetty": (_req, res, n) => {
      if (n <= 2) {
        // Connection reset, no HTTP status — what Ryans returned live.
        res.socket.destroy();
      } else {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("OK");
      }
    },
  });
  try {
    const r = await fetchText(`${base}/resetty`, {
      delayMs: 0,
      retries: 2,
      errorBackoffMs: [5, 5],
    });
    assert.equal(r.ok, true);
    assert.equal(r.html, "OK");
    assert.equal(hits["GET /resetty"], 3, "two resets + one success");
  } finally {
    server.close();
  }
});

test("fetchText fails fast on a challenge when the caller does not opt into retries", async () => {
  const { server, base, hits } = await startServer({
    "/blocked": (_req, res) => {
      res.writeHead(403, { "Content-Type": "text/html" });
      res.end(CHALLENGE_BODY);
    },
  });
  try {
    const r = await fetchText(`${base}/blocked`, { delayMs: 0 });
    assert.equal(r.ok, false);
    assert.equal(r.blocked, true);
    assert.equal(r.error, "cloudflare_challenge");
    assert.equal(hits["GET /blocked"], 1, "product-page fetches must not burn time retrying");
  } finally {
    server.close();
  }
});

test("listProductUrls recovers when the sitemap challenges twice then serves XML (Ryans/Techland)", async () => {
  const { server, base, hits } = await startServer({
    "/sitemap.xml": (_req, res, n) => {
      if (n <= 2) {
        res.writeHead(403, { "Content-Type": "text/html" });
        res.end(CHALLENGE_BODY);
      } else {
        res.writeHead(200, { "Content-Type": "application/xml" });
        res.end(
          `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
            `<url><loc>${base}/amd-ryzen-7-5700g-processor</loc></url>` +
            `<url><loc>${base}/deepcool-ck-11509-cpu-cooler</loc></url></urlset>`
        );
      }
    },
  });
  try {
    const config = {
      id: "flakytest",
      name: "Flaky Test",
      baseUrl: base,
      sitemapUrls: [`${base}/sitemap.xml`],
      categoryUrls: [],
      crawlDelayMs: 0,
      discoveryBlockedBackoffMs: [5, 5],
      isProductUrl: (u) => u.startsWith(base),
    };
    const { urls, discovery_errors } = await listProductUrls(config);
    assert.equal(hits["GET /sitemap.xml"], 3);
    assert.deepEqual(urls.sort(), [`${base}/amd-ryzen-7-5700g-processor`, `${base}/deepcool-ck-11509-cpu-cooler`].sort());
    assert.equal(discovery_errors.length, 0, "a recovered sitemap leaves no discovery error");
  } finally {
    server.close();
  }
});

// --- 2. Star Tech category-first discovery, scoped to .product-listing ---

test("listProductUrls (category-first) collects only product links and never fetches the sitemap", async () => {
  const page2Html = componentHtml.replace(
    "deepcool-ck-11509-cpu-cooler",
    "arctic-p12-silent-casing-fan"
  );
  const { server, base, hits } = await startServer({
    "/component": (_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(componentHtml.replaceAll("https://www.startech.com.bd", base));
    },
    "/component?page=2": (_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(page2Html.replaceAll("https://www.startech.com.bd", base));
    },
    "/sitemap.xml": (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/xml" });
      res.end("<urlset></urlset>");
    },
  });
  try {
    const config = {
      id: "startech",
      name: "Star Tech",
      baseUrl: base,
      sitemapUrls: [`${base}/sitemap.xml`],
      categoryUrls: [`${base}/component`],
      crawlDelayMs: 0,
      discoveryMode: "category",
      categoryPages: 80,
      listingSelector: ".product-listing",
      isProductUrl: (u) =>
        u.startsWith(base) && !u.includes("/component") && !u.includes("?"),
    };
    // Page 1 yields 2 products + 1 stray nav link (/desktops — it sits
    // inside .product-listing and passes isProductUrl; the product-page
    // gate drops it at scrape time, which is why the scrape cap counts
    // parsed products, not attempted URLs). minUrls=4 forces page 2.
    const { urls, discovery_errors } = await listProductUrls(config, { minUrls: 4 });
    assert.equal(hits["GET /sitemap.xml"] || 0, 0, "category-first must not touch the sitemap");
    assert.equal(hits["GET /component?page=2"], 1, "minUrls=4 forces a second listing page");
    assert.deepEqual(
      urls.sort(),
      [
        `${base}/deepcool-ck-11509-cpu-cooler`,
        `${base}/amd-ryzen-7-5700g-processor`,
        `${base}/arctic-p12-silent-casing-fan`,
        `${base}/desktops`,
      ].sort()
    );
    assert.equal(discovery_errors.length, 0);
  } finally {
    server.close();
  }
});

// --- 3. scrapeRetailer cap counts parsed products, not attempted URLs ---

test("scrapeRetailer still yields `limit` products when the first sitemap URL is a dropped category page", async () => {
  const { server, base } = await startServer({
    "/sitemap.xml": (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/xml" });
      res.end(
        `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
          `<url><loc>${base}/lifestyle</loc></url>` +
          `<url><loc>${base}/amd-ryzen-7-5700g-processor</loc></url>` +
          `<url><loc>${base}/deepcool-ck-11509-cpu-cooler</loc></url></urlset>`
      );
    },
    "/lifestyle": (_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(categoryHtml);
    },
    "/amd-ryzen-7-5700g-processor": (_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(productHtml);
    },
    "/deepcool-ck-11509-cpu-cooler": (_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(productHtml);
    },
  });
  try {
    const config = {
      id: "slicetest",
      name: "Slice Test",
      baseUrl: base,
      sitemapUrls: [`${base}/sitemap.xml`],
      categoryUrls: [],
      crawlDelayMs: 0,
      isProductUrl: (u) => u.startsWith(base),
    };
    const result = await scrapeRetailer(config, { limit: 2 });
    assert.equal(result.urls_found, 3);
    assert.equal(result.dropped, 1, "the /lifestyle category page is dropped by the gate");
    assert.equal(result.products, 2, "the cap counts parsed products, not attempted URLs");
    assert.equal(result.items.length, 2);
  } finally {
    server.close();
  }
});
