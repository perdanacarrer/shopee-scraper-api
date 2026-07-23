import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { scrapePcEndpoint } from './services/scraper';
import { getProxyStats } from './services/proxy';

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
    scraperAPI: process.env.USE_SCRAPER_API === 'true' ? 'ENABLED' : 'DISABLED',
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

// Config endpoint
app.get('/config', (_req: Request, res: Response) => {
  res.json({
    environment: NODE_ENV,
    port: PORT,
    scraper: {
      timeout: parseInt(process.env.SCRAPER_TIMEOUT || '30000', 10),
      retries: parseInt(process.env.SCRAPER_RETRIES || '3', 10),
      retryDelay: parseInt(process.env.SCRAPER_RETRY_DELAY || '1000', 10),
      rateLimit: parseInt(process.env.SCRAPER_RATE_LIMIT || '10', 10)
    },
    scraperAPI: {
      enabled: process.env.USE_SCRAPER_API === 'true',
      keyConfigured: !!process.env.SCRAPER_API_KEY
    },
    proxy: getProxyStats(),
    userAgentsCount: (process.env.USER_AGENTS || '').split(',').length
  });
});

// Info endpoint
app.get('/info', (_req: Request, res: Response) => {
  res.json({
    name: 'Shopee Scraper API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      config: '/config',
      scrape: '/shopee?storeid={STORE_ID}&dealid={PRODUCT_ID}',
      info: '/info'
    },
    scraperMode: process.env.USE_SCRAPER_API === 'true' ? 'ScraperAPI' : 'Direct Proxy',
    notes: 'Configure SCRAPER_API_KEY in .env for best results'
  });
});

const server = app.listen(PORT, () => {
  const protocol = 'http';
  const host = 'localhost';
  const mode = process.env.USE_SCRAPER_API === 'true' ? '🤖 ScraperAPI Mode' : '🔗 Direct Proxy Mode';
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Shopee Scraper API - ${mode}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`\nEnvironment: ${NODE_ENV}`);
  console.log(`Server running on: ${protocol}://${host}:${PORT}`);
  console.log(`\nAvailable endpoints:`);
  console.log(`  • Health:  ${protocol}://${host}:${PORT}/health`);
  console.log(`  • Config:  ${protocol}://${host}:${PORT}/config`);
  console.log(`  • Scrape:  ${protocol}://${host}:${PORT}/shopee?storeid={STORE_ID}&dealid={PRODUCT_ID}`);
  console.log(`  • Info:    ${protocol}://${host}:${PORT}/info`);
  console.log(`\n${'='.repeat(60)}\n`);
});

process.on('SIGINT', () => {
  console.log('\n\nShutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});