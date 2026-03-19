# Aether

**The invisible element that connects AI to your browser.**

Aether lets any AI application (Claude, OpenClaw, GPT, etc.) safely control your **real browser** — with all your existing login sessions, cookies, and browsing context intact. No more bot detection. No more re-logging in. No more fake browser fingerprints.

## How It Works

```
┌─────────────────────────────────────┐
│  Your Real Browser (Chrome/Edge)     │
│  ├── Your login sessions & cookies   │
│  └── Aether Extension (lightweight)  │
│       ├── Page Perception (Hint Map) │
│       └── Safe Action Control        │
└──────────┬──────────────────────────┘
           │ WebSocket
┌──────────▼──────────────────────────┐
│  Aether MCP Server (local)           │
│  ├── MCP Tool Registry               │
│  ├── Smart Wait & Error Recovery     │
│  └── Audit Log                       │
└──────────┬──────────────────────────┘
           │ MCP Protocol
┌──────────▼──────────────────────────┐
│  Any AI Application                  │
│  Claude / OpenClaw / GPT / Custom    │
└─────────────────────────────────────┘
```

## Why Aether?

| Problem | How Others Solve It | How Aether Solves It |
|---------|-------------------|---------------------|
| Login sessions lost | Re-login every time or manage cookies | Uses your real browser — sessions are already there |
| Bot detection | Stealth plugins, fingerprint spoofing | Your real browser = real fingerprint. Nothing to detect |
| Heavy setup | Docker, cloud browsers, complex configs | One Chrome extension + one npm package |
| Platform lock-in | Tied to specific AI platform | MCP-native — works with any AI app |
| Page understanding | Raw DOM or expensive screenshots | Hint Map — structured page perception |

## Quick Start

### 1. Install the Chrome Extension

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/aether.git

# Load extension in Chrome:
# 1. Go to chrome://extensions
# 2. Enable "Developer mode"
# 3. Click "Load unpacked"
# 4. Select the `aether/extension` folder
```

### 2. Start the MCP Server

```bash
cd aether/server
npm install
npm start
```

### 3. Connect Your AI App

Add Aether to your Claude Desktop config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "aether": {
      "command": "node",
      "args": ["/path/to/aether/server/src/index.js"]
    }
  }
}
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `navigate` | Open a URL in the browser |
| `click` | Click an element by hint ID or text |
| `type` | Type text into input fields |
| `screenshot` | Capture the current page |
| `get_hint_map` | Get structured page perception |
| `extract` | Extract text content |
| `scroll` | Scroll the page |
| `wait_for` | Wait for elements/text/URL changes |
| `get_tabs` | List open browser tabs |
| `execute_js` | Run JavaScript in page context |
| `get_audit_log` | View action history |

## Hint Map

The Hint Map is Aether's core innovation. Instead of sending raw HTML or screenshots to the AI, Aether generates a structured "page capability map":

```json
{
  "url": "https://example.com/products",
  "title": "Product Search",
  "interactables": [
    { "id": "h0", "type": "input", "text": "", "placeholder": "Search products..." },
    { "id": "h1", "type": "button", "text": "Search" },
    { "id": "h2", "type": "link", "text": "Electronics", "href": "/category/electronics" }
  ],
  "content": {
    "headings": [{ "level": 1, "text": "Find Your Perfect Product" }],
    "mainText": "Browse thousands of products..."
  },
  "state": {
    "hasPopup": false,
    "isLoading": false,
    "hasLogin": false,
    "hasCaptcha": false
  }
}
```

This drastically reduces token usage and improves action accuracy.

## Roadmap

- [x] **Phase 1 (MVP)**: Basic navigation, click, type, screenshot, Hint Map v1
- [ ] **Phase 2**: Smart Wait, Self-Healing, Safe Mode, Audit Log
- [ ] **Phase 3**: Multi-Profile, Visual Config UI, WebMCP compatibility, Plugin marketplace

## Philosophy

> Don't build a new browser. Let AI **inhabit** the user's existing one.

Aether takes the approach pioneered by Manus Browser Operator and makes it:
- **Open source** — no vendor lock-in
- **MCP-native** — works with any AI application
- **Smarter** — Hint Map gives AI structured perception, not raw DOM

## License

MIT
