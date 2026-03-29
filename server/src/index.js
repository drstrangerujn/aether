#!/usr/bin/env node
/**
 * Aether MCP Server v0.6.0 — Headless-first, simplified
 * AI <─ MCP/stdio ─> Server <─ Playwright ─> Browser
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { join } from 'path';
import { homedir } from 'os';
import * as B from './browser.js';

const VERSION = '0.6.0';
const mcp = new McpServer({ name: 'aether', version: VERSION });

// ─── audit log ─────────────────────────────────────────────────────────────

const log = [];

function audit(cmd, params) {
  const p = { ...params };
  if (p.password) p.password = '***';
  if (p.code) p.code = p.code.slice(0, 80) + '…';
  log.push({ cmd, p, ts: new Date().toISOString() });
  if (log.length > 500) log.shift();
}

// ─── helpers ───────────────────────────────────────────────────────────────

const txt = t => ({ content: [{ type: 'text', text: t }] });
const img = (b64, mime, cap) => ({ content: [{ type: 'image', data: b64, mimeType: mime }, { type: 'text', text: cap }] });
const json = o => txt(JSON.stringify(o, null, 2));

const run = (cmd, fn) => async p => { const r = await fn(p); audit(cmd, p); return json(r); };

// ─── tools ─────────────────────────────────────────────────────────────────

// navigation
mcp.tool('navigate', 'Open a URL.', { url: z.string(), newTab: z.boolean().optional(), timeout: z.number().optional() },
  run('navigate', B.navigate));

mcp.tool('get_hint_map', 'Page perception. Call FIRST.', { detail_level: z.enum(['minimal','standard','full']).optional(), auto_dismiss: z.boolean().optional() },
  run('get_hint_map', B.getHintMap));

// interaction
mcp.tool('click', 'Click element.', { hint_id: z.string().optional(), text: z.string().optional(), selector: z.string().optional() },
  run('click', B.click));

mcp.tool('type', 'Type into input.', { hint_id: z.string().optional(), text: z.string(), selector: z.string().optional(), clear: z.boolean().optional(), pressEnter: z.boolean().optional() },
  run('type', B.type));

mcp.tool('scroll', 'Scroll page.', { direction: z.enum(['up','down','left','right','top','bottom']), amount: z.number().optional() },
  run('scroll', B.scroll));

mcp.tool('extract', 'Extract text.', { hint_id: z.string().optional(), selector: z.string().optional() },
  run('extract', B.extract));

mcp.tool('wait_for', 'Wait for condition.', { selector: z.string().optional(), text: z.string().optional(), url: z.string().optional(), condition: z.enum(['loaded']).optional(), timeout: z.number().optional() },
  run('wait_for', B.waitFor));

mcp.tool('auto_dismiss', 'Kill popups/banners.', {},
  run('auto_dismiss', B.autoDismiss));

mcp.tool('execute_js', 'Run JS in page.', { code: z.string() },
  run('execute_js', B.executeJs));

// visual & detection
mcp.tool('detect_qr', 'Find QR codes on page. Useful for headless login — forward QR to Telegram/WeChat.', {}, async () => {
  const r = await B.detectQR(); audit('detect_qr', {});
  if (!r.found) return txt('No QR codes.');
  const c = r.qrcodes.flatMap(q => [q.dataUrl && { type: 'image', data: q.dataUrl.replace(/^data:image\/\w+;base64,/, ''), mimeType: 'image/png' }, q.src && { type: 'text', text: `QR: ${q.src}` }].filter(Boolean));
  c.push({ type: 'text', text: `${r.count} QR code(s)` });
  return { content: c };
});

mcp.tool('screenshot', 'Viewport screenshot.', { format: z.enum(['png','jpeg']).optional(), quality: z.number().optional() },
  async p => { const r = await B.screenshot(p); audit('screenshot', p); return img(r.base64, r.mime, `${r.title} — ${r.url}`); });

mcp.tool('full_screenshot', 'Full page screenshot.', { format: z.enum(['png','jpeg']).optional(), quality: z.number().optional() },
  async p => { const r = await B.fullScreenshot(p); audit('full_screenshot', p); return img(r.base64, r.mime, `${r.title} | ${r.dims.w}x${r.dims.h}`); });

mcp.tool('page_to_pdf', 'Export PDF.', { landscape: z.boolean().optional() },
  async p => { const r = await B.pageToPdf(p); audit('page_to_pdf', p); return r.ok ? { content: [{ type: 'resource', resource: { uri: `data:application/pdf;base64,${r.pdf}`, mimeType: 'application/pdf', text: r.pdf } }, { type: 'text', text: `${r.title} (${r.size})` }] } : txt(`Failed: ${r.error}`); });

// session
mcp.tool('save_session', 'Save cookies for next launch.', { path: z.string().optional() },
  async ({ path }) => { const p = path || join(homedir(), '.aether', 'session.json'); await B.saveStorage(p); audit('save_session', { path: p }); return txt(`Saved → ${p}`); });

mcp.tool('get_tabs', 'List tabs.', {}, async () => { audit('get_tabs', {}); return json(await B.getTabs()); });

mcp.tool('get_audit_log', 'Action history.', { limit: z.number().optional() },
  async ({ limit = 20 }) => json(log.slice(-limit)));

// ─── start ─────────────────────────────────────────────────────────────────

function args() {
  const a = process.argv.slice(2), o = { headless: true, viewport: { width: 1280, height: 800 } };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--headed') o.headless = false;
    else if (a[i] === '--cdp') o.cdpUrl = a[++i];
    else if (a[i] === '--viewport') { const [w, h] = a[++i].split('x').map(Number); o.viewport = { width: w, height: h }; }
    else if (a[i] === '--storage-state') o.storageState = a[++i];
    else if (a[i] === '--locale') o.locale = a[++i];
    else if (a[i] === '--user-agent') o.userAgent = a[++i];
  }
  return o;
}

(async () => {
  const o = args();
  await B.launch(o);
  console.error(`[Aether] v${VERSION} started — Playwright — headless: ${o.headless}`);
  await mcp.connect(new StdioServerTransport());
  const quit = async () => { await B.close(); process.exit(0); };
  process.on('SIGINT', quit);
  process.on('SIGTERM', quit);
})().catch(e => { console.error('[Aether] Fatal:', e); process.exit(1); });
