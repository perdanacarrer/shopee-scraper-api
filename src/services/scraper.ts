import axios, { AxiosInstance } from 'axios';
import { delay, retryWithBackoff, TTLCache } from '../utils/helpers';
import { createProxyAgent } from './proxy';
import dotenv from 'dotenv';

dotenv.config();

const DEFAULT_USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
];

class ShopeeScraper {
  private client: AxiosInstance;
  private requestCount = 0;
  private lastRequestTime = 0;
  private userAgents: string[];
  private timeout: number;
  private maxRetries: number;
  private retryDelay: number;
  private rateLimit: number;
  private cache: TTLCache<any>;

  constructor() {
    this.timeout = parseInt(process.env.SCRAPER_TIMEOUT || '30000', 10);
    this.maxRetries = parseInt(process.env.SCRAPER_RETRIES || '3', 10);
    this.retryDelay = parseInt(process.env.SCRAPER_RETRY_DELAY || '1000', 10);
    this.rateLimit = parseInt(process.env.SCRAPER_RATE_LIMIT || '10', 10);

    this.userAgents = process.env.USER_AGENTS
      ? process.env.USER_AGENTS.split(',').map(ua => ua.trim()).filter(Boolean)
      : DEFAULT_USER_AGENTS;

    const cacheTtlSeconds = parseInt(process.env.CACHE_TTL || '600', 10);
    this.cache = new TTLCache(cacheTtlSeconds * 1000);

    console.log(`[SCRAPER] Config loaded:`);
    console.log(`  • Timeout: ${this.timeout}ms`);
    console.log(`  • Max Retries: ${this.maxRetries}`);
    console.log(`  • Retry Delay: ${this.retryDelay}ms`);
    console.log(`  • Rate Limit: ${this.rateLimit} requests/sec`);
    console.log(`  • Cache TTL: ${cacheTtlSeconds}s`);
    console.log(`  • User Agents: ${this.userAgents.length}`);

    this.client = axios.create({
      timeout: this.timeout,
      validateStatus: () => true,
      httpAgent: createProxyAgent('http'),
      httpsAgent: createProxyAgent('https')
    });
  }

  private generateHeaders(referer = 'https://shopee.tw/'): Record<string, string> {
    const userAgent = this.userAgents[Math.floor(Math.random() * this.userAgents.length)];

    return {
      'User-Agent': userAgent,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      DNT: '1',
      Connection: 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Cache-Control': 'max-age=0',
      Referer: referer
    };
  }

  private generateAPIHeaders(referer = 'https://shopee.tw/'): Record<string, string> {
    const userAgent = this.userAgents[Math.floor(Math.random() * this.userAgents.length)];

    return {
      'User-Agent': userAgent,
      Accept: 'application/json',
      'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Content-Type': 'application/json',
      Origin: 'https://shopee.tw',
      Referer: referer,
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
      'X-Requested-With': 'XMLHttpRequest'
    };
  }

  private async respectRateLimit() {
    this.requestCount++;

    if (this.requestCount % this.rateLimit === 0) {
      const timeSinceLastGroup = Date.now() - this.lastRequestTime;
      const minDelay = 1000;

      if (timeSinceLastGroup < minDelay) {
        await delay(minDelay - timeSinceLastGroup);
      }

      this.lastRequestTime = Date.now();
    } else {
      await delay(Math.random() * 1500 + 800);
    }
  }

