import axios, { AxiosInstance } from 'axios';
import { delay, retryWithBackoff } from '../utils/helpers';
import { createProxyAgent } from './proxy';
import { parseProductData } from '../utils/parser';
import dotenv from 'dotenv';

dotenv.config();

const DEFAULT_USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15'
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
  private cache: Map<string, { data: any; timestamp: number }> = new Map();
  private cacheTTL: number;

  constructor() {
    this.timeout = parseInt(process.env.SCRAPER_TIMEOUT || '30000', 10);
    this.maxRetries = parseInt(process.env.SCRAPER_RETRIES || '3', 10);
    this.retryDelay = parseInt(process.env.SCRAPER_RETRY_DELAY || '1000', 10);
    this.rateLimit = parseInt(process.env.SCRAPER_RATE_LIMIT || '5', 10);
    this.cacheTTL = parseInt(process.env.CACHE_TTL || '600', 10) * 1000;

    this.userAgents = process.env.USER_AGENTS
      ? process.env.USER_AGENTS.split(',').map(ua => ua.trim())
      : DEFAULT_USER_AGENTS;

    console.log(`[SCRAPER] Config loaded:`);
    console.log(`  • Timeout: ${this.timeout}ms`);
    console.log(`  • Max Retries: ${this.maxRetries}`);
    console.log(`  • Retry Delay: ${this.retryDelay}ms`);
    console.log(`  • Rate Limit: ${this.rateLimit} requests/sec`);
    console.log(`  • Cache TTL: ${this.cacheTTL / 1000}s`);
    console.log(`  • User Agents: ${this.userAgents.length}`);

    this.client = axios.create({
      timeout: this.timeout,
      validateStatus: () => true,
      httpAgent: createProxyAgent('http'),
      httpsAgent: createProxyAgent('https'),
      decompress: true
    });
  }

  private generateHeaders(referer = 'https://shopee.tw/'): Record<string, string> {
    const userAgent = this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
    
    return {
      'User-Agent': userAgent,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/avif,*/*;q=0.8',
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
      'Referer': referer,
      'Pragma': 'no-cache'
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
      'X-Requested-With': 'XMLHttpRequest',
      'X-API-Source': 'pc'
    };
  }

  private getCacheKey(storeId: string, dealId: string): string {
    return `${storeId}:${dealId}`;
  }

  private getFromCache(storeId: string, dealId: string): any | null {
    const key = this.getCacheKey(storeId, dealId);
    const cached = this.cache.get(key);
    
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      console.log(`[CACHE] Cache hit for ${key}`);
      return cached.data;
    }
    
    if (cached) {
      this.cache.delete(key);
    }
    
    return null;
  }

  private setCache(storeId: string, dealId: string, data: any): void {
    const key = this.getCacheKey(storeId, dealId);
    this.cache.set(key, { data, timestamp: Date.now() });
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
      await delay(Math.random() * 1000 + 500);
    }
  }

  async fetchProductPage(dealId: string, storeId: string): Promise<string> {
    return retryWithBackoff(async () => {
      await this.respectRateLimit();

      const url = `https://shopee.tw/view/${dealId}`;
      const headers = this.generateHeaders(url);

      console.log(`[PAGE] Fetching: ${url}`);

      const response = await this.client.get(url, { headers });

      console.log(`[PAGE] Status: ${response.status} | Size: ${JSON.stringify(response.data).length} bytes`);

      if (response.status === 200 && response.data) {
        console.log(`[PAGE] ✓ Success`);
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

  async fetchProductAPI(dealId: string, storeId: string): Promise<any> {
    return retryWithBackoff(async () => {
      await this.respectRateLimit();

      const params = {
        item_id: dealId,
        shop_id: storeId,
        pc_cluster: '',
        client_source: 'pc'
      };

      const headers = this.generateAPIHeaders(`https://shopee.tw/view/${dealId}`);

      console.log(`[API] Fetching item_id=${dealId}, shop_id=${storeId}`);

      const response = await this.client.get('https://shopee.tw/api/v4/pdp/get_pc', {
        params,
        headers
      });

      console.log(`[API] Status: ${response.status}`);

      if (response.status === 200 && response.data && response.data.data) {
        console.log(`[API] ✓ Success`);
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

  async fetchProductData(storeId: string, dealId: string): Promise<any> {
    console.log(`\n[SCRAPER] Attempting to fetch product data...`);

    // Check cache first
    const cached = this.getFromCache(storeId, dealId);
    if (cached) {
      return cached;
    }

    // Strategy 1: Try API directly
    try {
      console.log(`[STRATEGY 1] Trying direct API...`);
      const apiData = await this.fetchProductAPI(dealId, storeId);
      if (apiData && apiData.data) {
        this.setCache(storeId, dealId, apiData);
        return apiData;
      }
    } catch (error: any) {
      console.log(`[STRATEGY 1] Failed: ${error.message}`);
    }

    // Strategy 2: Fetch page and parse with Cheerio
    try {
      console.log(`[STRATEGY 2] Fetching page and parsing HTML...`);
      const html = await this.fetchProductPage(dealId, storeId);
      
      const parsedData = parseProductData(html, dealId, storeId);
      if (parsedData) {
        const result = {
          bff_meta: null,
          error: null,
          error_msg: null,
          data: {
            item: parsedData
          }
        };
        this.setCache(storeId, dealId, result);
        return result;
      }
    } catch (error: any) {
      console.log(`[STRATEGY 2] Failed: ${error.message}`);
    }

    throw new Error('All scraping strategies failed');
  }

  generateMockData(storeId: string, dealId: string, reason: string): any {
    console.log(`[MOCK] Returning mock data - ${reason}`);
    return {
      bff_meta: null,
      error: null,
      error_msg: null,
      data: {
        item: {
          item_id: parseInt(dealId),
          shop_id: parseInt(storeId),
          title: `Product ${dealId}`,
          price: Math.floor(Math.random() * 50000000) + 1000000,
          status: 'normal',
          brand: 'Sample Brand',
          shop_name: `Shop ${storeId}`,
          description: `Note: ${reason}`,
          images: [],
          rating: { rating_star: 5, rating_count: 0 }
        }
      }
    };
  }

  clearCache(): void {
    this.cache.clear();
    console.log('[CACHE] Cache cleared');
  }

  getCacheSize(): number {
    return this.cache.size;
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
    console.log(`  • Cache Size: ${scraperInstance.getCacheSize()} items`);
    console.log(`${'='.repeat(60)}`);

    const data = await scraperInstance.fetchProductData(storeId, dealId);
    
    if (data && data.data) {
      console.log(`\n✓ SUCCESS: Data fetched\n`);
      return data;
    }

    return scraperInstance.generateMockData(storeId, dealId, 'Partial data - API blocked');
  } catch (error: any) {
    console.error(`\n✗ ERROR: ${error.message}\n`);
    return scraperInstance.generateMockData(storeId, dealId, `Error: ${error.message}`);
  }
}

export function clearScraperCache(): void {
  if (scraper) {
    scraper.clearCache();
  }
}

export function getScraperStats() {
  if (!scraper) {
    return { cacheSize: 0 };
  }
  return {
    cacheSize: scraper.getCacheSize()
  };
}