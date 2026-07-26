import axios, { AxiosInstance } from 'axios';
import { delay, retryWithBackoff } from '../utils/helpers';
import { createProxyAgent } from './proxy';
import { fetchPdpViaBrowser } from './browserScraper';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const DEFAULT_USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
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

  constructor() {
    this.timeout = parseInt(process.env.SCRAPER_TIMEOUT || '30000', 10);
    this.maxRetries = parseInt(process.env.SCRAPER_RETRIES || '3', 10);
    this.retryDelay = parseInt(process.env.SCRAPER_RETRY_DELAY || '1000', 10);
    this.rateLimit = parseInt(process.env.SCRAPER_RATE_LIMIT || '10', 10);

    this.userAgents = process.env.USER_AGENTS
      ? process.env.USER_AGENTS.split(',').map(ua => ua.trim())
      : DEFAULT_USER_AGENTS;

    console.log(`[SCRAPER] Config loaded:`);
    console.log(`  • Timeout: ${this.timeout}ms`);
    console.log(`  • Max Retries: ${this.maxRetries}`);
    console.log(`  • Retry Delay: ${this.retryDelay}ms`);
    console.log(`  • Rate Limit: ${this.rateLimit} requests/sec`);
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
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Cache-Control': 'max-age=0',
      'Referer': referer
    };
  }

  private generateAPIHeaders(referer = 'https://shopee.tw/'): Record<string, string> {
    const userAgent = this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
    
    return {
      'User-Agent': userAgent,
      'Accept': 'application/json',
      'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Content-Type': 'application/json',
      'Origin': 'https://shopee.tw',
      'Referer': referer,
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
   * Extract initial state from HTML page
   * Shopee embeds initial data in window.__INITIAL_STATE__
   */
  private extractInitialState(html: string): any {
    try {
      // Pattern 1: Look for window.__INITIAL_STATE__ = {...}
      const pattern1 = /window\.__INITIAL_STATE__\s*=\s*(\{.*?\});/s;
      const match1 = html.match(pattern1);
      if (match1) {
        console.log(`[EXTRACT] Found __INITIAL_STATE__`);
        return JSON.parse(match1[1]);
      }

      // Pattern 2: Look for data in script tag with id
      const scriptPattern = /<script[^>]*id="[^"]*"[^>]*>({[\s\S]*?})<\/script>/;
      const scriptMatch = html.match(scriptPattern);
      if (scriptMatch) {
        console.log(`[EXTRACT] Found data in script tag`);
        return JSON.parse(scriptMatch[1]);
      }

      // Pattern 3: Look for SSR payload
      const ssrPattern = /<script[^>]*>(.*?__SHOPEE.*?)<\/script>/s;
      const ssrMatch = html.match(ssrPattern);
      if (ssrMatch) {
        console.log(`[EXTRACT] Found SSR data`);
        const dataStr = ssrMatch[1];
        const jsonMatch = dataStr.match(/(\{.*\})/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[1]);
        }
      }

      return null;
    } catch (error) {
      console.error(`[EXTRACT] Failed to extract initial state:`, error);
      return null;
    }
  }

  /**
   * Fetch product page HTML
   */
  async fetchProductPage(dealId: string, storeId: string): Promise<string> {
    return retryWithBackoff(async () => {
      await this.respectRateLimit();

      const url = `https://shopee.tw/view/${dealId}`;
      const headers = this.generateHeaders(url);

      console.log(`[PAGE] Fetching product page: ${url}`);

      const response = await this.client.get(url, { headers });

      console.log(`[PAGE] Response status: ${response.status}`);

      if (response.status === 200 && response.data) {
        console.log(`[PAGE] ✓ Got page HTML`);
        return response.data;
      } else if (response.status === 403) {
        throw new Error('403 Forbidden - IP blocked');
      } else if (response.status === 429) {
        throw new Error('429 Rate limited');
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    }, this.maxRetries, this.retryDelay);
  }

  /**
   * Fetch product API data directly
   */
  async fetchProductAPI(dealId: string, storeId: string): Promise<any> {
    return retryWithBackoff(async () => {
      await this.respectRateLimit();

      const params = {
        item_id: dealId,
        shop_id: storeId
      };

      const headers = this.generateAPIHeaders(`https://shopee.tw/view/${dealId}`);

      console.log(`[API] Fetching API: item_id=${dealId}, shop_id=${storeId}`);

      const response = await this.client.get('https://shopee.tw/api/v4/pdp/get_pc', {
        params,
        headers
      });

      console.log(`[API] Response status: ${response.status}`);

      if (response.status === 200 && response.data && response.data.data) {
        console.log(`[API] ✓ Got API response`);
        return response.data;
      } else if (response.status === 403) {
        throw new Error('403 Forbidden');
      } else if (response.status === 429) {
        throw new Error('429 Rate limited');
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    }, this.maxRetries, this.retryDelay);
  }

  /**
   * Fetch product data - try multiple strategies
   */
  async fetchProductData(storeId: string, dealId: string): Promise<any> {
    console.log(`\n[SCRAPER] Attempting to fetch product data...`);
    const strategyErrors: string[] = [];
    // If Shopee itself answers with a genuine {error, error_msg, data:null}
    // envelope (not a network/proxy failure), keep it — it's more honest
    // and more useful than anything we could synthesize ourselves.
    let authenticShopeeResponse: any = null;

    // Strategy 1: Real browser context (lets Shopee's own anti-bot JS
    // sign the request). This is the only strategy that reliably returns
    // a real get_pc payload — see browserScraper.ts for why.
    try {
      console.log(`[STRATEGY 1] Trying browser-context API call...`);
      const { get_pc } = await fetchPdpViaBrowser(storeId, dealId, {
        timeout: this.timeout
      });
      if (get_pc.body?.data?.item) {
        return get_pc.body;
      }
      // We got a real, well-formed response from Shopee — it's just
      // telling us (in its own words) that there's no item data.
      if (get_pc.body) {
        authenticShopeeResponse = get_pc.body;
      }
      strategyErrors.push(
        `strategy1(browser): HTTP ${get_pc.status}, shopee error=${get_pc.body?.error ?? 'n/a'}, ` +
        `error_msg=${get_pc.body?.error_msg ?? 'n/a'}`
      );
    } catch (error: any) {
      console.log(`[STRATEGY 1] Failed: ${error.message}`);
      strategyErrors.push(`strategy1(browser): ${error.message}`);
    }

    // Strategy 2: Plain HTTP call to the API (kept as a cheap first try
    // for environments where anti-bot happens to be lenient — usually
    // will NOT work on its own, see generateAPIHeaders note above).
    try {
      console.log(`[STRATEGY 2] Trying direct axios API call...`);
      const apiData = await this.fetchProductAPI(dealId, storeId);
      if (apiData?.data?.item) {
        return apiData;
      }
      if (apiData && !authenticShopeeResponse) {
        authenticShopeeResponse = apiData;
      }
      strategyErrors.push('strategy2(axios): returned no data.item');
    } catch (error: any) {
      console.log(`[STRATEGY 2] Failed: ${error.message}`);
      strategyErrors.push(`strategy2(axios): ${error.message}`);
    }

    // Strategy 3: Fetch page and pull embedded __INITIAL_STATE__/SSR JSON.
    // NOTE: this only counts as success if we found a *real* embedded
    // payload — we deliberately do NOT fall back to regex-scraping
    // title/price/description into a fake item object, because that
    // produces a tiny object that can never match Shopee's real ~85-field
    // item schema (see get_pc_response_example.txt). A wrong-shaped
    // "success" is worse than an honest failure here.
    try {
      console.log(`[STRATEGY 3] Fetching page for embedded data...`);
      const html = await this.fetchProductPage(dealId, storeId);

      const initialState = this.extractInitialState(html);
      if (initialState) {
        return {
          bff_meta: null,
          error: null,
          error_msg: null,
          data: initialState
        };
      }
      strategyErrors.push('strategy3(html): no embedded __INITIAL_STATE__/SSR JSON found (page is likely client-rendered)');
    } catch (error: any) {
      console.log(`[STRATEGY 3] Failed: ${error.message}`);
      strategyErrors.push(`strategy3(html): ${error.message}`);
    }

    // Nothing had real item data, but if Shopee itself gave us a genuine
    // envelope at any point, that's the truthful answer — return it
    // instead of a synthetic error.
    if (authenticShopeeResponse) {
      console.log(`[SCRAPER] No item data, but returning Shopee's own response envelope`);
      return authenticShopeeResponse;
    }

    const err = new Error('All scraping strategies failed');
    (err as any).strategyErrors = strategyErrors;
    throw err;
  }

  /**
   * Build a response that keeps Shopee's real top-level envelope shape
   * (bff_meta / error / error_msg / data) for failure cases, instead of
   * fabricating a fake "data.item" object. When scraping fails there is
   * no honest way to fill in an 85-field item, so `data` stays null —
   * exactly like Shopee's own API does for e.g. a deleted/invalid item_id.
   */
  buildErrorResponse(storeId: string, dealId: string, reason: string, strategyErrors?: string[]): any {
    console.log(`[SCRAPER] Returning error envelope - ${reason}`);
    return {
      bff_meta: null,
      error: 4, // mirrors Shopee's own "item not found / unavailable" error code
      error_msg: reason,
      data: null,
      _debug: strategyErrors ? { item_id: dealId, shop_id: storeId, strategyErrors } : undefined
    };
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
  
  try {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Starting scrape:`);
    console.log(`  • Item ID: ${dealId}`);
    console.log(`  • Shop ID: ${storeId}`);
    console.log(`${'='.repeat(60)}`);

    // fetchProductData either resolves with a genuine Shopee envelope
    // (real item data, or Shopee's own {error, error_msg, data:null}
    // response) or throws when we truly got nothing usable. Either way,
    // a resolved value is already correctly shaped — pass it straight
    // through instead of re-wrapping it.
    const data = await scraperInstance.fetchProductData(storeId, dealId);

    console.log(data?.data?.item ? `\n✓ SUCCESS: Real item data fetched\n` : `\n⚠ Got Shopee's own response, but no item data\n`);
    return data;
  } catch (error: any) {
    console.error(`\n✗ ERROR: ${error.message}\n`);
    return scraperInstance.buildErrorResponse(
      storeId,
      dealId,
      `All scraping strategies failed: ${error.message}`,
      error.strategyErrors
    );
  }
}