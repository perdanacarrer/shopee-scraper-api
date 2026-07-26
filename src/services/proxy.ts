import http from 'http';
import https from 'https';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { HttpProxyAgent } = require('http-proxy-agent');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { HttpsProxyAgent } = require('https-proxy-agent');
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

// Initialize proxy list
if (process.env.PROXY_LIST) {
  proxyConfig.list = process.env.PROXY_LIST.split(',').map(p => {
    const proxy = p.trim();
    return proxy.startsWith('http') ? proxy : `http://${proxy}`;
  });
  console.log(`[PROXY] Loaded ${proxyConfig.list.length} proxies`);
}

// Single proxy URL takes precedence
if (process.env.PROXY_URL) {
  const url = process.env.PROXY_URL.trim();
  proxyConfig.url = url.startsWith('http') ? url : `http://${url}`;
  console.log(`[PROXY] Single proxy configured`);
}

export function getNextProxy(): string | null {
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
  } else {
    // Random strategy
    const randomIndex = Math.floor(Math.random() * proxyConfig.list.length);
    return proxyConfig.list[randomIndex];
  }
}

export function createProxyAgent(protocol: 'http' | 'https'): http.Agent | https.Agent {
  const AgentClass = protocol === 'http' ? http.Agent : https.Agent;
  const timeout = parseInt(process.env.SCRAPER_TIMEOUT || '30000', 10);

  if (!proxyConfig.enabled) {
    console.log(`[PROXY] Proxy disabled`);
    return new AgentClass({
      keepAlive: true,
      keepAliveMsecs: 1000,
      maxSockets: 50,
      maxFreeSockets: 10,
      timeout
    });
  }

  const proxyUrl = getNextProxy();

  if (!proxyUrl) {
    console.warn('[PROXY] ⚠️  PROXY_ENABLED=true but no proxy URLs found');
    return new AgentClass({
      keepAlive: true,
      keepAliveMsecs: 1000,
      maxSockets: 50,
      maxFreeSockets: 10,
      timeout
    });
  }

  console.log(`[PROXY] Using proxy: ${proxyUrl}`);

  // BUG FIX: this used to build a plain (non-proxying) Agent, so
  // PROXY_ENABLED/PROXY_URL/PROXY_LIST had no actual effect on outgoing
  // requests. HttpProxyAgent/HttpsProxyAgent are the packages that were
  // already in package.json for exactly this purpose but were unused.
  return protocol === 'http'
    ? (new HttpProxyAgent(proxyUrl, { keepAlive: true, timeout }) as unknown as http.Agent)
    : (new HttpsProxyAgent(proxyUrl, { keepAlive: true, timeout }) as unknown as https.Agent);
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