import NodeCache from 'node-cache';
import { logger } from './logger';

export class CacheManager {
  private cache: NodeCache;

  constructor(ttlSeconds: number = 300) {
    this.cache = new NodeCache({
      stdTTL: ttlSeconds,
      checkperiod: ttlSeconds * 0.2,
      useClones: false
    });
    
    logger.info(`Cache initialized with TTL: ${ttlSeconds} seconds`);
  }

  get(key: string): any {
    const value = this.cache.get(key);
    if (value) {
      logger.debug(`Cache hit for key: ${key}`);
    }
    return value;
  }

  set(key: string, value: any, ttl?: number): boolean {
    const result = this.cache.set(key, value, ttl || 300);
    if (result) {
      logger.debug(`Cache set for key: ${key}`);
    }
    return result;
  }

  delete(key: string): number {
    const result = this.cache.del(key);
    if (result > 0) {
      logger.debug(`Cache deleted for key: ${key}`);
    }
    return result;
  }

  flush(): void {
    this.cache.flushAll();
    logger.info('Cache flushed');
  }

  getStats(): NodeCache.Stats {
    return this.cache.getStats();
  }

  getKeys(): string[] {
    return this.cache.keys();
  }

  getTtl(key: string): number | undefined {
    return this.cache.getTtl(key);
  }
}