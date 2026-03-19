/**
 * Aether - Background Service Worker
 *
 * Bridges the MCP Server (via WebSocket) with the browser's content scripts.
 * This is the core relay: receives commands from the server, dispatches them
 * to the right tab, and returns results.
 */

const WS_URL = 'ws://localhost:3899';
let ws = null;
let reconnectTimer = null;
let pendingResponses = new Map(); // messageId -> resolve function

// ─── WebSocket Connection ───────────────────────────────────────────────────

function connect() {
  if (ws && ws.readyState === WebSocket.OPEN) return;

  try {
    ws = new WebSocket(WS_URL);
  } catch (e) {
    console.log('[Aether] WebSocket connection failed, retrying in 3s...');
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    console.log('[Aether] Connected to MCP Server');
    clearReconnectTimer();
    // Register with server
    send({ type: 'register', client: 'extension', version: '0.1.0' });
    updateBadge('ON', '#2E75B6');
  };

  ws.onmessage = async (event) => {
    try {
      const msg = JSON.parse(event.data);
      await handleServerMessage(msg);
    } catch (e) {
      console.error('[Aether] Failed to handle message:', e);
    }
  };

  ws.onclose = () => {
    console.log('[Aether] Disconnected from MCP Server');
    updateBadge('OFF', '#999');
    scheduleReconnect();
  };

  ws.onerror = (err) => {
    console.error('[Aether] WebSocket error:', err);
    ws.close();
  };
}

function send(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function scheduleReconnect() {
  clearReconnectTimer();
  reconnectTimer = setTimeout(connect, 3000);
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function updateBadge(text, color) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

// ─── Command Handlers ───────────────────────────────────────────────────────

async function handleServerMessage(msg) {
  const { id, command, params } = msg;

  try {
    let result;
    switch (command) {
      case 'navigate':
        result = await cmdNavigate(params);
        break;
      case 'click':
        result = await cmdClick(params);
        break;
      case 'type':
        result = await cmdType(params);
        break;
      case 'screenshot':
        result = await cmdScreenshot(params);
        break;
      case 'get_hint_map':
        result = await cmdGetHintMap(params);
        break;
      case 'extract':
        result = await cmdExtract(params);
        break;
      case 'scroll':
        result = await cmdScroll(params);
        break;
      case 'wait_for':
        result = await cmdWaitFor(params);
        break;
      case 'get_tabs':
        result = await cmdGetTabs();
        break;
      case 'execute_js':
        result = await cmdExecuteJs(params);
        break;
      default:
        result = { error: `Unknown command: ${command}` };
    }
    send({ id, type: 'response', success: true, result });
  } catch (e) {
    send({ id, type: 'response', success: false, error: e.message });
  }
}

// ─── Get active tab or specified tab ────────────────────────────────────────

async function getTargetTab(params = {}) {
  if (params.tabId) {
    return await chrome.tabs.get(params.tabId);
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('No active tab found');
  return tab;
}

// ─── navigate: Open a URL ───────────────────────────────────────────────────

async function cmdNavigate(params) {
  const { url, tabId, newTab } = params;
  if (!url) throw new Error('Missing required param: url');

  let tab;
  if (newTab) {
    tab = await chrome.tabs.create({ url });
  } else if (tabId) {
    tab = await chrome.tabs.update(tabId, { url });
  } else {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = await chrome.tabs.update(activeTab.id, { url });
  }

  // Wait for page load
  await waitForTabLoad(tab.id, params.timeout || 30000);

  const updatedTab = await chrome.tabs.get(tab.id);
  return {
    tabId: updatedTab.id,
    url: updatedTab.url,
    title: updatedTab.title,
    status: updatedTab.status
  };
}

function waitForTabLoad(tabId, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error(`Page load timeout after ${timeout}ms`));
    }, timeout);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        // Extra delay for dynamic content
        setTimeout(resolve, 500);
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// ─── click: Click an element ────────────────────────────────────────────────

async function cmdClick(params) {
  const tab = await getTargetTab(params);
  const result = await chrome.tabs.sendMessage(tab.id, {
    action: 'click',
    params
  });
  return result;
}

// ─── type: Type text into an element ────────────────────────────────────────

async function cmdType(params) {
  const tab = await getTargetTab(params);
  const result = await chrome.tabs.sendMessage(tab.id, {
    action: 'type',
    params
  });
  return result;
}

// ─── screenshot: Capture visible tab ────────────────────────────────────────

async function cmdScreenshot(params = {}) {
  const tab = await getTargetTab(params);
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
    format: params.format || 'png',
    quality: params.quality || 80
  });
  return {
    dataUrl,
    tabId: tab.id,
    url: tab.url,
    title: tab.title
  };
}

// ─── get_hint_map: Get page perception map ──────────────────────────────────

async function cmdGetHintMap(params = {}) {
  const tab = await getTargetTab(params);
  const result = await chrome.tabs.sendMessage(tab.id, {
    action: 'get_hint_map',
    params
  });
  return result;
}

// ─── extract: Extract content from page ─────────────────────────────────────

async function cmdExtract(params = {}) {
  const tab = await getTargetTab(params);
  const result = await chrome.tabs.sendMessage(tab.id, {
    action: 'extract',
    params
  });
  return result;
}

// ─── scroll: Scroll the page ────────────────────────────────────────────────

async function cmdScroll(params = {}) {
  const tab = await getTargetTab(params);
  const result = await chrome.tabs.sendMessage(tab.id, {
    action: 'scroll',
    params
  });
  return result;
}

// ─── wait_for: Wait for a condition ─────────────────────────────────────────

async function cmdWaitFor(params = {}) {
  const tab = await getTargetTab(params);
  const result = await chrome.tabs.sendMessage(tab.id, {
    action: 'wait_for',
    params
  });
  return result;
}

// ─── get_tabs: List open tabs ───────────────────────────────────────────────

async function cmdGetTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  return tabs.map(t => ({
    id: t.id,
    url: t.url,
    title: t.title,
    active: t.active,
    status: t.status
  }));
}

// ─── execute_js: Run arbitrary JS in page context ───────────────────────────

async function cmdExecuteJs(params) {
  const tab = await getTargetTab(params);
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (code) => {
      try {
        return { success: true, result: eval(code) };
      } catch (e) {
        return { success: false, error: e.message };
      }
    },
    args: [params.code],
    world: 'MAIN'
  });
  return result.result;
}

// ─── Initialize ─────────────────────────────────────────────────────────────

connect();

// Reconnect when extension wakes up
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);

// Handle messages from popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'get_status') {
    sendResponse({
      connected: ws && ws.readyState === WebSocket.OPEN,
      wsUrl: WS_URL
    });
  }
  return true;
});
