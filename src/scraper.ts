import axios, { AxiosRequestConfig } from 'axios';
import { logger } from './logger';
import { CacheManager } from './cache';

// Import puppeteer dengan stealth
let puppeteer: any = null;
let StealthPlugin: any = null;

try {
  puppeteer = require('puppeteer-extra');
  StealthPlugin = require('puppeteer-extra-plugin-stealth');
  puppeteer.use(StealthPlugin());
  logger.info('Puppeteer with stealth plugin loaded successfully');
} catch (error) {
  logger.warn('Puppeteer not available, please install: npm install puppeteer-extra puppeteer-extra-plugin-stealth');
}

interface ScraperConfig {
  timeout: number;
  retries: number;
  retryDelay: number;
}

interface Cookie {
  name: string;
  value: string;
}

export class ShopeeScraper {
  private cache: CacheManager;
  private config: ScraperConfig;
  private userAgents: string[];
  private currentUserAgentIndex: number;

  constructor(cache: CacheManager) {
    this.cache = cache;
    this.config = {
      timeout: 30000,
      retries: 2,
      retryDelay: 2000
    };
    this.currentUserAgentIndex = 0;
    
    this.userAgents = [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15'
    ];
  }

  private getRandomUserAgent(): string {
    this.currentUserAgentIndex = (this.currentUserAgentIndex + 1) % this.userAgents.length;
    return this.userAgents[this.currentUserAgentIndex];
  }

