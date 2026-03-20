<p align="center">
  <a href="README_CN.md">中文</a> · English
  <br><br>
  <strong>A · E · T · H · E · R</strong>
  <br>
  <em>The invisible element that connects AI to your browser.</em>
  <br><br>
  <a href="#quick-start">Quick Start</a> ·
  <a href="#hint-map">Hint Map</a> ·
  <a href="#safe-mode">Safe Mode</a> ·
  <a href="#as-a-skill">Skill</a> ·
  <a href="#roadmap">Roadmap</a>
</p>

---

Other browser agents fight websites. Aether doesn't.

Instead of faking fingerprints or managing headless browsers, Aether uses **Playwright** to drive a real Chromium instance with your saved sessions. One `npm install`, one command. No Chrome extension, no WebSocket relay, no manual setup. It runs headless on a VPS or headed on your desktop — same code, same MCP tools.

## Why

You've tried letting AI control a browser. You know what happens.

Headless Chrome opens. No cookies, no login, nothing. You're a stranger to every site. Cloudflare blocks you. So you bolt on stealth plugins, fake the User-Agent, randomize Canvas. It works Tuesday, breaks Thursday. The site updates, you update, nobody wins. And even when you get past the gate, the AI stares at 50,000 tokens of raw DOM and clicks the wrong thing.

Aether skips all of that. Playwright launches a real browser. Pass `--storage-state` to restore your sessions. The AI sees a **Hint Map** — a structured perception of the page in 200-800 tokens — not raw DOM.

## How

```
┌──────────────────────────────────────────┐
│  Chromium (Playwright)                    │
│                                          │
│  ✓ Real rendering   ✓ Saved sessions     │
│  ✓ Headless / VPS   ✓ Headed / desktop   │
│                                          │
│  ┌──────────────────────────────────┐    │
│  │ Injected Script (auto-loaded)   │    │
│  │  · Hint Map — page perception   │    │
│  │  · Self-Healing — auto-recover  │    │
│  │  · Auto Dismiss — kill popups   │    │
│  └────────────┬─────────────────────┘    │
└───────────────┼──────────────────────────┘
                │ Playwright (in-process)
┌───────────────┼──────────────────────────┐
│ Aether MCP Server                         │
│  · 20 tools · Safe Mode · Path Cache     │
└───────────────┼──────────────────────────┘
                │ MCP (stdio)
┌───────────────┼──────────────────────────┐
│ Any AI: Claude · GPT · Custom            │
└──────────────────────────────────────────┘
```

No Docker. No cloud. No API keys. One `npm install`.

## Quick Start

**1. Install**

```bash
git clone https://github.com/drstrangerujn/aether.git
cd aether/server && npm install
```

Playwright auto-installs Chromium on `npm install`.

**2. Start the server**

```bash
# Headless (VPS / CI)
npm start

# Headed (see the browser)
npm run start:headed

# Restore saved sessions
node src/index.js --storage-state ~/.aether/session.json
```

**3. Connect your AI**

Claude Desktop (`claude_desktop_config.json`):

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

That's it. No extension to load, no `chrome://extensions`, no Developer Mode.

**CLI flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--headless` | on | Run headless (no GUI) |
| `--headed` | off | Show the browser window |
| `--viewport 1920x1080` | 1280x800 | Browser viewport size |
| `--storage-state path` | — | Restore cookies/sessions from file |
| `--cdp ws://...` | — | Connect to an existing browser via CDP |
| `--locale zh-CN` | zh-CN | Browser locale |
| `--user-agent "..."` | — | Custom User-Agent |

## Hint Map

The core idea: don't show the AI raw HTML or screenshots. Show it a **structured perception** of the page.

```json
{
  "summary": "47 elements across [nav, main, sidebar] 🍪 cookie banner",
  "interactables": [
    { "id": "h0", "type": "input",  "region": "main", "priority": 90, "placeholder": "Search..." },
    { "id": "h1", "type": "button", "region": "main", "priority": 85, "text": "Search" },
    { "id": "h2", "type": "link",   "region": "nav",  "priority": 60, "text": "Electronics" }
  ],
  "content": {
    "semantics": { "price": ["¥299", "¥199"], "count": ["128 reviews"] },
    "tables": [{ "headers": ["Name", "Price", "Rating"], "rowCount": 25 }]
  },
  "state": { "popup": false, "login": false, "captcha": false, "cookieBanner": true }
}
```

What makes this different from accessibility snapshots or DOM dumps:

- **Regions** — every element knows if it's in the nav, main content, sidebar, or a modal. The AI can ignore the noise.
- **Priority scoring** — elements are ranked by viewport visibility, size, actionability. Modals sort first.
- **Semantic extraction** — prices, dates, emails, counts, percentages are pre-extracted. No regex needed by the AI.
- **Deduplication** — overlapping elements at the same pixel position are collapsed.
- **One-line summary** — the AI reads one sentence and knows where it is.

Token cost: ~200-800 tokens per page, vs 10,000-50,000 for raw DOM.

## Safe Mode

