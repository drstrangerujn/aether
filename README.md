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
| `get_hint_map` | Get structured page perception (v2) |
| `extract` | Extract text content |
| `scroll` | Scroll the page |
| `wait_for` | Wait for elements/text/URL changes |
| `get_tabs` | List open browser tabs |
| `execute_js` | Run JavaScript in page context |
| `safe_mode_respond` | Respond to sensitive action approvals |
| `safe_mode_policy` | View/change Safe Mode policies |
| `get_audit_log` | View action history |

## Hint Map

The Hint Map is Aether's core innovation. Instead of sending raw HTML or screenshots to the AI, Aether generates a structured "page capability map":

```json
{
  "url": "https://example.com/products",
  "title": "Product Search",
  "summary": "47 elements across [nav, main, sidebar] 🍪 cookie banner",
  "interactables": [
    { "id": "h0", "type": "input", "region": "main", "priority": 90, "placeholder": "Search..." },
    { "id": "h1", "type": "button", "region": "main", "priority": 85, "text": "Search" },
    { "id": "h2", "type": "link", "region": "nav", "priority": 60, "text": "Electronics" }
  ],
  "content": {
    "headings": [{ "level": 1, "text": "Find Your Perfect Product" }],
    "semantics": { "price": ["$29.99", "$49.99"], "count": ["128 results"] },
    "tables": [{ "headers": ["Name", "Price", "Rating"], "rowCount": 25 }]
  },
  "state": {
    "popup": false, "login": false, "captcha": false, "cookieBanner": true
  }
}
```

This drastically reduces token usage and improves action accuracy.

## Safe Mode

Sensitive actions (payment, delete, send, account changes) are **automatically intercepted** and sent back to the AI client for user approval. Users can set policies per category:

| Decision | Effect |
|----------|--------|
| `approve` | Execute this one action |
| `approve_all` | Always allow this category |
| `approve_once` | Allow for this session |
| `reject` | Cancel the action |
| `reject_always` | Never allow this category |

## As a Skill

Aether ships as a Skill (`skill/SKILL.md`) — a set of instructions that teaches AI agents how to effectively use the browser tools. Drop it into your agent's skills directory:

```bash
cp -r aether/skill ~/.openclaw/skills/aether
# or for Claude Code:
cp -r aether/skill ~/.claude/skills/aether
```

The skill teaches the agent: Hint Map workflow, Safe Mode approval handling, multi-step patterns (search→filter→extract), popup dismissal, and security rules.

## Roadmap

- [x] **Phase 1 (MVP)**: Navigation, click, type, screenshot, Hint Map v1
- [x] **Phase 2**: Safe Mode, Hint Map v2 (regions, semantics, priority), Audit Log
- [ ] **Phase 3**: Self-Healing, Smart Wait improvements, Multi-Profile
- [ ] **Phase 4**: Visual Config UI, WebMCP compatibility, Plugin marketplace

## Philosophy

> Don't build a new browser. Let AI **inhabit** the user's existing one.

Aether takes the approach pioneered by Manus Browser Operator and makes it:
- **Open source** — no vendor lock-in
- **MCP-native** — works with any AI application
- **Smarter** — Hint Map gives AI structured perception, not raw DOM

## License

MIT
