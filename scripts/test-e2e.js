/**
 * Aether E2E Test (Playwright mode)
 *
 * Starts the MCP server, sends JSON-RPC commands via stdin,
 * verifies Playwright browser control works end-to-end.
 *
 * Usage: node scripts/test-e2e.js
 */

import { spawn } from 'child_process';

const PASS = '\x1b[32m PASS \x1b[0m';
const FAIL = '\x1b[31m FAIL \x1b[0m';
let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    console.log(`${PASS} ${name}`);
    passed++;
  } else {
    console.log(`${FAIL} ${name}`);
    failed++;
  }
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function sendRpc(server, id, method, params = {}) {
  const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });
  server.stdin.write(msg + '\n');
}

async function waitForOutput(server, timeoutMs = 15000) {
  return new Promise((resolve) => {
    let data = '';
    const timer = setTimeout(() => {
      server.stdout.removeListener('data', onData);
      resolve(data);
    }, timeoutMs);

    function onData(chunk) {
      data += chunk.toString();
      // Try to detect a complete JSON-RPC response
      try {
        // Look for a complete JSON object
        const lines = data.split('\n').filter(Boolean);
        for (const line of lines) {
          JSON.parse(line); // if this doesn't throw, we have a complete response
        }
        clearTimeout(timer);
        server.stdout.removeListener('data', onData);
        resolve(data);
      } catch {
        // Incomplete, keep waiting
      }
    }
    server.stdout.on('data', onData);
  });
}

async function main() {
  console.log('\n  Aether E2E Test (Playwright)\n  ============================\n');

  // 1. Start MCP Server
  console.log('Starting MCP Server...');
  const server = spawn('node', ['src/index.js', '--headless'], {
    cwd: new URL('../server', import.meta.url).pathname,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let serverStderr = '';
  server.stderr.on('data', (d) => {
    serverStderr += d.toString();
  });

  // Wait for server + browser to launch
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    if (serverStderr.includes('started')) break;
  }
  console.log('Server stderr:', serverStderr.trim());
  assert(serverStderr.includes('started'), 'Server starts successfully');
  assert(serverStderr.includes('Playwright'), 'Running in Playwright mode');
  assert(serverStderr.includes('Safe Mode ON'), 'Safe Mode enabled');

  // 2. Initialize MCP
  console.log('\nTesting MCP protocol...');
  sendRpc(server, 1, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '1.0.0' }
  });
  let output = await waitForOutput(server);
  assert(output.includes('"name":"aether"'), 'MCP initialize returns server info');

  // Send initialized notification
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  await sleep(500);

  // 3. List tools
  sendRpc(server, 2, 'tools/list');
  output = await waitForOutput(server);
  assert(output.includes('navigate'), 'Tools list includes navigate');
  assert(output.includes('get_hint_map'), 'Tools list includes get_hint_map');
  assert(output.includes('click'), 'Tools list includes click');
  assert(output.includes('screenshot'), 'Tools list includes screenshot');
  assert(output.includes('save_session'), 'Tools list includes save_session');
  assert(!output.includes('profile_switch'), 'No extension-only profile tools');

  // 4. Navigate to a page
  console.log('\nTesting browser control...');
  sendRpc(server, 3, 'tools/call', {
    name: 'navigate',
    arguments: { url: 'https://example.com' }
  });
  output = await waitForOutput(server);
  assert(output.includes('example.com'), 'Navigate to example.com');

  // 5. Get Hint Map
  sendRpc(server, 4, 'tools/call', {
    name: 'get_hint_map',
    arguments: {}
  });
  output = await waitForOutput(server);
  assert(output.includes('interactables'), 'Hint Map returns interactables');
  assert(output.includes('summary'), 'Hint Map returns summary');
  assert(output.includes('Example Domain') || output.includes('example'), 'Hint Map sees page content');

  // 6. Screenshot
  sendRpc(server, 5, 'tools/call', {
    name: 'screenshot',
    arguments: {}
  });
  output = await waitForOutput(server);
  assert(output.includes('image') || output.includes('data:image') || output.includes('base64'), 'Screenshot returns image data');

  // 7. Extract
  sendRpc(server, 6, 'tools/call', {
    name: 'extract',
    arguments: {}
  });
  output = await waitForOutput(server);
  assert(output.includes('Example Domain') || output.includes('example'), 'Extract returns page text');

  // 8. Safe Mode — sensitive click should trigger approval
  console.log('\nTesting Safe Mode...');
  sendRpc(server, 7, 'tools/call', {
    name: 'click',
    arguments: { text: 'Delete Account' }
  });
  output = await waitForOutput(server);
  assert(output.includes('_aether_approval_required'), 'Safe Mode intercepts sensitive click');
  assert(output.includes('delete'), 'Safe Mode identifies "delete" category');

  // 9. Safe navigate (should NOT trigger safe mode)
  sendRpc(server, 8, 'tools/call', {
    name: 'navigate',
    arguments: { url: 'https://example.com' }
  });
  output = await waitForOutput(server);
  assert(!output.includes('_aether_approval_required'), 'Safe actions bypass Safe Mode');

  // 10. Scroll
  sendRpc(server, 9, 'tools/call', {
    name: 'scroll',
    arguments: { direction: 'down' }
  });
  output = await waitForOutput(server);
  assert(output.includes('success'), 'Scroll works');

  // 11. Get tabs
  sendRpc(server, 10, 'tools/call', {
    name: 'get_tabs',
    arguments: {}
  });
  output = await waitForOutput(server);
  assert(output.includes('example.com'), 'Get tabs lists the open page');

  // Cleanup
  server.kill();
  await sleep(500);

  // Summary
  console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Test error:', e);
  process.exit(1);
});
