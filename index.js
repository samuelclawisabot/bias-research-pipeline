#!/usr/bin/env node
// BIAS. Research Pipeline — Daily Scraper
// Outputs JSON: { wakeAgent: true, data: { date, articles, sourceStats, uniqlo, biasHistory } }
// Product sourcing: Uniqlo only (Gap, Old Navy, AE block automated access)

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const DIGESTS_DIR = join(DATA_DIR, 'digests');
const BIAS_HISTORY_FILE = join(DATA_DIR, 'bias_history.json');
const UNIQLO_CACHE_FILE = join(DATA_DIR, 'uniqlo_cache.json');
const UNIQLO_REFRESH_DAYS = 3;

[DATA_DIR, DIGESTS_DIR].forEach(d => { if (!existsSync(d)) mkdirSync(d, { recursive: true }); });

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

async function fetchPage(url, timeout = 20000) {
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeout) });
    if (!res.ok) return { ok: false, html: null, status: res.status };
    return { ok: true, html: await res.text(), status: res.status };
  } catch (e) {
    return { ok: false, html: null, error: e.message };
  }
}

function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractArticles(html, source) {
  if (!html) return [];
  const articles = [];
  const seen = new Set();

  const add = (title, url = null) => {
    const clean = decodeHtmlEntities(title);
    if (clean.length >= 25 && clean.length <= 200 && !seen.has(clean)) {
      seen.add(clean);
      const fullUrl = url && url.startsWith('http') ? url
        : url && url.startsWith('/') ? `https://${new URL(url.startsWith('http') ? url : `https://example.com${url}`).hostname}${url}` : null;
      articles.push({ source, title: clean, url: fullUrl });
    }
  };

  // Strategy 1: JSON-LD structured data (most reliable)
  for (const match of [...html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)]) {
    try {
      const data = JSON.parse(match[1]);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item.headline) add(item.headline, item.url || item.mainEntityOfPage?.['@id']);
        if (item['@type'] === 'ItemList') {
          for (const el of (item.itemListElement || [])) {
            if (el.name) add(el.name, el.url);
            if (el.item?.name) add(el.item.name, el.item.url);
          }
        }
      }
    } catch (e) {}
  }

  // Strategy 2: Next.js __NEXT_DATA__ embedded JSON
  if (articles.length < 4) {
    const nextMatch = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
    if (nextMatch) {
      try {
        const nextData = JSON.parse(nextMatch[1]);
        const walk = (obj, depth = 0) => {
          if (depth > 8 || !obj || typeof obj !== 'object') return;
          if (obj.title && typeof obj.title === 'string' && obj.slug) {
            add(obj.title, obj.url || obj.slug);
          }
          if (obj.headline && typeof obj.headline === 'string') {
            add(obj.headline, obj.url);
          }
          for (const v of Object.values(obj)) walk(v, depth + 1);
        };
        walk(nextData);
      } catch (e) {}
    }
  }

  // Strategy 3: h2/h3 tags
  if (articles.length < 4) {
    for (const match of [...html.matchAll(/<h[23][^>]*>([^<]{25,180})<\/h[23]>/gi)].slice(0, 25)) {
      add(match[1]);
    }
  }

  // Strategy 4: anchor text (last resort)
  if (articles.length < 4) {
    for (const match of [...html.matchAll(/<a[^>]+href="([^"]{5,})"[^>]*>\s*([^<]{30,160})\s*<\/a>/gi)].slice(0, 40)) {
      add(match[2], match[1]);
    }
  }

  return articles.slice(0, 10);
}

async function scrapeGQ() {
  const { ok, html } = await fetchPage('https://www.gq.com/style');
  if (!ok || !html) return [];
  const articles = extractArticles(html, 'GQ');
  // GQ-specific: look for story links with titles
  if (articles.length < 3) {
    for (const match of [...html.matchAll(/href="(\/story\/[^"]+)"[^>]*>\s*([^<]{25,160})\s*</gi)].slice(0, 15)) {
      const title = decodeHtmlEntities(match[2]);
      if (title.length >= 25) articles.push({ source: 'GQ', title, url: `https://www.gq.com${match[1]}` });
    }
  }
  return articles.slice(0, 10);
}

async function scrapeHighsnobiety() {
  const { ok, html } = await fetchPage('https://www.highsnobiety.com/style/');
  if (!ok || !html) return [];

  // Highsnobiety renders article cards with empty <a> links + aria-labelledby.
  // Titles are in <span data-cy="teaser-headline"> siblings; links are in href="/p/slug" anchors.
  const articles = [];
  const seen = new Set();

  // Extract all teaser headlines with their paired /p/ slugs
  const teaserRegex = /data-cy="teaser-headline">([^<]{15,180})<\/span>[\s\S]{0,600}?href="(\/p\/[^"]+)"/g;
  for (const match of [...html.matchAll(teaserRegex)].slice(0, 15)) {
    const title = decodeHtmlEntities(match[1]);
    if (!seen.has(title)) {
      seen.add(title);
      articles.push({ source: 'Highsnobiety', title, url: `https://www.highsnobiety.com${match[2]}` });
    }
  }

  // Fallback: reverse order (link before headline in some card layouts)
  if (articles.length < 3) {
    const reverseRegex = /href="(\/p\/[^"]+)"[\s\S]{0,600}?data-cy="teaser-headline">([^<]{15,180})<\/span>/g;
    for (const match of [...html.matchAll(reverseRegex)].slice(0, 15)) {
      const title = decodeHtmlEntities(match[2]);
      if (!seen.has(title)) {
        seen.add(title);
        articles.push({ source: 'Highsnobiety', title, url: `https://www.highsnobiety.com${match[1]}` });
      }
    }
  }

  return articles.slice(0, 10);
}

