export async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      if (attempt < maxRetries - 1) {
        const backoffDelay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
        console.log(`Retry attempt ${attempt + 1}/${maxRetries} after ${backoffDelay}ms`);
        await delay(backoffDelay);
      }
    }
  }

  throw lastError || new Error('Max retries exceeded');
}

export function validateProductId(id: string): boolean {
  return /^\d+$/.test(id);
}

export function validateStoreId(id: string): boolean {
  return /^\d+$/.test(id);
}

/**
 * Minimal in-memory TTL cache.
 * Keeps memory footprint small: a single Map, lazy expiry on read,
 * plus a periodic sweep so stale entries don't accumulate.
 */
export class TTLCache<T> {
  private store = new Map<string, { value: T; expiresAt: number }>();
  private sweepTimer: NodeJS.Timeout;

  constructor(private defaultTtlMs: number, sweepIntervalMs: number = 60_000) {
    this.sweepTimer = setInterval(() => this.sweep(), sweepIntervalMs);
    // Don't keep the Node process alive just for this timer.
    this.sweepTimer.unref?.();
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T, ttlMs: number = this.defaultTtlMs): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) this.store.delete(key);
    }
  }

  get size(): number {
    return this.store.size;
  }
}
