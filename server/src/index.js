#!/usr/bin/env node
/**
 * Aether MCP Server v0.5.0 — Playwright, no extension
 * AI <─ MCP/stdio ─> Server <─ Playwright ─> Browser
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { join } from 'path';
import { homedir } from 'os';
import * as B from './browser.js';
import { startRecording, recordStep, stopRecording, isRecording, findPath, markReplayed, listPaths, deletePath } from './cache.js';

const VERSION = '0.5.0';
const mcp = new McpServer({ name: 'aether', version: VERSION });

// ─── state ──────────────────────────────────────────────────────────────────

const log = [];
let lastHint = null;

function audit(cmd, params) {
  const p = { ...params };
  if (p.password) p.password = '***';
  if (p.code) p.code = p.code.slice(0, 80) + '…';
  log.push({ cmd, p, ts: new Date().toISOString() });
  if (log.length > 500) log.shift();
}

// ─── safe mode ──────────────────────────────────────────────────────────────

const SENSITIVE = {
  payment: /pay|checkout|purchase|buy|order|cart|billing/i,
  delete:  /delete|remove|trash|destroy|unsubscribe/i,
  send:    /send|submit|post|publish|reply|forward|compose/i,
  account: /password|account|setting|profile|security|logout|sign.?out/i,
};

const SAFE = new Set(['navigate','get_hint_map','extract','screenshot','full_screenshot','scroll','wait_for','get_tabs','get_audit_log','auto_dismiss','detect_qr','page_to_pdf']);
const policy = new Map();
let safeOn = true;
const pending = new Map();
let seq = 0;

function classify(cmd, p) {
  if (!safeOn || SAFE.has(cmd)) return null;
  const t = [p.text, p.hint_id, p.selector, p.url].filter(Boolean).join(' ');
  for (const [cat, re] of Object.entries(SENSITIVE)) {
    if (re.test(t)) { const v = policy.get(cat); if (v === 'always') return null; if (v === 'never') return { blocked: true, cat }; return { cat }; }
  }
  if (cmd === 'execute_js') return { cat: 'code_execution' };
  return null;
}

async function guarded(cmd, params, fn) {
  const s = classify(cmd, params);
  if (s?.blocked) return txt(`⛔ "${s.cat}" blocked. Change with safe_mode_policy.`);
  if (s) {
    const id = ++seq;
    pending.set(id, { cat: s.cat, cmd, params, fn });
    setTimeout(() => pending.delete(id), 300_000);
    return txt(JSON.stringify({ _aether_approval_required: true, approval_id: id, category: s.cat, description: [cmd, params.text && `"${params.text}"`, params.hint_id, params.url].filter(Boolean).join(' | '), options: ['approve','approve_all','approve_once','reject','reject_always'] }, null, 2));
  }
  const r = await fn();
  audit(cmd, params);
  if (isRecording()) recordStep(cmd, params, lastHint);
  return txt(JSON.stringify(r, null, 2));
}

// ─── helpers ────────────────────────────────────────────────────────────────

const txt = t => ({ content: [{ type: 'text', text: t }] });
const img = (b64, mime, cap) => ({ content: [{ type: 'image', data: b64, mimeType: mime }, { type: 'text', text: cap }] });
const json = o => txt(JSON.stringify(o, null, 2));

// ─── tools ──────────────────────────────────────────────────────────────────

// core
mcp.tool('navigate', 'Open a URL.', { url: z.string(), newTab: z.boolean().optional(), timeout: z.number().optional() },
  async p => { const r = await B.navigate(p); audit('navigate', p); return json(r); });

mcp.tool('get_hint_map', 'Page perception. Call FIRST.', { detail_level: z.enum(['minimal','standard','full']).optional(), auto_dismiss: z.boolean().optional() },
  async p => { const r = await B.getHintMap(p); lastHint = r; audit('get_hint_map', p); if (isRecording()) recordStep('get_hint_map', p, r); return json(r); });

mcp.tool('click', 'Click element. Sensitive clicks need approval.', { hint_id: z.string().optional(), text: z.string().optional(), selector: z.string().optional() },
  p => guarded('click', p, () => B.click(p)));

mcp.tool('type', 'Type into input.', { hint_id: z.string().optional(), text: z.string(), selector: z.string().optional(), clear: z.boolean().optional(), pressEnter: z.boolean().optional() },
  p => guarded('type', p, () => B.type(p)));

mcp.tool('scroll', 'Scroll page.', { direction: z.enum(['up','down','left','right','top','bottom']), amount: z.number().optional() },
  async p => json(await B.scroll(p)));

mcp.tool('extract', 'Extract text.', { hint_id: z.string().optional(), selector: z.string().optional() },
  async p => json(await B.extract(p)));

mcp.tool('wait_for', 'Wait for condition.', { selector: z.string().optional(), text: z.string().optional(), url: z.string().optional(), condition: z.enum(['loaded']).optional(), timeout: z.number().optional() },
  async p => json(await B.waitFor(p)));

mcp.tool('auto_dismiss', 'Kill popups/banners.', {},
  async () => json(await B.autoDismiss()));

mcp.tool('execute_js', 'Run JS. Needs approval.', { code: z.string() },
  p => guarded('execute_js', p, () => B.executeJs(p)));

// visual
mcp.tool('screenshot', 'Viewport screenshot.', { format: z.enum(['png','jpeg']).optional(), quality: z.number().optional() },
  async p => { const r = await B.screenshot(p); return img(r.base64, r.mime, `${r.title} — ${r.url}`); });

mcp.tool('full_screenshot', 'Full page screenshot.', { format: z.enum(['png','jpeg']).optional(), quality: z.number().optional() },
  async p => { const r = await B.fullScreenshot(p); return img(r.base64, r.mime, `${r.title} | ${r.dims.w}x${r.dims.h}`); });

mcp.tool('page_to_pdf', 'Export PDF.', { landscape: z.boolean().optional() },
  async p => { const r = await B.pageToPdf(p); return r.ok ? { content: [{ type: 'resource', resource: { uri: `data:application/pdf;base64,${r.pdf}`, mimeType: 'application/pdf', text: r.pdf } }, { type: 'text', text: `${r.title} (${r.size})` }] } : txt(`Failed: ${r.error}`); });

mcp.tool('detect_qr', 'Find QR codes.', {}, async () => {
  const r = await B.detectQR();
  if (!r.found) return txt('No QR codes.');
  const c = r.qrcodes.flatMap(q => [q.dataUrl && { type: 'image', data: q.dataUrl.replace(/^data:image\/\w+;base64,/, ''), mimeType: 'image/png' }, q.src && { type: 'text', text: `QR: ${q.src}` }].filter(Boolean));
  c.push({ type: 'text', text: `${r.count} QR code(s)` });
  return { content: c };
});

// safe mode
mcp.tool('safe_mode_respond', 'Answer approval request.', { approval_id: z.number(), decision: z.enum(['approve','approve_all','approve_once','reject','reject_always']) },
  async ({ approval_id, decision }) => {
    const p = pending.get(approval_id); if (!p) return txt('No such pending approval.');
    pending.delete(approval_id);
    if (decision === 'approve_all') policy.set(p.cat, 'always');
    else if (decision === 'approve_once') policy.set(p.cat, 'session');
    else if (decision === 'reject_always') policy.set(p.cat, 'never');
    if (decision.startsWith('approve')) { try { return json(await p.fn()); } catch (e) { return txt(`Approved but failed: ${e.message}`); } }
    return txt(`Rejected. "${p.cat}" policy updated.`);
  });

mcp.tool('safe_mode_policy', 'View/change policies.', { action: z.enum(['status','set','reset','toggle']), category: z.string().optional(), policy: z.enum(['always','session','never']).optional() },
  async ({ action, category, policy: pol }) => {
    if (action === 'toggle') { safeOn = !safeOn; return txt(`Safe Mode: ${safeOn ? 'ON' : 'OFF'}`); }
    if (action === 'reset') { policy.clear(); return txt('Reset.'); }
    if (action === 'set') { if (!category || !pol) return txt('Need category + policy.'); policy.set(category, pol); return txt(`${category} → ${pol}`); }
    return json({ on: safeOn, categories: Object.keys(SENSITIVE), policies: Object.fromEntries(policy), pending: pending.size });
  });

// cache
mcp.tool('cache_start', 'Record action path.', { label: z.string() },
  async ({ label }) => lastHint ? json(startRecording(label, lastHint)) : txt('Call get_hint_map first.'));

mcp.tool('cache_stop', 'Save recording.', {}, async () => json(stopRecording()));

mcp.tool('cache_replay', 'Replay path.', { label: z.string() }, async ({ label }) => {
  if (!lastHint) return txt('Call get_hint_map first.');
  const m = findPath(label, lastHint);
  if (!m.found) return txt('No match. Record with cache_start/stop.');
  const CMD = { navigate: B.navigate, click: B.click, type: B.type, scroll: B.scroll, extract: B.extract, wait_for: B.waitFor, auto_dismiss: B.autoDismiss, execute_js: B.executeJs };
  const res = []; let fail = -1;
  for (let i = 0; i < m.path.steps.length; i++) {
    const s = m.path.steps[i];
    if (s.command === 'get_hint_map' || !CMD[s.command]) { res.push({ step: i, skip: true }); continue; }
    try { await CMD[s.command](s.params); res.push({ step: i, cmd: s.command, ok: true }); await new Promise(r => setTimeout(r, 500)); }
    catch (e) { fail = i; res.push({ step: i, cmd: s.command, err: e.message }); break; }
  }
  if (fail === -1) markReplayed(m.key);
  return json({ cached: true, steps: m.path.steps.length, executed: res, ...(fail >= 0 ? { failedAt: fail } : { complete: true }) });
});

mcp.tool('cache_list', 'List cached paths.', { domain: z.string().optional() },
  async ({ domain }) => json(listPaths(domain)));

mcp.tool('cache_delete', 'Delete cached path.', { key: z.string() },
  async ({ key }) => json(deletePath(key)));

// util
mcp.tool('save_session', 'Save cookies for next launch.', { path: z.string().optional() },
  async ({ path }) => { const p = path || join(homedir(), '.aether', 'session.json'); await B.saveStorage(p); return txt(`Saved → ${p}`); });

mcp.tool('get_tabs', 'List tabs.', {}, async () => json(await B.getTabs()));

mcp.tool('get_audit_log', 'Action history.', { limit: z.number().optional() },
  async ({ limit = 20 }) => json(log.slice(-limit)));

// ─── start ──────────────────────────────────────────────────────────────────

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
  console.error(`[Aether] v${VERSION} started — Playwright — Safe Mode ON`);
  await mcp.connect(new StdioServerTransport());
  const quit = async () => { await B.close(); process.exit(0); };
  process.on('SIGINT', quit);
  process.on('SIGTERM', quit);
})().catch(e => { console.error('[Aether] Fatal:', e); process.exit(1); });
