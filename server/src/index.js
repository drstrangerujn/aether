#!/usr/bin/env node

/**
 * Aether MCP Server
 *
 * Two-faced server:
 * 1. MCP interface (stdio) — talks to AI applications (Claude, OpenClaw, etc.)
 * 2. WebSocket server — talks to the Chrome Extension
 *
 * Architecture:
 *   AI App <--MCP/stdio--> Aether Server <--WebSocket--> Chrome Extension
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebSocketServer } from 'ws';
import { z } from 'zod';

const WS_PORT = 3899;
const VERSION = '0.1.0';

// ─── State ──────────────────────────────────────────────────────────────────

let extensionWs = null;
let messageId = 0;
const pendingCommands = new Map(); // id -> { resolve, reject, timer }
const auditLog = [];

// ─── WebSocket Server (for Chrome Extension) ───────────────────────────────

const wss = new WebSocketServer({ port: WS_PORT });

wss.on('listening', () => {
  console.error(`[Aether] WebSocket server listening on ws://localhost:${WS_PORT}`);
});

wss.on('connection', (ws) => {
  console.error('[Aether] Chrome Extension connected');
  extensionWs = ws;

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'register') {
        console.error(`[Aether] Extension registered: v${msg.version}`);
        return;
      }

      if (msg.type === 'response' && msg.id) {
        const pending = pendingCommands.get(msg.id);
        if (pending) {
          clearTimeout(pending.timer);
          pendingCommands.delete(msg.id);
          if (msg.success) {
            pending.resolve(msg.result);
          } else {
            pending.reject(new Error(msg.error || 'Unknown error'));
          }
        }
      }
    } catch (e) {
      console.error('[Aether] Failed to parse extension message:', e);
    }
  });

  ws.on('close', () => {
    console.error('[Aether] Chrome Extension disconnected');
    extensionWs = null;
    // Reject all pending commands
    for (const [id, pending] of pendingCommands) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Extension disconnected'));
    }
    pendingCommands.clear();
  });
});

// ─── Send command to extension ─────────────────────────────────────────────

function sendToExtension(command, params = {}, timeout = 30000) {
  return new Promise((resolve, reject) => {
    if (!extensionWs || extensionWs.readyState !== 1) {
      return reject(new Error('Chrome Extension not connected. Make sure the Aether extension is installed and active.'));
    }

    const id = ++messageId;
    const timer = setTimeout(() => {
      pendingCommands.delete(id);
      reject(new Error(`Command '${command}' timed out after ${timeout}ms`));
    }, timeout);

    pendingCommands.set(id, { resolve, reject, timer });

    extensionWs.send(JSON.stringify({ id, command, params }));

    // Audit log
    auditLog.push({
      id,
      command,
      params: sanitizeParams(params),
      timestamp: new Date().toISOString()
    });

    // Keep audit log manageable
    if (auditLog.length > 500) auditLog.shift();
  });
}

function sanitizeParams(params) {
  const safe = { ...params };
  // Don't log sensitive fields
  if (safe.password) safe.password = '***';
  if (safe.code) safe.code = safe.code.slice(0, 100) + '...';
  return safe;
}

// ─── MCP Server ─────────────────────────────────────────────────────────────

const server = new McpServer({
  name: 'aether',
  version: VERSION,
});

// ── Tool: navigate ──

server.tool(
  'navigate',
  'Navigate to a URL in the browser. Uses the user\'s real browser with all existing login sessions.',
  {
    url: z.string().describe('The URL to navigate to'),
    newTab: z.boolean().optional().describe('Open in a new tab instead of the current one'),
    timeout: z.number().optional().describe('Max wait time in ms for page load (default: 30000)')
  },
  async ({ url, newTab, timeout }) => {
    const result = await sendToExtension('navigate', { url, newTab, timeout });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// ── Tool: click ──

server.tool(
  'click',
  'Click an element on the page. Use hint_id from get_hint_map, or text to find by visible text.',
  {
    hint_id: z.string().optional().describe('The hint ID from get_hint_map (e.g., "h5")'),
    text: z.string().optional().describe('Visible text of the element to click'),
    selector: z.string().optional().describe('CSS selector (fallback)')
  },
  async (params) => {
    const result = await sendToExtension('click', params);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// ── Tool: type ──

server.tool(
  'type',
  'Type text into an input field. Automatically clears existing content first.',
  {
    hint_id: z.string().optional().describe('The hint ID of the input element'),
    text: z.string().describe('Text to type'),
    selector: z.string().optional().describe('CSS selector (fallback)'),
    clear: z.boolean().optional().describe('Clear existing content first (default: true)'),
    pressEnter: z.boolean().optional().describe('Press Enter after typing')
  },
  async (params) => {
    const result = await sendToExtension('type', params);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// ── Tool: screenshot ──

server.tool(
  'screenshot',
  'Take a screenshot of the current page. Returns a base64-encoded PNG image.',
  {
    format: z.enum(['png', 'jpeg']).optional().describe('Image format (default: png)'),
    quality: z.number().optional().describe('JPEG quality 0-100 (default: 80)')
  },
  async (params) => {
    const result = await sendToExtension('screenshot', params);
    if (result.dataUrl) {
      const base64 = result.dataUrl.replace(/^data:image\/\w+;base64,/, '');
      return {
        content: [
          { type: 'image', data: base64, mimeType: `image/${params.format || 'png'}` },
          { type: 'text', text: `Page: ${result.title}\nURL: ${result.url}` }
        ]
      };
    }
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// ── Tool: get_hint_map ──

server.tool(
  'get_hint_map',
  'Get the Hint Map - a structured perception of the current page. Returns interactable elements, content summary, and page state. Use this FIRST to understand what\'s on the page before taking action.',
  {
    detail_level: z.enum(['minimal', 'standard', 'full']).optional()
      .describe('Detail level: minimal (just interactables), standard (+ content summary), full (+ full text)')
  },
  async (params) => {
    const result = await sendToExtension('get_hint_map', params);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// ── Tool: extract ──

server.tool(
  'extract',
  'Extract text content from the page or a specific element.',
  {
    hint_id: z.string().optional().describe('Extract from a specific element by hint ID'),
    selector: z.string().optional().describe('Extract from a specific CSS selector')
  },
  async (params) => {
    const result = await sendToExtension('extract', params);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// ── Tool: scroll ──

server.tool(
  'scroll',
  'Scroll the page in a direction.',
  {
    direction: z.enum(['up', 'down', 'left', 'right', 'top', 'bottom'])
      .describe('Direction to scroll'),
    amount: z.number().optional().describe('Pixels to scroll (default: 500)')
  },
  async (params) => {
    const result = await sendToExtension('scroll', params);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// ── Tool: wait_for ──

server.tool(
  'wait_for',
  'Wait for a condition to be met on the page.',
  {
    selector: z.string().optional().describe('CSS selector to wait for'),
    text: z.string().optional().describe('Text content to wait for'),
    url: z.string().optional().describe('URL substring to wait for'),
    condition: z.enum(['loaded']).optional().describe('Built-in condition to wait for'),
    timeout: z.number().optional().describe('Max wait time in ms (default: 10000)')
  },
  async (params) => {
    const result = await sendToExtension('wait_for', params);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// ── Tool: get_tabs ──

server.tool(
  'get_tabs',
  'List all open browser tabs in the current window.',
  {},
  async () => {
    const result = await sendToExtension('get_tabs');
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// ── Tool: execute_js ──

server.tool(
  'execute_js',
  'Execute JavaScript code in the page context. Use with caution.',
  {
    code: z.string().describe('JavaScript code to execute')
  },
  async ({ code }) => {
    const result = await sendToExtension('execute_js', { code });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// ── Tool: get_audit_log ──

server.tool(
  'get_audit_log',
  'Get the audit log of all actions performed by Aether.',
  {
    limit: z.number().optional().describe('Number of recent entries to return (default: 20)')
  },
  async ({ limit = 20 }) => {
    const entries = auditLog.slice(-limit);
    return { content: [{ type: 'text', text: JSON.stringify(entries, null, 2) }] };
  }
);

// ─── Start ──────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[Aether] MCP Server v${VERSION} started`);
  console.error(`[Aether] Waiting for Chrome Extension connection on ws://localhost:${WS_PORT}...`);
}

main().catch((e) => {
  console.error('[Aether] Fatal error:', e);
  process.exit(1);
});
