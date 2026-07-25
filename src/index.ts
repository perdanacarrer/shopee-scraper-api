import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { scrapePcEndpoint, clearScraperCache, getScraperStats } from './services/scraper';
import { getProxyStats } from './services/proxy';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

app.use(express.json());
app.use(cors());

// Health check
app.get('/health', (_req: Request, res: Response) => {
  const stats = getScraperStats();
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    service: 'Shopee Scraper API v2.0',
    environment: NODE_ENV,
    mode: 'Direct HTTP + Cheerio HTML Parser',
    thirdPartyAPI: false,
    cache: stats,
    proxy: getProxyStats()
  });
});

// Main scraping endpoint
app.get('/shopee', async (req: Request, res: Response) => {
  try {
    const { storeid, dealid } = req.query;

    if (!storeid || !dealid) {
      return res.status(400).json({
        error: 'Missing required parameters',
        required: ['storeid', 'dealid'],
        example: '/shopee?storeid={STORE_ID}&dealid={PRODUCT_ID}'
      });
    }

    const data = await scrapePcEndpoint(String(storeid), String(dealid));
    return res.json(data);
  } catch (error: any) {
    console.error('API Error:', error.message);
    return res.status(500).json({
      error: 'Failed to scrape data',
      message: error.message
    });
  }
});

// Batch scraping endpoint
app.post('/shopee/batch', async (req: Request, res: Response) => {
  try {
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: 'Invalid request',
        required: { items: 'Array of {storeid, dealid}' }
      });
    }

    const results = [];
    for (const item of items) {
      try {
        const data = await scrapePcEndpoint(String(item.storeid), String(item.dealid));
        results.push({
          storeid: item.storeid,
          dealid: item.dealid,
          success: true,
          data
        });
      } catch (error: any) {
        results.push({
          storeid: item.storeid,
          dealid: item.dealid,
          success: false,
          error: error.message
        });
      }
    }

    return res.json({
      total: items.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results
    });
  } catch (error: any) {
    return res.status(500).json({
      error: 'Batch processing failed',
      message: error.message
    });
  }
});

// Clear cache endpoint
app.post('/cache/clear', (_req: Request, res: Response) => {
  clearScraperCache();
  res.json({
    status: 'ok',
    message: 'Cache cleared',
    timestamp: new Date().toISOString()
  });
});

// Config endpoint
app.get('/config', (_req: Request, res: Response) => {
  const stats = getScraperStats();
  res.json({
    environment: NODE_ENV,
    port: PORT,
    scraper: {
      timeout: parseInt(process.env.SCRAPER_TIMEOUT || '30000', 10),
      retries: parseInt(process.env.SCRAPER_RETRIES || '3', 10),
      retryDelay: parseInt(process.env.SCRAPER_RETRY_DELAY || '1000', 10),
      rateLimit: parseInt(process.env.SCRAPER_RATE_LIMIT || '5', 10)
    },
    cache: {
      ttl: parseInt(process.env.CACHE_TTL || '600', 10),
      currentSize: stats.cacheSize
    },
    scraping: {
      type: 'Direct HTTP + Cheerio HTML Parser',
      memory: 'Lightweight - No Browser Engine',
      thirdPartyAPI: false
    },
    proxy: getProxyStats()
  });
});

// Stats endpoint
app.get('/stats', (_req: Request, res: Response) => {
  const stats = getScraperStats();
  res.json({
    timestamp: new Date().toISOString(),
    cache: stats,
    proxy: getProxyStats(),
    memory: {
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
      heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + ' MB',
      uptime: Math.round(process.uptime()) + ' seconds'
    }
  });
});

// Info endpoint
app.get('/info', (_req: Request, res: Response) => {
  res.json({
    name: 'Shopee Scraper API',
    version: '2.0.0',
    description: 'Lightweight Shopee product scraper - No third-party APIs, no browser engine',
    technology: 'Axios + Cheerio + Express.js',
    memory: 'Minimal ~50-100MB (vs 300-500MB with Puppeteer)',
    endpoints: {
      health: '/health',
      config: '/config',
      scrape: 'GET /shopee?storeid={STORE_ID}&dealid={PRODUCT_ID}',
      batch: 'POST /shopee/batch',
      stats: '/stats',
      cacheControl: 'POST /cache/clear'
    },
    features: [
      'Direct Shopee API calls',
      'HTML parsing with Cheerio',
      'Retry with exponential backoff',
      'User agent rotation',
      'In-memory caching',
      'Rate limiting',
      'Proxy support',
      'Batch processing'
    ]
  });
});

const server = app.listen(PORT, () => {
  const protocol = 'http';
  const host = 'localhost';
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Shopee Scraper API v2.0 (Lightweight)`);
  console.log(`  🔗 Direct HTTP Scraper + Cheerio HTML Parser`);
  console.log(`  ✓ No Third-Party APIs`);
  console.log(`  ✓ No Browser Engine (~50MB memory)`);
  console.log(`${'='.repeat(60)}`);
  console.log(`\nEnvironment: ${NODE_ENV}`);
  console.log(`Server running on: ${protocol}://${host}:${PORT}`);
  console.log(`\nAvailable endpoints:`);
  console.log(`  • Health:      ${protocol}://${host}:${PORT}/health`);
  console.log(`  • Scrape:      ${protocol}://${host}:${PORT}/shopee?storeid={STORE_ID}&dealid={PRODUCT_ID}`);
  console.log(`  • Batch:       POST ${protocol}://${host}:${PORT}/shopee/batch`);
  console.log(`  • Config:      ${protocol}://${host}:${PORT}/config`);
  console.log(`  • Stats:       ${protocol}://${host}:${PORT}/stats`);
  console.log(`  • Clear Cache: POST ${protocol}://${host}:${PORT}/cache/clear`);
  console.log(`  • Info:        ${protocol}://${host}:${PORT}/info`);
  console.log(`\n${'='.repeat(60)}\n`);
});

process.on('SIGINT', () => {
  console.log('\n\nShutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});