  // Method 1: Scrape using Puppeteer with more sophisticated human-like behavior
  async scrapeWithPuppeteer(storeId: string, dealId: string): Promise<any> {
    if (!puppeteer) {
      throw new Error('Puppeteer not available');
    }

    let browser = null;
    try {
      logger.info(`Launching Puppeteer for ${storeId}/${dealId}`);
      
      // Try different launch options
      browser = await puppeteer.launch({
        headless: false, // Use headful mode for better stealth
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--window-size=1920,1080',
          '--disable-blink-features=AutomationControlled',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process',
          '--disable-site-isolation-trials',
          '--disable-features=BlockInsecurePrivateNetworkRequests',
          '--disable-features=TranslateUI',
          '--disable-ipc-flooding-protection',
          '--disable-features=RendererCodeIntegrity',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-features=AutofillServerCommunication',
          '--disable-ipc-flooding-protection',
          '--disable-features=PasswordImport'
        ],
        ignoreDefaultArgs: ['--enable-automation'],
        defaultViewport: null
      });

      const page = await browser.newPage();
      
      // Set user agent
      await page.setUserAgent(this.getRandomUserAgent());
      
      // Set viewport with random size
      await page.setViewport({
        width: 1920 + Math.floor(Math.random() * 100),
        height: 1080 + Math.floor(Math.random() * 100)
      });

      // Extra headers
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8,en-US;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control': 'max-age=0'
      });

      // Step 1: Go to Shopee homepage with random delay
      logger.info('Navigating to Shopee homepage...');
      await page.goto('https://shopee.tw/', {
        waitUntil: 'networkidle0',
        timeout: 30000
      });

      // Step 2: Human-like behavior - scroll and wait
      await page.evaluate(() => {
        return new Promise<void>((resolve) => {
          let scrollCount = 0;
          const maxScrolls = 3 + Math.floor(Math.random() * 3);
          
          const scrollInterval = setInterval(() => {
            // @ts-ignore
            window.scrollBy(0, 100 + Math.random() * 300);
            scrollCount++;
            
            if (scrollCount >= maxScrolls) {
              clearInterval(scrollInterval);
              resolve();
            }
          }, 500 + Math.random() * 1000);
        });
      });

      // Wait random time
      await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000));

      // Step 3: Try to interact with page (click on category or search)
      try {
        // Try to click on a random category
        const categories = await page.$$('.shopee-category-list__category');
        if (categories.length > 0) {
          const randomIndex = Math.floor(Math.random() * Math.min(categories.length, 5));
          await categories[randomIndex].click();
          await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 1000));
        }
      } catch (e) {
        // Ignore if no categories found
      }

      // Step 4: Search for the product first (more human-like)
      try {
        const searchInput = await page.$('input[placeholder*="搜尋"]');
        if (searchInput) {
          await searchInput.type(`item ${dealId}`, { delay: 100 + Math.random() * 50 });
          await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 500));
          
          const searchButton = await page.$('button[type="submit"]');
          if (searchButton) {
            await searchButton.click();
            await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 2000));
          }
        }
      } catch (e) {
        // Ignore search errors
      }

      // Step 5: Now navigate to the product page directly (more human-like)
      const productUrl = `https://shopee.tw/product/${storeId}/${dealId}`;
      logger.info(`Navigating to product page: ${productUrl}`);
      
      await page.goto(productUrl, {
        waitUntil: 'networkidle0',
        timeout: 30000
      });

      // Wait for page to load
      await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 2000));

      // Step 6: Extract data from the page using various methods
      let data = null;

      // Method A: Try to get data from window.__INITIAL_STATE__
      try {
        data = await page.evaluate(() => {
          // @ts-ignore
          if (window.__INITIAL_STATE__) {
            // @ts-ignore
            return window.__INITIAL_STATE__;
          }
          return null;
        });
        
        if (data && data.item) {
          logger.info('Successfully extracted data from __INITIAL_STATE__');
          return { data: { item: data.item } };
        }
      } catch (e) {
        // Ignore
      }

      // Method B: Try to fetch the API directly with authentication cookies
      try {
        const cookies = await page.cookies();
        const cookieString = cookies.map((c: Cookie) => `${c.name}=${c.value}`).join('; ');
        
        const apiUrl = `https://shopee.tw/api/v4/pdp/get_pc?item_id=${dealId}&shop_id=${storeId}`;
        
        const apiData = await page.evaluate(async (url: string, cookieStr: string) => {
          const response = await fetch(url, {
            method: 'GET',
            headers: {
              'Accept': 'application/json, text/plain, */*',
              'Cookie': cookieStr,
              'X-Requested-With': 'XMLHttpRequest',
              'Shopee-Language': 'zh_TW'
            },
            credentials: 'include'
          });
          return response.json();
        }, apiUrl, cookieString);
        
        if (apiData && !apiData.error) {
          logger.info('Successfully fetched API data with cookies');
          return apiData;
        }
      } catch (e) {
        logger.warn('API fetch with cookies failed:', e);
      }

      // Method C: Try to extract from page HTML
      try {
        const htmlData = await page.evaluate(() => {
          // @ts-ignore
          if (window.__INITIAL_STATE__) {
            // @ts-ignore
            return window.__INITIAL_STATE__;
          }
          
          // Try to find JSON-LD or script tags
          // @ts-ignore
          const scripts = document.querySelectorAll('script[type="application/ld+json"]');
          for (let i = 0; i < scripts.length; i++) {
            try {
              const script = scripts[i];
              const json = JSON.parse(script.textContent || '');
              if (json && json.name) {
                return json;
              }
            } catch (e) {
              // Ignore
            }
          }
          return null;
        });
        
        if (htmlData && htmlData.name) {
          logger.info('Extracted data from HTML');
          return { data: { item: htmlData } };
        }
      } catch (e) {
        // Ignore
      }

      throw new Error('Could not extract data from page');
    } catch (error) {
      logger.error('Puppeteer scraping failed:', error);
      throw error;
    } finally {
      if (browser) {
        // Wait a bit before closing
        await new Promise(resolve => setTimeout(resolve, 1000));
        await browser.close();
        logger.info('Puppeteer browser closed');
      }
    }
  }

  // Method 2: Scrape using Axios (fallback)
  async scrapeWithAxios(storeId: string, dealId: string): Promise<any> {
    try {
      const url = `https://shopee.tw/api/v4/pdp/get_pc?item_id=${dealId}&shop_id=${storeId}`;
      
      const headers = {
        'User-Agent': this.getRandomUserAgent(),
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8,en-US;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Referer': 'https://shopee.tw/',
        'Origin': 'https://shopee.tw',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"macOS"',
        'X-Requested-With': 'XMLHttpRequest',
        'Shopee-Language': 'zh_TW'
      };

      const config: AxiosRequestConfig = {
        headers,
        timeout: this.config.timeout,
        validateStatus: (status) => status === 200,
        params: {
          _t: Date.now()
        }
      };

      const response = await axios.get(url, config);
      
      if (response.data && response.data.error === 90309999) {
        throw new Error('BOT_DETECTED');
      }
      
      return response.data;
    } catch (error: any) {
      if (error.response?.data?.error === 90309999 || error.message === 'BOT_DETECTED') {
        throw new Error('BOT_DETECTED');
      }
      throw error;
    }
  }

  // Main scrape method
  async scrapeItem(storeId: string, dealId: string): Promise<any> {
    try {
      // Check cache
      const cacheKey = `${storeId}_${dealId}`;
      const cachedData = this.cache.get(cacheKey);
      if (cachedData) {
        logger.info(`Returning cached data for ${cacheKey}`);
        return cachedData;
      }

      let data = null;
      let method = '';

      // Try Puppeteer first (headful mode)
      if (puppeteer) {
        try {
          logger.info(`Attempting Puppeteer scraping for ${storeId}/${dealId}`);
          data = await this.scrapeWithPuppeteer(storeId, dealId);
          method = 'puppeteer';
          
          // Validate data
          if (data && data.data && data.data.item) {
            logger.info(`Puppeteer successful for ${storeId}/${dealId}`);
            this.cache.set(cacheKey, data);
            return data;
          }
        } catch (error: any) {
          logger.warn(`Puppeteer failed: ${error.message}`);
        }
      }

      // Try Axios as fallback
      try {
        logger.info(`Trying Axios for ${storeId}/${dealId}`);
        data = await this.scrapeWithAxios(storeId, dealId);
        method = 'axios';
        
        if (data && data.data && data.data.item) {
          logger.info(`Axios successful for ${storeId}/${dealId}`);
          this.cache.set(cacheKey, data);
          return data;
        }
      } catch (error: any) {
        logger.warn(`Axios failed: ${error.message}`);
      }

      throw new Error('All scraping methods failed. Please try again later.');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to scrape item ${storeId}/${dealId}:`, errorMessage);
      throw new Error(`Scraping failed: ${errorMessage}`);
    }
  }

  // Helper: Test connection
  async testConnection(): Promise<{ success: boolean; method: string; error?: string }> {
    const testStoreId = '3543467';
    const testDealId = '18904813090';
    
    try {
      if (puppeteer) {
        try {
          const data = await this.scrapeWithPuppeteer(testStoreId, testDealId);
          if (data && data.data && data.data.item) {
            return { success: true, method: 'puppeteer' };
          }
        } catch (error) {
          logger.warn('Puppeteer test failed:', error);
        }
      }

      try {
        const data = await this.scrapeWithAxios(testStoreId, testDealId);
        if (data && data.data && data.data.item) {
          return { success: true, method: 'axios' };
        }
      } catch (error) {
        logger.warn('Axios test failed:', error);
      }

      return { success: false, method: 'none', error: 'All methods failed' };
    } catch (error) {
      return { 
        success: false, 
        method: 'none', 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }
}