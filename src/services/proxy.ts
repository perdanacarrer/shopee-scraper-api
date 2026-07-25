import http from 'http';
import https from 'https';
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import dotenv from 'dotenv';

dotenv.config();

interface ProxyConfig {
  enabled: boolean;
  url?: string;
  list?: string[];
  rotationStrategy: 'round-robin' | 'random';
  currentIndex: number;
}

const proxyConfig: ProxyConfig = {
  enabled: process.env.PROXY_ENABLED === 'true',
  rotationStrategy: (process.env.PROXY_ROTATION_STRATEGY as 'round-robin' | 'random') || 'round-robin',
  currentIndex: 0
};

// Initialize proxy list (optional - only used if you own/rent proxies yourself)
if (process.env.PROXY_LIST) {
  proxyConfig.list = process.env.PROXY_LIST.split(',')
    .map(p => p.trim())
    .filter(Boolean)
    .map(proxy => (proxy.startsWith('http') ? proxy : `http://${proxy}`));
  console.log(`[PROXY] Loaded ${proxyConfig.list.length} proxies`);
}

// Single proxy URL takes precedence
if (process.env.PROXY_URL) {
  const url = process.env.PROXY_URL.trim();
  proxyConfig.url = url.startsWith('http') ? url : `http://${url}`;
  console.log(`[PROXY] Single proxy configured`);
}

function getNextProxy(): string | null {
  if (proxyConfig.url) {
    return proxyConfig.url;
  }

  if (!proxyConfig.list || proxyConfig.list.length === 0) {
    return null;
  }

  if (proxyConfig.rotationStrategy === 'round-robin') {
    const proxy = proxyConfig.list[proxyConfig.currentIndex];
    proxyConfig.currentIndex = (proxyConfig.currentIndex + 1) % proxyConfig.list.length;
    return proxy;
  }

  // Random strategy
  const randomIndex = Math.floor(Math.random() * proxyConfig.list.length);
  return proxyConfig.list[randomIndex];
}

const timeout = parseInt(process.env.SCRAPER_TIMEOUT || '30000', 10);

// Small, memory-friendly agent pool: one plain keep-alive agent per protocol,
// reused across all requests instead of creating a new agent per call.
const plainHttpAgent = new http.Agent({ keepAlive: true, maxSockets: 20, timeout });
const plainHttpsAgent = new https.Agent({ keepAlive: true, maxSockets: 20, timeout });

export function createProxyAgent(protocol: 'http' | 'https'): http.Agent | https.Agent {
  if (!proxyConfig.enabled) {
    return protocol === 'http' ? plainHttpAgent : plainHttpsAgent;
  }

  const proxyUrl = getNextProxy();

  if (!proxyUrl) {
    console.warn('[PROXY] PROXY_ENABLED=true but no PROXY_URL/PROXY_LIST configured, falling back to direct connection');
    return protocol === 'http' ? plainHttpAgent : plainHttpsAgent;
  }

  console.log(`[PROXY] Routing ${protocol.toUpperCase()} request through: ${proxyUrl}`);

  // A fresh agent per call is required here because rotation means the
  // upstream proxy can change request-to-request.
  return protocol === 'http'
    ? new HttpProxyAgent(proxyUrl, { timeout })
    : new HttpsProxyAgent(proxyUrl, { timeout });
}

export function getProxyStats(): {
  enabled: boolean;
  strategy: string;
  totalProxies: number;
  currentIndex: number;
  currentProxy?: string;
} {
  return {
    enabled: proxyConfig.enabled,
    strategy: proxyConfig.rotationStrategy,
    totalProxies: proxyConfig.list?.length || 0,
    currentIndex: proxyConfig.currentIndex,
    currentProxy: getNextProxy() || undefined
  };
}