  /**
   * Shopee embeds initial data in window.__INITIAL_STATE__ (or similar) on the
   * server-rendered product page. This lets us recover product data even when
   * the JSON API endpoint itself is blocked/rate-limited.
   */
  private extractInitialState(html: string): any {
    try {
      const pattern1 = /window\.__INITIAL_STATE__\s*=\s*(\{.*?\});/s;
      const match1 = html.match(pattern1);
      if (match1) {
        console.log(`[EXTRACT] Found __INITIAL_STATE__`);
        return JSON.parse(match1[1]);
      }

      const scriptPattern = /<script[^>]*id="[^"]*"[^>]*>({[\s\S]*?})<\/script>/;
      const scriptMatch = html.match(scriptPattern);
      if (scriptMatch) {
        console.log(`[EXTRACT] Found data in script tag`);
        return JSON.parse(scriptMatch[1]);
      }

      return null;
    } catch (error) {
      console.error(`[EXTRACT] Failed to extract initial state:`, error);
      return null;
    }
  }

  /**
   * Parses every <meta> tag in the document into a property/name -> content
   * map, regardless of attribute order or quote style. The previous version
   * assumed `property="..."` always came before `content="..."` in the tag,
   * which breaks the moment a page (like Shopee's) writes them the other way
   * around or uses single quotes.
   */
  private parseMetaTags(html: string): Map<string, string> {
    const map = new Map<string, string>();
    const tagMatches = html.match(/<meta\b[^>]*>/gi);
    if (!tagMatches) return map;

    const attrPattern = /([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

    for (const tag of tagMatches) {
      const attrs: Record<string, string> = {};
      let m: RegExpExecArray | null;
      attrPattern.lastIndex = 0;
      while ((m = attrPattern.exec(tag)) !== null) {
        attrs[m[1].toLowerCase()] = m[2] !== undefined ? m[2] : m[3];
      }
      const key = attrs.property || attrs.name;
      if (key && attrs.content !== undefined) {
        map.set(key.toLowerCase(), attrs.content);
      }
    }
    return map;
  }

  /**
   * Some pages embed a schema.org Product block in a <script type="application/ld+json">
   * tag. When present this is a much more reliable source for price than meta tags,
   * since og:* tags are usually just title/description/image.
   */
  private extractJsonLdProduct(html: string): { name?: string; description?: string; image?: string; price?: number } | null {
    try {
      const blocks = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
      if (!blocks) return null;

      for (const block of blocks) {
        const jsonMatch = block.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
        if (!jsonMatch) continue;

        let parsed: any;
        try {
          parsed = JSON.parse(jsonMatch[1]);
        } catch {
          continue;
        }

        const candidates = Array.isArray(parsed) ? parsed : [parsed];
        for (const candidate of candidates) {
          if (candidate && candidate['@type'] === 'Product') {
            const offers = Array.isArray(candidate.offers) ? candidate.offers[0] : candidate.offers;
            const rawPrice = offers?.price ?? offers?.lowPrice;
            return {
              name: candidate.name,
              description: candidate.description,
              image: Array.isArray(candidate.image) ? candidate.image[0] : candidate.image,
              price: rawPrice !== undefined ? parseFloat(String(rawPrice).replace(/,/g, '')) : undefined
            };
          }
        }
      }
      return null;
    } catch (error) {
      console.error(`[EXTRACT] Failed to parse JSON-LD:`, error);
      return null;
    }
  }

  /**
   * Fallback: build an `item` object that mirrors the shape of the real get_pc
   * response (same field names, same price scale) using whatever we can recover
   * from <meta> tags and, if present, JSON-LD. This is inherently partial: Shopee
   * renders price/stock/models client-side via get_pc itself, so a plain HTML
   * fetch usually can only recover title, description and the cover image —
   * price stays null (not 0) when we genuinely don't know it, and models stays [].
   */
  private extractProductDataFromHTML(html: string): any {
    try {
      const jsonLd = this.extractJsonLdProduct(html);
      const meta = this.parseMetaTags(html);

      const titleTagMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
      const title = jsonLd?.name
        || meta.get('og:title')
        || meta.get('twitter:title')
        || (titleTagMatch ? titleTagMatch[1].trim() : null)
        || 'Unknown Product';

      const description = jsonLd?.description
        || meta.get('og:description')
        || meta.get('twitter:description')
        || meta.get('description')
        || '';

      const imageUrl = jsonLd?.image
        || meta.get('og:image')
        || meta.get('twitter:image')
        || null;

      // get_pc represents price in "micro units" (TWD * 100000). JSON-LD/meta
      // prices are plain decimal TWD, so scale them to match.
      const priceTwd = jsonLd?.price;
      const priceMicro = priceTwd !== undefined && !Number.isNaN(priceTwd)
        ? Math.round(priceTwd * 100000)
        : null;

      if (!jsonLd && title === 'Unknown Product') {
        // Nothing recognizable at all - likely a bot-check/interstitial page
        // rather than the real product page. Log a snippet so it's easy to
        // tell the two apart instead of guessing blindly.
        console.log(
          `[EXTRACT] No title/meta/JSON-LD found. html length=${html.length}. ` +
          `First 300 chars: ${html.slice(0, 300).replace(/\s+/g, ' ')}`
        );
      } else {
        console.log(`[EXTRACT] Manually extracted product data (jsonLd=${!!jsonLd})`);
      }

      return {
        title,
        description,
        image_url: imageUrl,
        price: priceMicro,
        price_min: priceMicro,
        price_max: priceMicro,
        currency: 'TWD',
        models: []
      };
    } catch (error) {
      console.error(`[EXTRACT] Failed to manually extract data:`, error);
      return null;
    }
  }

  async fetchProductPage(dealId: string): Promise<string> {
    return retryWithBackoff(async () => {
      await this.respectRateLimit();

      const url = `https://shopee.tw/view/${dealId}`;
      const headers = this.generateHeaders(url);

      console.log(`[PAGE] Fetching product page: ${url}`);
      const response = await this.client.get(url, { headers });
      console.log(`[PAGE] Response status: ${response.status}`);

      if (response.status === 200 && response.data) {
        return response.data;
      } else if (response.status === 403) {
        throw new Error('403 Forbidden - IP likely blocked');
      } else if (response.status === 429) {
        throw new Error('429 Rate limited');
      }
      throw new Error(`HTTP ${response.status}`);
    }, this.maxRetries, this.retryDelay);
  }

  /**
   * Calls Shopee's own public product-detail JSON endpoint directly
   * (the exact same request the shopee.tw web app makes in your browser).
   * No third-party scraping service involved.
   */
  async fetchProductAPI(dealId: string, storeId: string): Promise<any> {
    return retryWithBackoff(async () => {
      await this.respectRateLimit();

      const params = { item_id: dealId, shop_id: storeId };
      const headers = this.generateAPIHeaders(`https://shopee.tw/view/${dealId}`);

      console.log(`[API] Fetching: item_id=${dealId}, shop_id=${storeId}`);
      const response = await this.client.get('https://shopee.tw/api/v4/pdp/get_pc', { params, headers });
      console.log(`[API] Response status: ${response.status}`);

      if (response.status === 200 && response.data && response.data.data) {
        return response.data;
      } else if (response.status === 403) {
        throw new Error('403 Forbidden');
      } else if (response.status === 429) {
        throw new Error('429 Rate limited');
      }
      throw new Error(`HTTP ${response.status}`);
    }, this.maxRetries, this.retryDelay);
  }

  async fetchProductData(storeId: string, dealId: string): Promise<any> {
    const cacheKey = `${storeId}:${dealId}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      console.log(`[CACHE] Hit for ${cacheKey}`);
      return cached;
    }

    console.log(`\n[SCRAPER] Attempting to fetch product data...`);

    // Strategy 1: call Shopee's public JSON API directly.
    try {
      console.log(`[STRATEGY 1] Direct API (get_pc)...`);
      const apiData = await this.fetchProductAPI(dealId, storeId);
      if (apiData && apiData.data) {
        this.cache.set(cacheKey, apiData);
        return apiData;
      }
    } catch (error: any) {
      console.log(`[STRATEGY 1] Failed: ${error.message}`);
    }

    // Strategy 2: fetch the rendered page and pull embedded/meta data instead.
    try {
      console.log(`[STRATEGY 2] Fetching page for embedded data...`);
      const html = await this.fetchProductPage(dealId);

      const initialState = this.extractInitialState(html);
      if (initialState) {
        const result = { bff_meta: null, error: null, error_msg: null, data: initialState };
        this.cache.set(cacheKey, result);
        return result;
      }

      const extractedData = this.extractProductDataFromHTML(html);
      if (extractedData) {
        const result = {
          bff_meta: null,
          error: null,
          error_msg: null,
          data: {
            item: {
              item_id: parseInt(dealId, 10),
              shop_id: parseInt(storeId, 10),
              // Same field names/values the real get_pc response uses for an
              // active listing, so consumers can branch on item_status the
              // same way regardless of which strategy served the data.
              item_status: 'normal',
              status: 1,
              ...extractedData
            },
            // Not present in this fallback path (Shopee only returns these
            // via get_pc itself). Kept as empty/null so the response shape
            // still matches what a consumer of the real API would expect.
            shop_vouchers: [],
            free_return: null
          },
          // Flag so callers can tell this came from the degraded HTML path,
          // not the real get_pc endpoint - not part of Shopee's own schema.
          _partial: true,
          _source: 'html_meta_fallback'
        };
        this.cache.set(cacheKey, result);
        return result;
      }
    } catch (error: any) {
      console.log(`[STRATEGY 2] Failed: ${error.message}`);
    }

    throw new Error('All scraping strategies failed (item may be blocked, removed, or region-restricted)');
  }
}

let scraper: ShopeeScraper | null = null;

function getScraper(): ShopeeScraper {
  if (!scraper) {
    scraper = new ShopeeScraper();
  }
  return scraper;
}

export async function scrapePcEndpoint(storeId: string, dealId: string): Promise<any> {
  const scraperInstance = getScraper();

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Starting scrape: item_id=${dealId}, shop_id=${storeId}`);
  console.log(`${'='.repeat(60)}`);

  const data = await scraperInstance.fetchProductData(storeId, dealId);
  console.log(`\n✓ SUCCESS: Data fetched\n`);
  return data;
}
