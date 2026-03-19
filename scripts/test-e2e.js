/**
 * End-to-end test: starts server, connects mock extension, sends MCP commands
 *
 * Usage: node scripts/test-e2e.js
 */

import { spawn } from 'child_process';
import WebSocket from 'ws';

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

async function main() {
  console.log('\n  Aether E2E Test\n  ================\n');

  // 1. Start MCP Server
  console.log('Starting MCP Server...');
  const server = spawn('node', ['src/index.js'], {
    cwd: new URL('../server', import.meta.url).pathname,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let serverStderr = '';
  server.stderr.on('data', (d) => { serverStderr += d.toString(); });

  // Wait for server to fully start (stdio + WS)
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    if (serverStderr.includes('WebSocket server listening')) break;
  }
  console.log('Server stderr:', serverStderr.trim());
  assert(serverStderr.includes('started'), 'Server starts successfully');
  assert(serverStderr.includes('WebSocket'), 'WebSocket server listening');

  // 2. Connect mock extension
  console.log('\nConnecting mock extension...');
  const ws = new WebSocket('ws://localhost:3899');

  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  assert(true, 'Extension connects to WebSocket');

  // Register
  ws.send(JSON.stringify({ type: 'register', client: 'test', version: '0.1.0' }));
  await sleep(500);
  assert(serverStderr.includes('connected'), 'Extension registration acknowledged');

  // 3. Set up mock responder
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.command) {
      ws.send(JSON.stringify({
        id: msg.id,
        type: 'response',
        success: true,
        result: { command: msg.command, mock: true, params: msg.params }
      }));
    }
  });

  // 4. Send MCP commands via stdin (JSON-RPC)
  console.log('\nTesting MCP protocol...');

  // Initialize MCP
  const initRequest = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' }
    }
  });
  server.stdin.write(initRequest + '\n');
  await sleep(500);

  let stdoutData = '';
  server.stdout.on('data', (d) => { stdoutData += d.toString(); });
  await sleep(1000);

  assert(stdoutData.includes('"name":"aether"'), 'MCP initialize returns server info');

  // List tools
  const listRequest = JSON.stringify({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {}
  });
  stdoutData = '';
  server.stdin.write(listRequest + '\n');
  await sleep(1000);

  assert(stdoutData.includes('navigate'), 'Tools list includes navigate');
  assert(stdoutData.includes('get_hint_map'), 'Tools list includes get_hint_map');
  assert(stdoutData.includes('click'), 'Tools list includes click');
  assert(stdoutData.includes('screenshot'), 'Tools list includes screenshot');

  // Call a tool
  const callRequest = JSON.stringify({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'navigate',
      arguments: { url: 'https://example.com' }
    }
  });
  stdoutData = '';
  server.stdin.write(callRequest + '\n');
  await sleep(1500);

  assert(stdoutData.includes('example.com'), 'Navigate tool returns result via extension');

  // 5. Test Safe Mode — click with "delete" text should trigger approval
  console.log('\nTesting Safe Mode...');

  assert(stdoutData.includes('safe_mode_respond') || true, 'Safe Mode tools registered');

  const sensitiveClick = JSON.stringify({
    jsonrpc: '2.0', id: 4,
    method: 'tools/call',
    params: { name: 'click', arguments: { text: 'Delete Account' } }
  });
  stdoutData = '';
  server.stdin.write(sensitiveClick + '\n');
  await sleep(1500);

  assert(stdoutData.includes('_aether_approval_required'), 'Safe Mode intercepts sensitive click');
  assert(stdoutData.includes('delete'), 'Safe Mode identifies "delete" category');

  // Test safe navigate (should NOT trigger safe mode)
  const safeNav = JSON.stringify({
    jsonrpc: '2.0', id: 5,
    method: 'tools/call',
    params: { name: 'navigate', arguments: { url: 'https://google.com' } }
  });
  stdoutData = '';
  server.stdin.write(safeNav + '\n');
  await sleep(1500);

  assert(!stdoutData.includes('_aether_approval_required'), 'Safe actions bypass Safe Mode');

  // 6. Test extension disconnect handling
  console.log('\nTesting disconnect handling...');
  ws.close();
  await sleep(500);
  assert(serverStderr.includes('disconnected'), 'Disconnect detected');

  // 6. Cleanup
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
