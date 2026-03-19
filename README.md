<p align="center">
  <br>
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

Instead of building another headless browser, faking fingerprints, or managing stolen cookies, Aether takes a fundamentally different approach — it **inhabits the browser you already use**. A lightweight Chrome extension bridges your real browser to any AI application via the MCP protocol. Your login sessions, cookies, IP, and fingerprint are all real. Websites see a human, because it *is* your browser.

## The Problem

Every AI browser agent today faces the same three walls:

**Wall 1: Identity.** You open a headless browser. Every website sees a fresh session — no cookies, no login, no history. You're a stranger. Cloudflare asks you to prove you're human. You fail.

**Wall 2: Detection.** You add stealth plugins, spoof User-Agents, randomize Canvas fingerprints. It works until it doesn't. The site updates its detection. You update your spoofing. An arms race with no winner.

**Wall 3: Perception.** You feed the AI a screenshot (expensive, slow) or raw DOM (50,000 tokens of noise). The AI clicks the wrong button, types in the wrong field, misses the popup.

Aether eliminates all three.

## How

```
┌──────────────────────────────────────────┐
│  Your Real Browser                        │
│                                          │
│  ✓ Your logins    ✓ Your cookies         │
│  ✓ Your IP        ✓ Your fingerprint     │
│                                          │
│  ┌──────────────────────────────────┐    │
│  │ Aether Extension (< 30KB)       │    │
│  │  · Hint Map — page perception   │    │
│  │  · Safe Mode — action gating    │    │
│  └────────────┬─────────────────────┘    │
└───────────────┼──────────────────────────┘
                │ WebSocket (local only)
┌───────────────┼──────────────────────────┐
│ Aether MCP Server                         │
│  · 13 tools · Audit log · Policy engine  │
└───────────────┼──────────────────────────┘
                │ MCP (stdio)
┌───────────────┼──────────────────────────┐
│ Any AI: Claude · OpenClaw · GPT · Custom │
└──────────────────────────────────────────┘
```

No Docker. No cloud. No API keys. One extension, one local server.

## Quick Start

**1. Clone & load the extension**

```bash
git clone https://github.com/liuxiyu1992/aether.git
```

Open `chrome://extensions` → enable Developer Mode → Load Unpacked → select `aether/extension`.

**2. Start the server**

```bash
cd aether/server && npm install && npm start
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

OpenClaw: copy `aether/skill/` to `~/.openclaw/skills/aether`.

The extension badge turns **ON** (blue) when connected. That's it.

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

Set `approve_all` once for a category you trust, and it never asks again. Set `reject_always` for categories you want locked down permanently. Your policies, your rules.

## Tools

| | Tool | What it does |
|-|------|-------------|
| 👁 | `get_hint_map` | Structured page perception. **Always call first.** |
| 👁 | `screenshot` | Visual capture |
| 👁 | `extract` | Pull text from elements |
| ✋ | `navigate` | Open URL (always safe) |
| ✋ | `click` | Click by hint ID or text. Sensitive targets → Safe Mode |
| ✋ | `type` | Type into inputs. `pressEnter` to submit |
| ✋ | `scroll` | Scroll page |
| ✋ | `wait_for` | Wait for elements / text / URL changes |
| ✋ | `execute_js` | Run JS in page. **Always requires approval** |
| 🔒 | `safe_mode_respond` | Handle approval requests |
| 🔒 | `safe_mode_policy` | View/change policies |
| 📋 | `get_tabs` | List open tabs |
| 📋 | `get_audit_log` | Full action history |

## As a Skill

Aether ships with `skill/SKILL.md` — a set of instructions that teaches any AI agent how to use it. The skill covers: when to call `get_hint_map`, how to handle Safe Mode approvals, multi-step patterns (search → filter → extract), popup dismissal, and security rules.

```bash
# OpenClaw
cp -r aether/skill ~/.openclaw/skills/aether

# Claude Code
cp -r aether/skill ~/.claude/skills/aether
```

## Compared To

| | Aether | browser-use | Stagehand | Manus Operator |
|-|--------|-------------|-----------|----------------|
| Login sessions | ✅ Your real browser | ⚠️ Need config | ❌ Cloud session | ✅ Your browser |
| Anti-detection | ✅ Nothing to detect | ⚠️ Stealth plugins | ❌ None | ✅ Nothing to detect |
| Works with any AI | ✅ MCP standard | ⚠️ Python SDK | ⚠️ Own SDK | ❌ Manus only |
| Open source | ✅ MIT | ✅ | ✅ | ❌ |
| Page perception | ✅ Hint Map | ❌ Raw DOM | ⚠️ Partial | ❓ Unknown |
| Safe Mode | ✅ Built-in | ❌ | ❌ | ❌ |
| Non-dev friendly | ✅ Skill + GUI planned | ❌ Code only | ❌ Code only | ✅ |

## Project Structure

```
aether/
├── extension/          Chrome Extension (Manifest V3)
│   ├── content.js      Hint Map v2 + page actions
│   ├── background.js   WebSocket bridge
│   └── popup.html      Connection status UI
├── server/
│   └── src/index.js    MCP Server + Safe Mode engine
├── skill/
│   └── SKILL.md        AI agent instructions
└── scripts/
    └── test-e2e.js     15/15 tests passing
```

## Roadmap

- [x] Navigation, click, type, screenshot, extract, scroll
- [x] Hint Map v2: regions, priority, semantics, dedup
- [x] Safe Mode: approval workflow, per-category policies
- [x] Skill format for OpenClaw / Claude Code
- [ ] Self-Healing: auto-adapt when page layout changes
- [ ] Multi-Profile: switch browser profiles per task
- [ ] Visual config UI for non-developers
- [ ] WebMCP compatibility layer
- [ ] Plugin marketplace for site-specific Hint Map optimizations

## Philosophy

> Don't build a new browser. Let AI **inhabit** the user's existing one.

The browser agent space is in an arms race: bots get smarter, detection gets tighter. Aether steps out of the race entirely. When you use the user's own browser, there is no bot to detect.

## License

MIT

---

<p align="center">
  <strong>Aether</strong> — αἰθήρ — the fifth element, invisible but everywhere.
</p>
