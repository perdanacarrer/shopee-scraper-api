import puppeteer from 'puppeteer-extra';
import type { Browser, Page } from 'puppeteer';
import path from 'path';
import { getNextProxy } from './proxy';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

/**
 * WHY THIS EXISTS
 * ----------------
 * shopee.tw/api/v4/pdp/get_pc and get_rw are NOT plain REST endpoints.
 * Every call must carry headers that Shopee's own obfuscated front-end
 * JS (the "SPX"/"af-ac" security SDK) generates at request time, e.g.:
 *
 *   af-ac-enc-dat, af-ac-enc-sz-token, x-sap-access-f/s/t, x-sap-ri,
 *   x-sap-sec, x-sz-sdk-version, x-csrftoken
 *
 * These are derived from a device fingerprint + session state using a
 * signing routine that only exists inside that minified script. There is
 * no documented formula for them, so building requests "by hand" with
 * axios (as the previous code did) will not get past the anti-bot layer —
 * it either gets a 403/429, or a 200 with an empty/blocked payload.
 *
 * The reliable way to get a genuine payload is to let a real browser do
 * the request: load the actual product page so Shopee's security script
 * runs and initializes itself, then trigger the API calls using the
 * page's OWN fetch() from inside that same execution context. Because
 * the script patches window.fetch/XHR on the page, it signs the request
 * for us automatically — we're not reverse engineering the signing
 * algorithm, we're just asking the already-loaded page to make the call
 * it would normally make when a human scrolls the page.
 */

let browserPromise: Promise<Browser> | null = null;
let browserProxyCreds: { username: string; password: string } | null = null;

function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1366,768'
    ];

    // Route through the same proxy configured for axios (PROXY_ENABLED /
    // PROXY_URL / PROXY_LIST in .env) instead of the server's own IP.
    // This matters more for this strategy than for axios, since this is
    // the strategy that actually talks to Shopee successfully.
    if (process.env.PROXY_ENABLED === 'true') {
      const proxyUrl = getNextProxy();
      if (proxyUrl) {
        try {
          const parsed = new URL(proxyUrl);
          args.push(`--proxy-server=${parsed.protocol}//${parsed.host}`);
          if (parsed.username) {
            browserProxyCreds = {
              username: decodeURIComponent(parsed.username),
              password: decodeURIComponent(parsed.password)
            };
          }
          console.log(`[BROWSER] Using proxy: ${parsed.protocol}//${parsed.host}`);
        } catch {
          console.warn(`[BROWSER] Could not parse PROXY_URL "${proxyUrl}", launching without proxy`);
        }
      }
    }

    browserPromise = puppeteer.launch({
      headless: 'new' as any,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      // Persist cookies/localStorage/session across requests in a real
      // profile directory instead of a throwaway one each launch. A
      // browser that already has a Shopee session from a previous
      // successful visit looks a lot less like a bot than one that shows
      // up with zero history every single time.
      userDataDir: path.join(process.cwd(), '.puppeteer-profile'),
      args
    }) as unknown as Promise<Browser>;
  }
  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  if (browserPromise) {
    const browser = await browserPromise;
    await browser.close();
    browserPromise = null;
  }
}

interface ApiCallResult {
  status: number;
  body: any;
}

interface PdpResult {
  get_pc: ApiCallResult;
  get_rw: ApiCallResult | null;
}

async function callInPage(page: Page, path: string, sid: string, iid: string): Promise<ApiCallResult> {
  return page.evaluate(
    async (p: string, s: string, i: string) => {
      const res = await fetch(`${p}?item_id=${i}&shop_id=${s}`, {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' }
      });
      const status = res.status;
      let body: any = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      return { status, body };
    },
    path,
    sid,
    iid
  );
}

/**
 * Navigate to the real PDP so the anti-bot SDK boots, then call get_pc
 * (and optionally get_rw) from inside the page context.
 *
 * IMPORTANT: this function does NOT throw just because Shopee's own
 * payload says "no data" — a 200 response with {error, error_msg, data:
 * null} is Shopee's genuine, authoritative answer (e.g. rate-limited,
 * region-locked, item pulled), not a scraping bug. We return it as-is so
 * the caller can see exactly what Shopee said instead of a made-up
 * generic message. We only throw for real infrastructure failures
 * (navigation timeout, non-JSON response, etc.).
 */
export async function fetchPdpViaBrowser(
  shopId: string,
  itemId: string,
  opts: { withReviews?: boolean; timeout?: number } = {}
): Promise<PdpResult> {
  const { withReviews = false, timeout = 30000 } = opts;
  const browser = await getBrowser();
  const page: Page = await browser.newPage();

  try {
    if (browserProxyCreds) {
      await page.authenticate(browserProxyCreds);
    }

    await page.setViewport({ width: 1366, height: 768 });
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'
    });

    // Small randomized pause before navigating, so back-to-back requests
    // from this process don't all fire at the exact same cadence.
    await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1000));

    const productUrl = `https://shopee.tw/product/${shopId}/${itemId}`;

    console.log(`[BROWSER] Navigating to ${productUrl}`);
    await page.goto(productUrl, {
      waitUntil: 'domcontentloaded',
      timeout
    });

    // Give Shopee's security SDK time to initialize and set its cookies
    // (SPC_EC, SPC_ST, SPC_SI, csrftoken, etc.) before we call the API.
    await page.waitForFunction(
      () => (window as any).fetch !== undefined,
      { timeout }
    );
    await new Promise(resolve => setTimeout(resolve, 2500 + Math.random() * 2000));

    const get_pc = await callInPage(page, '/api/v4/pdp/get_pc', shopId, itemId);

    // Always log Shopee's actual answer — this is the single most useful
    // line for diagnosing why an item didn't come back.
    console.log(
      `[BROWSER] get_pc → HTTP ${get_pc.status}, error=${get_pc.body?.error ?? 'n/a'}, ` +
      `error_msg=${get_pc.body?.error_msg ?? 'n/a'}, has_item=${!!get_pc.body?.data?.item}`
    );

    if (!get_pc.body) {
      // Genuinely didn't get JSON back (network/proxy issue, WAF HTML
      // challenge page, etc.) — this really is an infra failure.
      throw new Error(`get_pc returned HTTP ${get_pc.status} with a non-JSON body`);
    }

    let get_rw: ApiCallResult | null = null;
    if (withReviews && get_pc.body?.data?.item) {
      get_rw = await callInPage(page, '/api/v4/pdp/get_rw', shopId, itemId);
      console.log(`[BROWSER] get_rw → HTTP ${get_rw.status}`);
    }

    console.log(`[BROWSER] ✓ Got response from Shopee via browser context`);
    return { get_pc, get_rw };
  } finally {
    await page.close();
  }
}
