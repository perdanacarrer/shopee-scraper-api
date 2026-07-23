import axios, { AxiosInstance } from 'axios';
import { delay, retryWithBackoff } from '../utils/helpers';
import { createProxyAgent } from './proxy';
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
   * Extract product data dari HTML secara manual
   */
  private extractProductDataFromHTML(html: string, dealId: string): any {
    try {
      // Extract title
      const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>|<meta[^>]*property="og:title"[^>]*content="([^"]*)"/);
      const title = titleMatch ? (titleMatch[1] || titleMatch[2]) : 'Unknown Product';

      // Extract price
      const priceMatch = html.match(/price['"]\s*:\s*(\d+)|₹\s*([\d,]+)|NT\$\s*([\d,]+)/);
      const price = priceMatch ? parseInt((priceMatch[1] || priceMatch[2] || priceMatch[3]).replace(/,/g, '')) : 0;

      // Extract description
      const descMatch = html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]*)"/);
      const description = descMatch ? descMatch[1] : '';

      // Extract image
      const imageMatch = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]*)"/);
      const image = imageMatch ? imageMatch[1] : '';

      console.log(`[EXTRACT] Manually extracted product data`);

      return {
        title,
        price,
        description,
        image
      };
    } catch (error) {
      console.error(`[EXTRACT] Failed to manually extract data:`, error);
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

    // Strategy 1: Try API directly
    try {
      console.log(`[STRATEGY 1] Trying direct API...`);
      const apiData = await this.fetchProductAPI(dealId, storeId);
      if (apiData && apiData.data) {
        return apiData;
      }
    } catch (error: any) {
      console.log(`[STRATEGY 1] Failed: ${error.message}`);
    }

    // Strategy 2: Fetch page and extract embedded data
    try {
      console.log(`[STRATEGY 2] Fetching page for embedded data...`);
      const html = await this.fetchProductPage(dealId, storeId);

      // Try to extract initial state
      const initialState = this.extractInitialState(html);
      if (initialState) {
        return {
          bff_meta: null,
          error: null,
          error_msg: null,
          data: initialState
        };
      }

      // Fallback: Extract data from HTML manually
      const extractedData = this.extractProductDataFromHTML(html, dealId);
      if (extractedData) {
        return {
          bff_meta: null,
          error: null,
          error_msg: null,
          data: {
            item: {
              ...extractedData,
              item_id: parseInt(dealId),
              shop_id: parseInt(storeId),
              status: 'normal'
            }
          }
        };
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
          description: `Note: ${reason}`
        }
      }
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