async function scrapeHypebeast() {
  const { ok, html } = await fetchPage('https://hypebeast.com/fashion');
  if (!ok || !html) return [];
  return extractArticles(html, 'Hypebeast');
}

async function scrapeVogue() {
  const { ok, html } = await fetchPage('https://www.vogue.com/fashion');
  if (!ok || !html) return [];
  const articles = extractArticles(html, 'Vogue');
  // Vogue-specific: look for story links
  if (articles.length < 3) {
    for (const match of [...html.matchAll(/href="(\/story\/[^"]+)"[^>]*>\s*([^<]{25,160})\s*</gi)].slice(0, 15)) {
      const title = decodeHtmlEntities(match[2]);
      if (title.length >= 25) articles.push({ source: 'Vogue', title, url: `https://www.vogue.com${match[1]}` });
    }
  }
  return articles.slice(0, 10);
}

async function fetchUniqloProducts() {
  // Step 1: Get the new arrivals page and extract product IDs embedded in the HTML
  const { ok, html: pageHtml } = await fetchPage('https://www.uniqlo.com/us/en/men/new-arrivals');
  if (!ok || !pageHtml) return [];

  // Product IDs appear as "E484209-000" or "E484209-000-00" in the HTML
  const idSet = new Set();
  for (const m of [...pageHtml.matchAll(/[\"']([A-Z]\d{6}-\d{3})(?:-\d{2})?[\"']/g)].slice(0, 80)) {
    idSet.add(m[1]); // base ID format: EXXXXXX-XXX
  }

  const productIds = [...idSet].slice(0, 25);
  if (productIds.length === 0) return [];

  // Step 2: Fetch product details in parallel (batched to avoid rate limiting)
  const BATCH = 5;
  const products = [];
  const seen = new Set();

  for (let i = 0; i < productIds.length; i += BATCH) {
    const batch = productIds.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(id =>
        fetchPage(`https://www.uniqlo.com/us/api/commerce/v5/en/products/${id}`)
          .then(({ ok, html }) => {
            if (!ok || !html) return null;
            try {
              const data = JSON.parse(html);
              const r = data?.result;
              if (!r?.name) return null;
              const uniqueColors = [...new Set((r.colors || []).map(c => c.name).filter(Boolean))];
              const price = r.l2s?.[0]?.prices?.base?.value;
              return {
                name: r.name,
                colors: uniqueColors.slice(0, 6).join(', ') || 'Various',
                price: price ? `$${price}` : 'See site',
                url: `https://www.uniqlo.com/us/en/products/${id}/select`,
              };
            } catch (e) { return null; }
          })
      )
    );
    for (const p of results) {
      if (p && !seen.has(p.name)) {
        seen.add(p.name);
        products.push(p);
      }
    }
  }

  return products;
}

async function getUniqloData() {
  let cache = { products: [], lastPulled: null };
  if (existsSync(UNIQLO_CACHE_FILE)) {
    try { cache = JSON.parse(readFileSync(UNIQLO_CACHE_FILE, 'utf8')); } catch (e) {}
  }

  const daysSince = cache.lastPulled
    ? (Date.now() - new Date(cache.lastPulled).getTime()) / 86400000
    : Infinity;

  if (daysSince >= UNIQLO_REFRESH_DAYS) {
    const products = await fetchUniqloProducts();
    if (products.length > 0) {
      cache = { products, lastPulled: new Date().toISOString() };
      writeFileSync(UNIQLO_CACHE_FILE, JSON.stringify(cache, null, 2));
      return { products, fresh: true, lastPulled: cache.lastPulled };
    }
    // If scrape failed, return stale cache with note
    return { products: cache.products, fresh: false, lastPulled: cache.lastPulled, scrapeFailed: true };
  }

  return { products: cache.products, fresh: false, lastPulled: cache.lastPulled };
}

function loadBiasHistory() {
  if (!existsSync(BIAS_HISTORY_FILE)) return [];
  try { return JSON.parse(readFileSync(BIAS_HISTORY_FILE, 'utf8')); } catch (e) { return []; }
}

// --- Main ---
const today = new Date().toISOString().split('T')[0];

const [gq, highsnobiety, hypebeast, vogue, uniqlo] = await Promise.all([
  scrapeGQ(),
  scrapeHighsnobiety(),
  scrapeHypebeast(),
  scrapeVogue(),
  getUniqloData(),
]);

const biasHistory = loadBiasHistory();
const articles = [...gq, ...highsnobiety, ...hypebeast, ...vogue];

console.log(JSON.stringify({
  wakeAgent: true,
  data: {
    date: today,
    articles,
    sourceStats: {
      GQ: gq.length,
      Highsnobiety: highsnobiety.length,
      Hypebeast: hypebeast.length,
      Vogue: vogue.length,
    },
    uniqlo,
    biasHistory,
  },
}));
