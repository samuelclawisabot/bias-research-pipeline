# BIAS. Research Pipeline

Daily automated research digest for the BIAS. menswear newsletter.

## What it does

Runs every morning at 7 AM UTC. Scrapes Tier 1 fashion sources and Uniqlo new arrivals, then delivers a digest to Rick with:

- **3–5 trend signals** identified across GQ, Highsnobiety, Hypebeast, and Vogue
- **Uniqlo men's new arrivals** (product name, colors, price) — refreshed every 3 days
- **"Last seen on BIAS."** flags next to any trend that was recently used in a newsletter issue

## Files

| File | Purpose |
|------|---------|
| `index.js` | Main scraper — runs as the scheduled task script |
| `add_bias_theme.js` | CLI helper to record a used theme into history |
| `data/bias_history.json` | Log of themes covered in past BIAS. issues |
| `data/uniqlo_cache.json` | Cached Uniqlo products (not committed) |
| `data/digests/` | Saved daily digests in markdown (not committed) |

## Recording a used theme

After publishing an issue, add the theme to history so future digests can flag repeats:

```bash
node add_bias_theme.js "Linen & Easy Silhouettes" "Vol. 14"
```

## Sources

**Tier 1 (daily):** GQ Style, Highsnobiety, Hypebeast Fashion, Vogue Fashion

**Product sourcing:** Uniqlo US Men's New Arrivals (every 3 days)
