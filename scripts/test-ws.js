/**
 * Quick test: simulates the Chrome Extension connecting to the MCP Server
 * Run this AFTER starting the server: node server/src/index.js
 *
 * Usage: node scripts/test-ws.js
 */

import WebSocket from 'ws';

const WS_URL = 'ws://localhost:3899';

console.log(`Connecting to ${WS_URL}...`);
const ws = new WebSocket(WS_URL);

ws.on('open', () => {
  console.log('Connected!');

  // Register as extension
  ws.send(JSON.stringify({
    type: 'register',
    client: 'test-extension',
    version: '0.1.0-test'
  }));
  console.log('Sent register message');

  // Listen for commands from MCP server
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    console.log('Received command:', JSON.stringify(msg, null, 2));

    // Auto-respond to any command with a mock result
    if (msg.id && msg.command) {
      const mockResult = {
        'get_hint_map': {
          url: 'https://example.com',
          title: 'Test Page',
          interactables: [
            { id: 'h0', type: 'input', text: '', placeholder: 'Search...' },
            { id: 'h1', type: 'button', text: 'Submit' },
            { id: 'h2', type: 'link', text: 'About', href: '/about' }
          ],
          content: { headings: [{ level: 1, text: 'Welcome' }] },
          state: { hasPopup: false, isLoading: false, hasLogin: false, hasCaptcha: false }
        },
        'navigate': { tabId: 1, url: 'https://example.com', title: 'Example', status: 'complete' },
        'screenshot': { dataUrl: 'data:image/png;base64,iVBORw0KGgo=', tabId: 1, url: 'https://example.com', title: 'Example' },
        'get_tabs': [{ id: 1, url: 'https://example.com', title: 'Example', active: true, status: 'complete' }],
        'click': { success: true, clicked: { tag: 'button', text: 'Submit' } },
        'type': { success: true, typed: { tag: 'input', name: 'search', value: 'hello' } },
        'extract': { success: true, text: 'Hello World', title: 'Example', url: 'https://example.com' }
      };

      const response = {
        id: msg.id,
        type: 'response',
        success: true,
        result: mockResult[msg.command] || { echo: msg.command, params: msg.params }
      };

      ws.send(JSON.stringify(response));
      console.log(`Responded to '${msg.command}' with mock data`);
    }
  });

  console.log('\nTest extension ready! Now use an MCP client to send commands to the server.');
  console.log('Press Ctrl+C to exit.\n');
});

ws.on('error', (err) => {
  console.error('Connection failed:', err.message);
  console.error('Make sure the server is running: cd server && npm start');
  process.exit(1);
});

ws.on('close', () => {
  console.log('Disconnected');
  process.exit(0);
});
