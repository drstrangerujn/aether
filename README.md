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

Instead of building another headless browser, faking fingerprints, or managing stolen cookies, Aether takes a fundamentally different approach — it **inhabits the browser you already use**. A lightweight Chrome extension bridges your real browser to any AI application via the MCP protocol. Your login sessions, cookies, IP, and fingerprint are all real. Websites see a human, because it *is* your browser.

## Why

You've tried letting AI control a browser. You know what happens.

Headless Chrome opens. No cookies, no login, nothing. You're a stranger to every site. Cloudflare blocks you. So you bolt on stealth plugins, fake the User-Agent, randomize Canvas. It works Tuesday, breaks Thursday. The site updates, you update, nobody wins. And even when you get past the gate, the AI stares at 50,000 tokens of raw DOM and clicks the wrong thing.

Aether skips all of that. It runs inside the browser you already have open. Your sessions, your cookies, your fingerprint — already there. Nothing to fake, nothing to fight.

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
git clone https://github.com/drstrangerujn/aether.git
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

## Tools (22)

| | Tool | What it does |
|-|------|-------------|
| 👁 | `get_hint_map` | Structured page perception. **Always call first.** Auto-dismisses popups. |
| 👁 | `screenshot` | Viewport capture |
| 👁 | `full_screenshot` | Full page capture (beyond viewport, for headless) |
| 👁 | `extract` | Pull text from elements |
| 👁 | `detect_qr` | Find & extract QR codes (login, payment) |
| ✋ | `navigate` | Open URL (with smart profile suggestion) |
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
| 👤 | `profile_list` | List browser profiles |
| 👤 | `profile_switch` | Switch active profile |
| 👤 | `profile_label` | Name a profile |
| 👤 | `profile_domain` | Associate domains with profiles |
| 📄 | `page_to_pdf` | Export page as PDF (for headless) |
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
| Self-Healing | ✅ Auto-recover | ❌ | ✅ | ❌ |
| Path Cache | ✅ Record & replay | ❌ | ✅ Cache | ❌ |
| Headless support | ✅ QR + PDF + full screenshot | ❌ | ❌ | ❌ |
| Multi-Profile | ✅ Per-task switching | ❌ | ❌ | ❌ |

## Project Structure

```
aether/
├── extension/                Chrome Extension (Manifest V3)
│   ├── content.js            Hint Map v2 + Self-Healing + Auto Dismiss + QR detection
│   ├── background.js         WebSocket bridge + CDP (PDF, full screenshot, QR capture)
│   └── popup.html            Connection status UI
├── server/
│   └── src/
│       ├── index.js          MCP Server + Safe Mode + 22 tools
│       ├── cache.js           Path Cache engine
│       └── profiles.js        Multi-Profile manager
├── skill/
│   └── SKILL.md              AI agent instructions
└── scripts/
    └── test-e2e.js           15/15 tests passing
```

## Roadmap

- [x] Navigation, click, type, screenshot, extract, scroll
- [x] Hint Map v2: regions, priority, semantics, dedup
- [x] Safe Mode: approval workflow, per-category policies
- [x] Auto Dismiss: cookie banners, popups, overlays
- [x] Path Cache: record & replay multi-step workflows
- [x] Self-Healing: auto-recover when elements move
- [x] Headless: QR detection, PDF export, full-page screenshot
- [x] Multi-Profile: per-task browser profile switching
- [x] Skill format for OpenClaw / Claude Code
- [ ] npm publish + ClawHub submission
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
