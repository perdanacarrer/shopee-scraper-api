# Shopee Scraper API v2.0

**Lightweight Shopee Taiwan Product Scraper** - Direct HTTP + Cheerio HTML Parser

✨ **Key Features:**
- ✓ **No Third-Party APIs** - Pure direct Shopee API calls
- ✓ **No Browser Engine** - Uses Cheerio for parsing (~50MB vs 300MB+ with Puppeteer)
- ✓ **Undetectable** - User agent rotation, request delays, browser-like headers
- ✓ **Fast & Efficient** - Direct HTTP requests with caching
- ✓ **Production Ready** - Error handling, retry logic, rate limiting

## Performance Comparison

| Feature | Puppeteer | This Solution |
|---------|-----------|---------------|
| Memory | 300-500MB | 50-100MB |
| Startup | 3-5s | <500ms |
| Per-request | 2-3s | 1-2s |
| Browser | Yes (heavy) | No (lightweight) |

## Quick Start

### Prerequisites
- Node.js 16+
- npm or yarn

### Installation

```bash
git clone https://github.com/perdanacarrer/shopee-scraper-api.git
cd shopee-scraper-api

npm install
cp .env.example .env
npm run build
npm start