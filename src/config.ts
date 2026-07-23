import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

export const config = {
  // Server configuration
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // Cache configuration
  cacheTtl: parseInt(process.env.CACHE_TTL || '300'), // seconds
  
  // Scraper configuration
  scraper: {
    timeout: parseInt(process.env.SCRAPER_TIMEOUT || '30000'), // milliseconds
    retries: parseInt(process.env.SCRAPER_RETRIES || '3'),
    retryDelay: parseInt(process.env.SCRAPER_RETRY_DELAY || '1000'), // milliseconds
    concurrency: parseInt(process.env.SCRAPER_CONCURRENCY || '5'),
    rateLimit: parseInt(process.env.SCRAPER_RATE_LIMIT || '10') // requests per second
  },
  
  // Proxy configuration (optional)
  proxy: {
    enabled: process.env.PROXY_ENABLED === 'true' || false,
    list: process.env.PROXY_LIST ? process.env.PROXY_LIST.split(',') : [],
    rotationStrategy: process.env.PROXY_ROTATION_STRATEGY || 'round-robin' // round-robin, random, or least-used
  },
  
  // Logging configuration
  log: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || 'logs/combined.log',
    maxSize: parseInt(process.env.LOG_MAX_SIZE || '10485760'), // 10MB
    maxFiles: parseInt(process.env.LOG_MAX_FILES || '5')
  },
  
  // Anti-detection configuration
  antiDetection: {
    userAgents: process.env.USER_AGENTS ? process.env.USER_AGENTS.split(',') : [],
    randomDelay: {
      min: parseInt(process.env.RANDOM_DELAY_MIN || '500'), // milliseconds
      max: parseInt(process.env.RANDOM_DELAY_MAX || '2000') // milliseconds
    }
  }
};

// Validate configuration
if (config.proxy.enabled && config.proxy.list.length === 0) {
  console.warn('Proxy is enabled but no proxies are configured');
}