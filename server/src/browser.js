/**
 * Aether Browser — Playwright driver
 * AI App <-MCP-> Server <-Playwright-> Browser
 */
import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const SCRIPT = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'injected.js'), 'utf-8');

let browser, ctx;

export async function launch(opts = {}) {
  if (opts.cdpUrl) {
    browser = await chromium.connectOverCDP(opts.cdpUrl);
    ctx = browser.contexts()[0] || await browser.newContext();
  } else {
    browser = await chromium.launch({
      headless: opts.headless !== false,
      args: ['--disable-blink-features=AutomationControlled'],
    });
    ctx = await browser.newContext({
      viewport: opts.viewport || { width: 1280, height: 800 },
      locale: opts.locale || 'zh-CN',
      userAgent: opts.userAgent, storageState: opts.storageState,
    });
  }
  await ctx.addInitScript(SCRIPT);
  console.error(`[Aether] Browser launched (headless: ${opts.headless !== false})`);
}

export async function close() { if (browser) { await browser.close(); browser = ctx = null; } }

// ── internals ───────────────────────────────────────────────────────────────

async function page() {
  if (!ctx) throw new Error('Browser not launched.');
  const pp = ctx.pages();
  const p = pp.length ? pp[pp.length - 1] : await ctx.newPage();
  if (!await p.evaluate(() => !!window.__aether).catch(() => false))
    await p.evaluate(SCRIPT).catch(() => {});
  return p;
}

const call = fn => page().then(fn);

// ── commands ────────────────────────────────────────────────────────────────

export async function navigate(p) {
  const pg = p.newTab ? await ctx.newPage() : await page();
  await pg.goto(p.url, { timeout: p.timeout || 30000, waitUntil: 'domcontentloaded' });
  await pg.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  if (!await pg.evaluate(() => !!window.__aether).catch(() => false))
    await pg.evaluate(SCRIPT).catch(() => {});
  return { url: pg.url(), title: await pg.title(), status: 'complete' };
}

export const getHintMap    = (p = {}) => call(pg => pg.evaluate(p => __aether.generateHintMap(p), p));
export const click         = p => call(pg => pg.evaluate(p => __aether.handleClick(p), p));
export const type          = p => call(pg => pg.evaluate(p => __aether.handleType(p), p));
export const scroll        = p => call(pg => pg.evaluate(p => __aether.handleScroll(p), p));
export const extract       = (p = {}) => call(pg => pg.evaluate(p => __aether.handleExtract(p), p));
export const waitFor       = (p = {}) => call(pg => pg.evaluate(p => __aether.handleWaitFor(p), p));
export const autoDismiss   = () => call(pg => pg.evaluate(() => ({ dismissed: __aether.autoDismiss() })));
export const detectQR      = () => call(pg => pg.evaluate(() => __aether.detectQR()));

export async function screenshot(p = {}) {
  const pg = await page();
  const buf = await pg.screenshot({ type: p.format || 'png', quality: p.format === 'jpeg' ? (p.quality || 80) : undefined });
  return { base64: buf.toString('base64'), mime: `image/${p.format || 'png'}`, url: pg.url(), title: await pg.title() };
}

export async function fullScreenshot(p = {}) {
  const pg = await page();
  const buf = await pg.screenshot({ type: p.format || 'png', quality: p.format === 'jpeg' ? (p.quality || 80) : undefined, fullPage: true });
  const dims = await pg.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }));
  return { base64: buf.toString('base64'), mime: `image/${p.format || 'png'}`, url: pg.url(), title: await pg.title(), dims };
}

export async function pageToPdf(p = {}) {
  const pg = await page();
  try {
    const buf = await pg.pdf({ printBackground: true, landscape: p.landscape || false });
    return { ok: true, pdf: buf.toString('base64'), url: pg.url(), title: await pg.title(), size: Math.round(buf.length / 1024) + 'KB' };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function executeJs(p) {
  const pg = await page();
  try { return { ok: true, result: await pg.evaluate(p.code) }; }
  catch (e) { return { ok: false, error: e.message }; }
}

export async function getTabs() {
  if (!ctx) return [];
  return Promise.all(ctx.pages().map(async (p, i) => ({ id: i, url: p.url(), title: await p.title().catch(() => ''), active: i === ctx.pages().length - 1 })));
}

export async function saveStorage(path) {
  if (!ctx) throw new Error('No context');
  await ctx.storageState({ path });
}