When the AI tries to click "Delete Account" or "Confirm Payment", Aether intercepts it:

```json
{
  "_aether_approval_required": true,
  "category": "delete",
  "description": "Action: click | Target: \"Delete Account\"",
  "options": [
    "approve       — execute this action",
    "approve_all   — always allow this category",
    "reject        — cancel this action",
    "reject_always — never allow this category"
  ]
}
```

The AI presents this to you. You decide. Categories: **payment**, **delete**, **send**, **account**, **download**, **code_execution**.

Set `approve_all` once for a category you trust, and it never asks again. Set `reject_always` for categories you want locked down permanently.

## Tools (20)

| | Tool | What it does |
|-|------|-------------|
| 👁 | `get_hint_map` | Structured page perception. **Always call first.** Auto-dismisses popups. |
| 👁 | `screenshot` | Viewport capture |
| 👁 | `full_screenshot` | Full page capture |
| 👁 | `extract` | Pull text from elements |
| 👁 | `detect_qr` | Find & extract QR codes (login, payment) |
| ✋ | `navigate` | Open URL |
| ✋ | `click` | Click by hint ID or text. Self-heals if element moved. |
| ✋ | `type` | Type into inputs. `pressEnter` to submit |
| ✋ | `scroll` | Scroll page |
| ✋ | `wait_for` | Wait for elements / text / URL changes |
| ✋ | `auto_dismiss` | Kill cookie banners, popups, overlays |
| ✋ | `execute_js` | Run JS in page. **Always requires approval** |
| 🔒 | `safe_mode_respond` | Handle approval requests |
| 🔒 | `safe_mode_policy` | View/change policies |
| 🧠 | `cache_start` | Start recording a replayable workflow |
| 🧠 | `cache_stop` | Save recorded workflow |
| 🧠 | `cache_replay` | Replay a saved workflow (skip AI inference) |
| 🧠 | `cache_list` | List saved workflows |
| 🧠 | `cache_delete` | Delete a saved workflow |
| 💾 | `save_session` | Save cookies/sessions for next time |
| 📄 | `page_to_pdf` | Export page as PDF |
| 📋 | `get_tabs` | List open tabs |
| 📋 | `get_audit_log` | Full action history |

## As a Skill

Aether ships with `skill/SKILL.md` — instructions that teach any AI agent how to use it. The skill covers: when to call `get_hint_map`, how to handle Safe Mode approvals, multi-step patterns (search → filter → extract), popup dismissal, and security rules.

```bash
# Claude Code
cp -r aether/skill ~/.claude/skills/aether
```

## Compared To

| | Aether | browser-use | Stagehand | Manus Operator |
|-|--------|-------------|-----------|----------------|
| No extension needed | ✅ Playwright | ⚠️ Python SDK | ⚠️ Own SDK | ❌ Manus only |
| VPS / headless | ✅ Out of the box | ⚠️ Config needed | ❌ Cloud only | ❌ |
| Session persistence | ✅ `--storage-state` | ⚠️ Manual | ❌ | ✅ |
| Works with any AI | ✅ MCP standard | ⚠️ Python SDK | ⚠️ Own SDK | ❌ Manus only |
| Open source | ✅ MIT | ✅ | ✅ | ❌ |
| Page perception | ✅ Hint Map | ❌ Raw DOM | ⚠️ Partial | ❓ Unknown |
| Safe Mode | ✅ Built-in | ❌ | ❌ | ❌ |
| Self-Healing | ✅ Auto-recover | ❌ | ✅ | ❌ |
| Path Cache | ✅ Record & replay | ❌ | ✅ Cache | ❌ |

## Project Structure

```
aether/
├── server/
│   └── src/
│       ├── index.js          MCP Server + Safe Mode + CLI
│       ├── browser.js         Playwright browser manager
│       ├── injected.js        Hint Map + Self-Healing + Auto Dismiss (injected into pages)
│       ├── cache.js           Path Cache engine
│       └── profiles.js        Profile manager
├── extension/                 (legacy) Chrome Extension — kept for reference
├── skill/
│   └── SKILL.md              AI agent instructions
└── scripts/
    └── test-e2e.js           E2E tests
```

## Roadmap

- [x] Navigation, click, type, screenshot, extract, scroll
- [x] Hint Map v2: regions, priority, semantics, dedup
- [x] Safe Mode: approval workflow, per-category policies
- [x] Auto Dismiss: cookie banners, popups, overlays
- [x] Path Cache: record & replay multi-step workflows
- [x] Self-Healing: auto-recover when elements move
- [x] Headless: QR detection, PDF export, full-page screenshot
- [x] Playwright mode: no extension, no WebSocket, VPS-ready
- [x] Session persistence: save & restore cookies
- [x] Skill format for Claude Code
- [ ] npm publish
- [ ] WebMCP compatibility layer
- [ ] Plugin marketplace for site-specific Hint Map optimizations

## License

MIT

---

<p align="center">
  <strong>Aether</strong> — αἰθήρ — the fifth element, invisible but everywhere.
</p>
