import http from 'http';
import https from 'https';
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
  } else {
    // Random strategy
    const randomIndex = Math.floor(Math.random() * proxyConfig.list.length);
    return proxyConfig.list[randomIndex];
  }
}

export function createProxyAgent(protocol: 'http' | 'https'): http.Agent | https.Agent {
  const AgentClass = protocol === 'http' ? http.Agent : https.Agent;

  if (!proxyConfig.enabled) {
    console.log(`[PROXY] Proxy disabled`);
    return new AgentClass({
      keepAlive: true,
      keepAliveMsecs: 1000,
      maxSockets: 50,
      maxFreeSockets: 10,
      timeout: parseInt(process.env.SCRAPER_TIMEOUT || '30000', 10)
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
      timeout: parseInt(process.env.SCRAPER_TIMEOUT || '30000', 10)
    });
  }

  console.log(`[PROXY] Using proxy: ${proxyUrl}`);

  return new AgentClass({
    keepAlive: true,
    keepAliveMsecs: 1000,
    maxSockets: 50,
    maxFreeSockets: 10,
    timeout: parseInt(process.env.SCRAPER_TIMEOUT || '30000', 10)
  });
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