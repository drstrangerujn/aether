#!/usr/bin/env node

/**
 * Aether MCP Server v0.2.0
 *
 *   AI App <──MCP/stdio──> Aether Server <──WebSocket──> Chrome Extension
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebSocketServer } from 'ws';
import { z } from 'zod';

const WS_PORT = 3899;
const VERSION = '0.2.0';

// ─── State ──────────────────────────────────────────────────────────────────

let extensionWs = null;
let messageId = 0;
const pendingCommands = new Map();
const auditLog = [];

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
  console.error('[Aether] Extension connected');
  extensionWs = ws;

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'register') {
        console.error(`[Aether] Extension v${msg.version}`);
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
    console.error('[Aether] Extension disconnected');
    extensionWs = null;
    for (const [, p] of pendingCommands) {
      clearTimeout(p.timer);
      p.reject(new Error('Extension disconnected'));
    }
    pendingCommands.clear();
  });
});

// ─── Extension bridge ───────────────────────────────────────────────────────

function sendToExtension(command, params = {}, timeout = 30000) {
  return new Promise((resolve, reject) => {
    if (!extensionWs || extensionWs.readyState !== 1) {
      return reject(new Error('Extension not connected. Install the Aether Chrome extension and refresh.'));
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
    const result = await sendToExtension('navigate', { url, newTab, timeout });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'get_hint_map',
  'Get the Hint Map — structured page perception. Returns interactable elements with IDs, content summary, page regions, and semantic data. Call this FIRST before interacting with any page.',
  {
    detail_level: z.enum(['minimal', 'standard', 'full']).optional()
      .describe('minimal: interactables only | standard: + content + regions | full: + complete text')
  },
  async (params) => {
    const result = await sendToExtension('get_hint_map', params);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
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
