import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { ShopeeScraper } from './scraper';
import { CacheManager } from './cache';
import { logger } from './logger';

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(cors());
app.use(express.json());

// Rate limiting - lebih longgar untuk testing
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Too many requests, please slow down.'
});
app.use('/api/shopee', limiter);

// Initialize
const cache = new CacheManager(600);
const scraper = new ShopeeScraper(cache);

// Health check
app.get('/health', (_req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    puppeteerAvailable: true // Will show if puppeteer is loaded
  });
});

// Test connection endpoint
app.get('/api/test', async (_req, res) => {
  try {
    const result = await scraper.testConnection();
    res.json(result);
  } catch (error) {
    res.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Single item scraping
app.get('/api/shopee', async (req, res) => {
  try {
    const { storeId, dealId } = req.query;

    if (!storeId || !dealId) {
      return res.status(400).json({
        error: 'Missing required parameters: storeId and dealId are required'
      });
    }

    const storeIdStr = String(storeId);
    const dealIdStr = String(dealId);

    if (!/^\d+$/.test(storeIdStr) || !/^\d+$/.test(dealIdStr)) {
      return res.status(400).json({
        error: 'Invalid parameters: storeId and dealId must be numeric'
      });
    }

    logger.info(`Scraping data for storeId: ${storeIdStr}, dealId: ${dealIdStr}`);
    const data = await scraper.scrapeItem(storeIdStr, dealIdStr);

    return res.json(data);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error in /api/shopee endpoint:', error);
    return res.status(500).json({
      error: 'Failed to scrape product data',
      message: errorMessage
    });
  }
});

// Batch scraping
app.post('/api/shopee/batch', async (req, res) => {
  try {
    const { items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: 'Invalid request: items array is required'
      });
    }

    if (items.length > 10) {
      return res.status(400).json({
        error: 'Maximum 10 items per batch request'
      });
    }

    const results = [];
    const errors = [];

    for (const item of items) {
      try {
        const { storeId, dealId } = item;
        if (!storeId || !dealId) {
          errors.push({ item, error: 'Missing storeId or dealId' });
          continue;
        }

        const data = await scraper.scrapeItem(String(storeId), String(dealId));
        results.push({ storeId, dealId, data });
        
        // Delay between requests
        await new Promise(resolve => setTimeout(resolve, 5000));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors.push({ item, error: errorMessage });
      }
    }

    return res.json({
      success: results.length,
      failed: errors.length,
      results,
      errors
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error in batch endpoint:', error);
    return res.status(500).json({
      error: 'Batch scraping failed',
      message: errorMessage
    });
  }
});

// Start server
app.listen(port, () => {
  logger.info(`Shopee Scraper API running on port ${port}`);
  logger.info(`Health check: http://localhost:${port}/health`);
  logger.info(`Test connection: http://localhost:${port}/api/test`);
  logger.info(`Scrape endpoint: http://localhost:${port}/api/shopee?storeId=STORE_ID&dealId=DEAL_ID`);
  logger.info(`Batch endpoint: http://localhost:${port}/api/shopee/batch`);
});

export default app;