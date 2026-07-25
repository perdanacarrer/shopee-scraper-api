import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { scrapePcEndpoint } from './services/scraper';
import { getProxyStats } from './services/proxy';
import { validateProductId, validateStoreId } from './utils/helpers';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

app.use(express.json());
app.use(cors());

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'Shopee Scraper API',
    environment: NODE_ENV,
    proxy: getProxyStats()
  });
});

// Main scraping endpoint
app.get('/shopee', async (req: Request, res: Response) => {
  try {
    // Query strings are case-sensitive in Express, but callers commonly send
    // storeId/dealId (camelCase) as well as storeid/dealid (lowercase) -
    // accept any casing instead of silently rejecting valid requests.
    const queryLower: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.query)) {
      queryLower[key.toLowerCase()] = String(value);
    }
    const storeid = queryLower['storeid'];
    const dealid = queryLower['dealid'];

    if (!storeid || !dealid) {
      return res.status(400).json({
        error: 'Missing required parameters',
        required: ['storeid', 'dealid'],
        example: '/shopee?storeid={STORE_ID}&dealid={PRODUCT_ID}',
        note: 'Parameter names are accepted in any casing (storeId, storeid, STOREID, ...)'
      });
    }

    if (!validateStoreId(storeid) || !validateProductId(dealid)) {
      return res.status(400).json({
        error: 'Invalid parameters',
        message: 'storeid and dealid must be numeric'
      });
    }

    const data = await scrapePcEndpoint(storeid, dealid);
    return res.json(data);
  } catch (error: any) {
    console.error('API Error:', error.message);
    return res.status(502).json({
      error: 'Failed to scrape data',
      message: error.message
    });
  }
});

// Config endpoint
app.get('/config', (_req: Request, res: Response) => {
  res.json({
    environment: NODE_ENV,
    port: PORT,
    scraper: {
      timeout: parseInt(process.env.SCRAPER_TIMEOUT || '30000', 10),
      retries: parseInt(process.env.SCRAPER_RETRIES || '3', 10),
      retryDelay: parseInt(process.env.SCRAPER_RETRY_DELAY || '1000', 10),
      rateLimit: parseInt(process.env.SCRAPER_RATE_LIMIT || '10', 10),
      cacheTtlSeconds: parseInt(process.env.CACHE_TTL || '600', 10)
    },
    proxy: getProxyStats(),
    userAgentsCount: (process.env.USER_AGENTS || '').split(',').filter(Boolean).length || 4
  });
});

// Info endpoint
app.get('/info', (_req: Request, res: Response) => {
  res.json({
    name: 'Shopee Scraper API',
    version: '1.1.0',
    endpoints: {
      health: '/health',
      config: '/config',
      scrape: '/shopee?storeid={STORE_ID}&dealid={PRODUCT_ID}',
      info: '/info'
    },
    mode: 'Direct HTTP request to Shopee public endpoint (no third-party scraping service, no headless browser)'
  });
});

const server = app.listen(PORT, () => {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Shopee Scraper API`);
  console.log(`${'='.repeat(60)}`);
  console.log(`\nEnvironment: ${NODE_ENV}`);
  console.log(`Server running on: http://localhost:${PORT}`);
  console.log(`\nAvailable endpoints:`);
  console.log(`  • Health:  http://localhost:${PORT}/health`);
  console.log(`  • Config:  http://localhost:${PORT}/config`);
  console.log(`  • Scrape:  http://localhost:${PORT}/shopee?storeid={STORE_ID}&dealid={PRODUCT_ID}`);
  console.log(`  • Info:    http://localhost:${PORT}/info`);
  console.log(`\n${'='.repeat(60)}\n`);
});

process.on('SIGINT', () => {
  console.log('\n\nShutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
