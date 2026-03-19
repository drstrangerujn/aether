#!/usr/bin/env node

/**
 * Aether MCP Server v0.3.0
 *
 *   AI App <──MCP/stdio──> Aether Server <──WebSocket──> Chrome Extension
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebSocketServer } from 'ws';
import { z } from 'zod';
import {
  startRecording, recordStep, stopRecording, cancelRecording, isRecording,
  findPath, markReplayed, listPaths, deletePath,
} from './cache.js';
import {
  registerConnection, unregisterConnection, getConnection, getActiveConnections,
  labelProfile, addDomain, removeDomain, suggestProfile,
  listProfiles as listAllProfiles, deleteProfile,
} from './profiles.js';

const WS_PORT = 3899;
const VERSION = '0.4.0';

// ─── State ──────────────────────────────────────────────────────────────────

let activeProfileId = null;  // currently selected profile
let messageId = 0;
const pendingCommands = new Map();
const auditLog = [];
let lastHintMap = null;

// ─── Safe Mode ──────────────────────────────────────────────────────────────
//
// Sensitive actions are intercepted and returned to the AI client for user
// confirmation. The user can approve once, or set a policy:
//   "always" — auto-approve all future actions of this type
//   "session" — auto-approve for this session only
//   "never"  — always block this type
//
// The AI client (Claude/OpenClaw) presents the confirmation to the user and
// calls safe_mode_respond with the decision.

const SENSITIVE_PATTERNS = {
  payment:  /pay|checkout|purchase|buy|order|cart|billing/i,
  delete:   /delete|remove|trash|destroy|unsubscribe/i,
  send:     /send|submit|post|publish|reply|forward|compose/i,
  account:  /password|account|setting|profile|security|logout|sign.?out/i,
  download: /download|export|save.?as/i,
};

const safeModePolicies = new Map();   // "payment" -> "always" | "never" | "session"
let safeModeEnabled = true;
const pendingApprovals = new Map();   // approvalId -> { resolve, action }
let approvalId = 0;

function classifySensitivity(command, params) {
  if (!safeModeEnabled) return null;

  // navigate is always safe
  if (['navigate', 'get_hint_map', 'extract', 'screenshot',
       'scroll', 'wait_for', 'get_tabs', 'get_audit_log'].includes(command)) return null;

  // Check click/type targets against patterns
  const text = [params.text, params.hint_id, params.selector, params.url]
    .filter(Boolean).join(' ');

  for (const [category, regex] of Object.entries(SENSITIVE_PATTERNS)) {
    if (regex.test(text)) {
      const policy = safeModePolicies.get(category);
      if (policy === 'always') return null;       // pre-approved
      if (policy === 'never') return { blocked: true, category };
      return { category, matchedText: text };      // needs approval
    }
  }

  // execute_js is always sensitive
  if (command === 'execute_js') return { category: 'code_execution', matchedText: params.code?.slice(0, 80) };

  return null;
}

function requestApproval(category, command, params) {
  const id = ++approvalId;
  return new Promise((resolve) => {
    pendingApprovals.set(id, { resolve, category, command, params });
    // The promise is resolved when safe_mode_respond is called
    // If not responded within 5 minutes, auto-reject
    setTimeout(() => {
      if (pendingApprovals.has(id)) {
        pendingApprovals.delete(id);
        resolve({ approved: false, reason: 'timeout' });
      }
    }, 300_000);
  });
}

// ─── WebSocket ──────────────────────────────────────────────────────────────

const wss = new WebSocketServer({ port: WS_PORT });

wss.on('listening', () => {
  console.error(`[Aether] WebSocket listening on ws://localhost:${WS_PORT}`);
});

wss.on('connection', (ws) => {
  let profileId = null;

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'register') {
        profileId = msg.profileId || msg.client || 'default';
        const profile = registerConnection(profileId, ws, {
          version: msg.version,
          label: msg.profileName || profileId,
          userAgent: msg.userAgent,
        });
        // Auto-select first profile if none active
        if (!activeProfileId) activeProfileId = profileId;
        console.error(`[Aether] Profile "${profile.label}" connected (${profileId})`);
        return;
      }

      if (msg.type === 'response' && msg.id) {
        const p = pendingCommands.get(msg.id);
        if (p) {
          clearTimeout(p.timer);
          pendingCommands.delete(msg.id);
          msg.success ? p.resolve(msg.result) : p.reject(new Error(msg.error || 'Unknown'));
        }
      }
    } catch (e) {
      console.error('[Aether] Parse error:', e.message);
    }
  });

  ws.on('close', () => {
    if (profileId) {
      console.error(`[Aether] Profile "${profileId}" disconnected`);
      unregisterConnection(profileId);
      if (activeProfileId === profileId) {
        // Switch to next available
        const active = getActiveConnections();
        activeProfileId = active.length > 0 ? active[0].id : null;
      }
    }
    // Reject pending commands for this connection
    for (const [id, p] of pendingCommands) {
      clearTimeout(p.timer);
      p.reject(new Error('Extension disconnected'));
    }
    pendingCommands.clear();
  });
});

// ─── Extension bridge ───────────────────────────────────────────────────────

function sendToExtension(command, params = {}, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const conn = activeProfileId ? getConnection(activeProfileId) : null;
    const extensionWs = conn?.ws;
    if (!extensionWs || extensionWs.readyState !== 1) {
      const profiles = getActiveConnections();
      if (profiles.length === 0) {
        return reject(new Error('No extension connected. Install Aether and refresh.'));
      }
      return reject(new Error(`Profile "${activeProfileId}" not connected. Active: ${profiles.map(p => p.label).join(', ')}`));
    }

    const id = ++messageId;
    const timer = setTimeout(() => {
      pendingCommands.delete(id);
      reject(new Error(`'${command}' timed out (${timeout}ms)`));
    }, timeout);

    pendingCommands.set(id, { resolve, reject, timer });
    extensionWs.send(JSON.stringify({ id, command, params }));

    // Audit
    auditLog.push({ id, command, params: sanitize(params), ts: new Date().toISOString() });
    if (auditLog.length > 500) auditLog.shift();
  });
}

function sanitize(p) {
  const s = { ...p };
  if (s.password) s.password = '***';
  if (s.code) s.code = s.code.slice(0, 80) + '…';
  return s;
}

// ─── Guarded execution (Safe Mode wrapper) ──────────────────────────────────

async function guardedExecute(command, params) {
  const sensitivity = classifySensitivity(command, params);

  if (sensitivity?.blocked) {
    return {
      content: [{
        type: 'text',
        text: `⛔ BLOCKED by Safe Mode policy: "${sensitivity.category}" actions are set to "never allow".\n`
           + `Change policy with safe_mode_policy tool.`
      }]
    };
  }

  if (sensitivity) {
    // Return a pending approval to the AI client
    const id = ++approvalId;
    const approval = new Promise((resolve) => {
      pendingApprovals.set(id, { resolve, category: sensitivity.category, command, params });
      setTimeout(() => {
        if (pendingApprovals.has(id)) {
          pendingApprovals.delete(id);
          resolve({ approved: false, reason: 'timeout' });
        }
      }, 300_000);
    });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          _aether_approval_required: true,
          approval_id: id,
          category: sensitivity.category,
          command,
          description: describeAction(command, params),
          options: [
            'approve       — execute this action',
            'approve_all   — always allow this category',
            'approve_once  — allow for this session only',
            'reject        — cancel this action',
            'reject_always — never allow this category',
          ]
        }, null, 2)
      }]
    };
  }

  // Safe action — execute directly
  const result = await sendToExtension(command, params);

  // Auto-record if a recording session is active
  if (isRecording()) {
    recordStep(command, params, lastHintMap);
  }

  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

function describeAction(command, params) {
  const parts = [`Action: ${command}`];
  if (params.text) parts.push(`Target: "${params.text}"`);
  if (params.hint_id) parts.push(`Element: ${params.hint_id}`);
  if (params.url) parts.push(`URL: ${params.url}`);
  if (params.selector) parts.push(`Selector: ${params.selector}`);
  return parts.join(' | ');
}

// ─── MCP Server ─────────────────────────────────────────────────────────────

const server = new McpServer({ name: 'aether', version: VERSION });

// Core tools

server.tool(
  'navigate',
  'Open a URL in the user\'s real browser. All existing login sessions are preserved.',
  {
    url: z.string().describe('URL to navigate to'),
    newTab: z.boolean().optional().describe('Open in new tab'),
    timeout: z.number().optional().describe('Page load timeout in ms (default: 30000)')
  },
  async ({ url, newTab, timeout }) => {
    // Smart profile suggestion
    const suggested = suggestProfile(url);
    const hint = (suggested && suggested.id !== activeProfileId)
      ? `\n⚡ Tip: domain matches profile "${suggested.label}". Use profile_switch to switch.`
      : '';

    const result = await sendToExtension('navigate', { url, newTab, timeout });
    const text = JSON.stringify(result, null, 2) + hint;
    return { content: [{ type: 'text', text }] };
  }
);

server.tool(
  'get_hint_map',
  'Get the Hint Map — structured page perception. Automatically dismisses cookie banners and popups before scanning. Returns interactable elements with IDs, content summary, page regions, and semantic data. Call this FIRST before interacting with any page.',
  {
    detail_level: z.enum(['minimal', 'standard', 'full']).optional()
      .describe('minimal: interactables only | standard: + content + regions | full: + complete text'),
    auto_dismiss: z.boolean().optional()
      .describe('Auto-dismiss cookie banners, popups, overlays before scanning (default: true)')
  },
  async (params) => {
    const result = await sendToExtension('get_hint_map', params);
    lastHintMap = result;  // track for cache fingerprinting
    if (isRecording()) recordStep('get_hint_map', params, result);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'auto_dismiss',
  'Dismiss cookie banners, consent popups, notification prompts, newsletter overlays, and other common roadblocks. Called automatically by get_hint_map, but can also be called manually.',
  {},
  async () => {
    const result = await sendToExtension('auto_dismiss');
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// ── Headless / Remote tools ──

server.tool(
  'detect_qr',
  'Detect QR codes on the current page (login QR, payment QR, etc). Essential for headless/remote servers where the user cannot see the screen. Returns QR image data for the user to scan on their phone.',
  {},
  async () => {
    const result = await sendToExtension('detect_qr');
    const response = [];

    if (result.found) {
      for (const qr of result.qrcodes) {
        if (qr.dataUrl) {
          const base64 = qr.dataUrl.replace(/^data:image\/\w+;base64,/, '');
          response.push({ type: 'image', data: base64, mimeType: 'image/png' });
        }
        if (qr.src) {
          response.push({ type: 'text', text: `QR image URL: ${qr.src}` });
        }
      }
      response.push({ type: 'text', text: JSON.stringify({
        count: result.count,
        details: result.qrcodes.map(q => ({ type: q.type, size: q.size, nearbyText: q.nearbyText }))
      }, null, 2) });
    } else {
      response.push({ type: 'text', text: 'No QR codes detected on this page.' });
    }

    return { content: response };
  }
);

server.tool(
  'page_to_pdf',
  'Export the current page as a PDF. Useful on headless servers where you cannot see the browser. Returns base64-encoded PDF data.',
  {
    landscape: z.boolean().optional().describe('Landscape orientation (default: false)')
  },
  async (params) => {
    const result = await sendToExtension('page_to_pdf', params);
    if (result.success && result.pdf) {
      return {
        content: [
          { type: 'resource', resource: { uri: `data:application/pdf;base64,${result.pdf}`, mimeType: 'application/pdf', text: result.pdf } },
          { type: 'text', text: `PDF exported: ${result.title} (${result.size})\nURL: ${result.url}` }
        ]
      };
    }
    return { content: [{ type: 'text', text: `PDF export failed: ${result.error}` }] };
  }
);

server.tool(
  'full_screenshot',
  'Take a full-page screenshot (not just the viewport). Essential for headless/remote use. Captures the entire scrollable page.',
  {
    format: z.enum(['png', 'jpeg']).optional().describe('Image format'),
    quality: z.number().optional().describe('JPEG quality 0-100')
  },
  async (params) => {
    const result = await sendToExtension('full_screenshot', params);
    if (result.dataUrl) {
      const base64 = result.dataUrl.replace(/^data:image\/\w+;base64,/, '');
      return {
        content: [
          { type: 'image', data: base64, mimeType: `image/${params.format || 'png'}` },
          { type: 'text', text: `Full page: ${result.title}\nURL: ${result.url}\nSize: ${result.dimensions?.w}x${result.dimensions?.h}px` }
        ]
      };
    }
    return { content: [{ type: 'text', text: `Screenshot failed: ${result.error || 'unknown'}` }] };
  }
);

server.tool(
  'click',
  'Click an element. Use hint_id from get_hint_map, or text to find by visible label. Sensitive clicks (payment, delete, send) require user approval via Safe Mode.',
  {
    hint_id: z.string().optional().describe('Hint ID from get_hint_map (e.g. "h5")'),
    text: z.string().optional().describe('Visible text to match'),
    selector: z.string().optional().describe('CSS selector (fallback)')
  },
  async (params) => guardedExecute('click', params)
);

server.tool(
  'type',
  'Type text into an input field. Clears existing content by default.',
  {
    hint_id: z.string().optional().describe('Hint ID of the input'),
    text: z.string().describe('Text to type'),
    selector: z.string().optional().describe('CSS selector (fallback)'),
    clear: z.boolean().optional().describe('Clear first (default: true)'),
    pressEnter: z.boolean().optional().describe('Press Enter after typing')
  },
  async (params) => guardedExecute('type', params)
);

server.tool(
  'screenshot',
  'Capture a screenshot of the current page.',
  {
    format: z.enum(['png', 'jpeg']).optional().describe('Image format'),
    quality: z.number().optional().describe('JPEG quality 0-100')
  },
  async (params) => {
    const result = await sendToExtension('screenshot', params);
    if (result.dataUrl) {
      const base64 = result.dataUrl.replace(/^data:image\/\w+;base64,/, '');
      return {
        content: [
          { type: 'image', data: base64, mimeType: `image/${params.format || 'png'}` },
          { type: 'text', text: `${result.title} — ${result.url}` }
        ]
      };
    }
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'extract',
  'Extract text content from the page or a specific element.',
  {
    hint_id: z.string().optional().describe('Element hint ID'),
    selector: z.string().optional().describe('CSS selector')
  },
  async (params) => {
    const result = await sendToExtension('extract', params);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'scroll',
  'Scroll the page.',
  {
    direction: z.enum(['up', 'down', 'left', 'right', 'top', 'bottom']).describe('Direction'),
    amount: z.number().optional().describe('Pixels (default: 500)')
  },
  async (params) => {
    const result = await sendToExtension('scroll', params);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'wait_for',
  'Wait until a condition is met on the page.',
  {
    selector: z.string().optional().describe('CSS selector to appear'),
    text: z.string().optional().describe('Text to appear'),
    url: z.string().optional().describe('URL substring to match'),
    condition: z.enum(['loaded']).optional().describe('Built-in condition'),
    timeout: z.number().optional().describe('Max wait ms (default: 10000)')
  },
  async (params) => {
    const result = await sendToExtension('wait_for', params);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'get_tabs',
  'List all open browser tabs.',
  {},
  async () => {
    const result = await sendToExtension('get_tabs');
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'execute_js',
  'Run JavaScript in page context. Always requires Safe Mode approval.',
  { code: z.string().describe('JavaScript code') },
  async (params) => guardedExecute('execute_js', params)
);

// ── Profile tools ──

server.tool(
  'profile_list',
  'List all browser profiles (online and offline). Each profile has independent cookies, logins, and browsing data.',
  {},
  async () => {
    const profiles = listAllProfiles();
    return { content: [{ type: 'text', text: JSON.stringify({
      active: activeProfileId,
      profiles
    }, null, 2) }] };
  }
);

server.tool(
  'profile_switch',
  'Switch to a different browser profile. Use the profile label or ID. Commands will be sent to this profile\'s browser.',
  {
    label: z.string().describe('Profile label (e.g. "work", "shopping") or ID')
  },
  async ({ label }) => {
    // Try by label first
    const active = getActiveConnections();
    const match = active.find(p =>
      p.label.toLowerCase() === label.toLowerCase() || p.id === label
    );

    if (match) {
      activeProfileId = match.id;
      return { content: [{ type: 'text', text: `Switched to profile "${match.label}" (${match.id})` }] };
    }

    return { content: [{ type: 'text', text: `Profile "${label}" not found or not online. Available: ${active.map(p => p.label).join(', ') || 'none'}` }] };
  }
);

server.tool(
  'profile_label',
  'Label a browser profile for easy reference. E.g. label the default profile as "work" or "shopping".',
  {
    profile_id: z.string().describe('Profile ID to label'),
    label: z.string().describe('New label (e.g. "work", "personal", "shopping")')
  },
  async ({ profile_id, label }) => {
    const result = labelProfile(profile_id, label);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'profile_domain',
  'Associate a domain with a profile. When navigating to this domain, Aether will suggest switching to the associated profile.',
  {
    action: z.enum(['add', 'remove']).describe('Add or remove domain association'),
    profile_id: z.string().describe('Profile ID'),
    domain: z.string().describe('Domain (e.g. "taobao.com", "gmail.com")')
  },
  async ({ action, profile_id, domain }) => {
    const result = action === 'add' ? addDomain(profile_id, domain) : removeDomain(profile_id, domain);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// ── Safe Mode tools ──

server.tool(
  'safe_mode_respond',
  'Respond to a Safe Mode approval request. When Aether returns _aether_approval_required, present it to the user and call this tool with their decision.',
  {
    approval_id: z.number().describe('The approval_id from the pending request'),
    decision: z.enum(['approve', 'approve_all', 'approve_once', 'reject', 'reject_always'])
      .describe('approve: execute once | approve_all: always allow this category | approve_once: allow this session | reject: cancel | reject_always: never allow')
  },
  async ({ approval_id, decision }) => {
    const pending = pendingApprovals.get(approval_id);
    if (!pending) {
      return { content: [{ type: 'text', text: 'No pending approval with that ID (expired or already handled).' }] };
    }
    pendingApprovals.delete(approval_id);

    // Apply policy
    if (decision === 'approve_all') {
      safeModePolicies.set(pending.category, 'always');
    } else if (decision === 'approve_once') {
      safeModePolicies.set(pending.category, 'session');
    } else if (decision === 'reject_always') {
      safeModePolicies.set(pending.category, 'never');
    }

    if (decision.startsWith('approve')) {
      // Execute the original action
      try {
        const result = await sendToExtension(pending.command, pending.params);
        pending.resolve({ approved: true });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        pending.resolve({ approved: true, error: e.message });
        return { content: [{ type: 'text', text: `Approved but execution failed: ${e.message}` }] };
      }
    } else {
      pending.resolve({ approved: false, reason: decision });
      return { content: [{ type: 'text', text: `Action rejected (${decision}). Category "${pending.category}" policy updated.` }] };
    }
  }
);

server.tool(
  'safe_mode_policy',
  'View or change Safe Mode policies. Controls which sensitive action categories need approval.',
  {
    action: z.enum(['status', 'set', 'reset', 'toggle']).describe(
      'status: show current policies | set: change a category policy | reset: clear all policies | toggle: enable/disable Safe Mode'
    ),
    category: z.string().optional().describe('Category name (payment, delete, send, account, download, code_execution)'),
    policy: z.enum(['always', 'session', 'never']).optional().describe('New policy for the category')
  },
  async ({ action, category, policy }) => {
    switch (action) {
      case 'toggle':
        safeModeEnabled = !safeModeEnabled;
        return { content: [{ type: 'text', text: `Safe Mode: ${safeModeEnabled ? 'ON' : 'OFF'}` }] };
      case 'reset':
        safeModePolicies.clear();
        return { content: [{ type: 'text', text: 'All policies reset. All sensitive actions require approval.' }] };
      case 'set':
        if (!category || !policy) return { content: [{ type: 'text', text: 'Provide category and policy.' }] };
        safeModePolicies.set(category, policy);
        return { content: [{ type: 'text', text: `"${category}" → ${policy}` }] };
      case 'status':
      default:
        const policies = Object.fromEntries(safeModePolicies);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              enabled: safeModeEnabled,
              categories: Object.keys(SENSITIVE_PATTERNS),
              policies: Object.keys(policies).length ? policies : '(all categories require approval)',
              pending_approvals: pendingApprovals.size
            }, null, 2)
          }]
        };
    }
  }
);

// ── Path Cache tools ──

server.tool(
  'cache_start',
  'Start recording a reusable action path. Call this before executing a multi-step task. Next time the same task is needed on the same site, cache_replay can execute it instantly without AI inference.',
  {
    label: z.string().describe('Short task label, e.g. "search products", "export report"')
  },
  async ({ label }) => {
    if (!lastHintMap) {
      return { content: [{ type: 'text', text: 'Call get_hint_map first so the cache knows what page you are on.' }] };
    }
    const result = startRecording(label, lastHintMap);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'cache_stop',
  'Stop recording and save the current action path. The path can be replayed later with cache_replay.',
  {},
  async () => {
    const result = stopRecording();
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'cache_replay',
  'Replay a previously recorded action path. Executes each step in sequence, verifying page state between steps. If the page has changed too much, stops and returns remaining steps for the AI to handle manually.',
  {
    label: z.string().describe('Task label to search for'),
  },
  async ({ label }) => {
    if (!lastHintMap) {
      return { content: [{ type: 'text', text: 'Call get_hint_map first.' }] };
    }
    const match = findPath(label, lastHintMap);
    if (!match.found) {
      return { content: [{ type: 'text', text: JSON.stringify({ cached: false, message: 'No matching path found. Execute manually and use cache_start/cache_stop to record it.' }, null, 2) }] };
    }

    // Replay steps one by one
    const results = [];
    let failedAt = -1;

    for (let i = 0; i < match.path.steps.length; i++) {
      const step = match.path.steps[i];
      try {
        // Skip get_hint_map steps during replay (we verify differently)
        if (step.command === 'get_hint_map') {
          results.push({ step: i, command: step.command, skipped: true });
          continue;
        }
        const result = await sendToExtension(step.command, step.params);
        results.push({ step: i, command: step.command, success: true });
        // Brief pause between steps for page to settle
        await new Promise(r => setTimeout(r, 500));
      } catch (e) {
        failedAt = i;
        results.push({ step: i, command: step.command, error: e.message });
        break;
      }
    }

    if (failedAt === -1) {
      markReplayed(match.key);
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          cached: true,
          key: match.key,
          totalSteps: match.path.steps.length,
          executed: results,
          ...(failedAt >= 0 ? {
            failedAt,
            remaining: match.path.steps.slice(failedAt).map(s => ({
              command: s.command, params: s.params
            }))
          } : { complete: true })
        }, null, 2)
      }]
    };
  }
);

server.tool(
  'cache_list',
  'List all cached action paths, optionally filtered by domain.',
  {
    domain: z.string().optional().describe('Filter by domain (e.g. "taobao.com")')
  },
  async ({ domain }) => {
    return { content: [{ type: 'text', text: JSON.stringify(listPaths(domain), null, 2) }] };
  }
);

server.tool(
  'cache_delete',
  'Delete a cached action path.',
  {
    key: z.string().describe('Path key from cache_list')
  },
  async ({ key }) => {
    return { content: [{ type: 'text', text: JSON.stringify(deletePath(key), null, 2) }] };
  }
);

// ── Audit log ──

server.tool(
  'get_audit_log',
  'View the audit trail of all Aether actions.',
  { limit: z.number().optional().describe('Entries to return (default: 20)') },
  async ({ limit = 20 }) => {
    return { content: [{ type: 'text', text: JSON.stringify(auditLog.slice(-limit), null, 2) }] };
  }
);

// ─── Start ──────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[Aether] v${VERSION} started — Safe Mode ON`);
  console.error(`[Aether] WebSocket: ws://localhost:${WS_PORT}`);
}

main().catch((e) => { console.error('[Aether] Fatal:', e); process.exit(1); });
