---
name: aether
description: "Browser automation via MCP + Playwright. Navigate, click, type, extract — headless or headed, VPS-ready, zero extensions. Hint Map for structured page perception, Safe Mode for sensitive actions."
user-invocable: true
metadata: {"openclaw":{"emoji":"👻","homepage":"https://github.com/liuxiyu1992/aether","requires":{"bins":["node"]}}}
---

# Aether — AI Browser Agent (Playwright)

You control a **Playwright-driven Chromium** browser via Aether. No extensions, no WebSocket bridge — just MCP over stdio to a Node server that drives the browser directly. Works headless on VPS, headed on desktop.

## Architecture

```
AI  ←─ MCP/stdio ─→  Aether Server  ←─ Playwright ─→  Chromium
```

The server launches Chromium on startup. All commands execute via `page.evaluate()` against an injected script (`__aether`). Cookie/session state persists via `save_session` / `--storage-state`.

## Core Workflow

Every browser task follows this loop:

```
get_hint_map → understand page → act → verify
```

1. **Always start with `get_hint_map`** before any interaction. It returns:
   - `interactables` — clickable/typeable elements sorted by priority, each with a unique `id` like `h0`, `h5`
   - `regions` — where each element lives (nav, main, sidebar, modal)
   - `semantics` — auto-extracted prices, dates, emails, counts
   - `state` — popup/captcha/login/cookie banner detection
   - `summary` — one-line page overview

2. **Use hint IDs** for precise actions: `click({ hint_id: "h3" })` not CSS selectors. Hint IDs are stable within a page session.

3. **After acting, call `get_hint_map` again** to see the updated page. Pages change after clicks and navigation.

## Safe Mode

Sensitive actions are **automatically intercepted**. When you see `_aether_approval_required` in a response:

1. Present the action to the user clearly:
   - What you're about to do
   - Which category triggered it (payment, delete, send, account)
2. Ask the user to choose:
   - **approve** — do it this once
   - **approve_once** — allow this once, don't remember
   - **approve_all** — always allow this category
   - **reject** — cancel
   - **reject_always** — never allow this category
3. Call `safe_mode_respond` with their decision and the `approval_id`

Never skip this step. Never auto-approve.

## Tool Reference

### Perception
| Tool | When to use |
|------|-------------|
| `get_hint_map` | **First call on every new page.** Returns structured page map. Use `detail_level: "full"` for data-heavy pages. |
| `screenshot` | When you need visual context or the user asks "what does the page look like" |
| `full_screenshot` | Capture entire page including below-the-fold content |
| `extract` | Pull text from specific elements by hint_id or full page content |
| `detect_qr` | Find QR codes on page — essential for headless login flows |

### Action
| Tool | When to use |
|------|-------------|
| `navigate` | Open a URL. Use `newTab: true` to open in a new tab. Always safe, no approval needed. |
| `click` | Click elements. Prefer `hint_id`, fallback to `text`. Sensitive targets trigger Safe Mode. |
| `type` | Type into inputs. Set `pressEnter: true` to submit search forms. `clear: true` to empty field first. |
| `scroll` | Scroll page: `up`, `down`, `left`, `right`, `top`, `bottom`. Use after get_hint_map shows off-screen elements. |
| `wait_for` | Wait for dynamic content — by `selector`, `text`, `url`, or `condition: "loaded"`. |
| `execute_js` | Run arbitrary JS in page. **Always requires approval.** Use sparingly. |
| `auto_dismiss` | Force-dismiss popups, cookie banners, overlays. |

### Session & State
| Tool | When to use |
|------|-------------|
| `save_session` | Save cookies/localStorage to disk. Reload next launch with `--storage-state`. |
| `get_tabs` | List open tabs with URLs and titles. |
| `get_audit_log` | Review action history for debugging. |
| `page_to_pdf` | Export current page as PDF. |

### Safe Mode Control
| Tool | When to use |
|------|-------------|
| `safe_mode_respond` | Reply to approval requests with user's decision. |
| `safe_mode_policy` | View/change/reset approval policies. `action: "toggle"` to turn Safe Mode on/off. |

### Path Cache
| Tool | When to use |
|------|-------------|
| `cache_start` | Begin recording a replayable workflow. Call `get_hint_map` first. |
| `cache_stop` | Save the current recording. |
| `cache_replay` | Replay a saved workflow by label. Falls back to AI if page structure changed. |
| `cache_list` | List saved paths. Filter by `domain`. |
| `cache_delete` | Remove a saved path by key. |

## Multi-Step Patterns

### Search → Filter → Extract
```
navigate({ url: "https://example.com" })
get_hint_map()                          → find search input
type({ hint_id: "h2", text: "query", pressEnter: true })
wait_for({ condition: "loaded" })
get_hint_map()                          → read results, find filters
click({ hint_id: "h15" })              → apply filter
get_hint_map()                          → extract final data
```

### Login with Session Persistence
```
navigate({ url: "https://app.example.com/login" })
get_hint_map()
→ if login form detected:
  tell user "Please log in manually (or scan QR code if headless)"
  wait_for({ url: "dashboard", timeout: 120000 })
  save_session()    → cookies saved for next launch
→ next time: launch with --storage-state ~/.aether/session.json
  → user is already logged in
```

### Headless QR Code Login
```
navigate({ url: "https://login.taobao.com" })
get_hint_map()
→ if state.qrCode is true:
  detect_qr()    → returns QR image data
  → present image to user: "Please scan this QR code with your phone"
  wait_for({ text: "登录成功", timeout: 60000 })
  save_session()
```

### Popups, Cookies, Overlays
`get_hint_map` automatically dismisses common overlays before scanning. If something persists:
```
auto_dismiss()        → force another sweep
get_hint_map()        → check if it's gone
→ if still there: click the close/dismiss button manually via hint_id
```

## Path Cache

Record and replay multi-step workflows to save tokens and time.

### Recording
```
get_hint_map()
cache_start({ label: "search products" })
→ execute steps normally (navigate, type, click, etc.)
→ all steps recorded automatically
cache_stop()
```

### Replaying
```
get_hint_map()
cache_replay({ label: "search products" })
→ if found: steps execute automatically
→ if a step fails (page changed): returns remaining steps for AI to handle
→ if not found: execute manually, then record with cache_start/cache_stop
```

Use for any workflow repeated more than once on the same site.

## Self-Healing

When a `hint_id` no longer exists (page refreshed, dynamic content changed), Aether searches for the closest match using the element's signature (text, type, region, attributes).

If a response contains `"healed": { ... }`, it means:
- The original element was gone
- A similar element was found and used instead
- Confidence score indicates match quality (0-100)

You don't need to handle this — just use hint_ids normally. If healing fails (score < 30), call `get_hint_map` for fresh IDs.

## Deployment

### VPS / Headless (default)
```bash
npm install          # installs Playwright + Chromium + system deps
npm start            # headless mode
```
No display needed. Use `detect_qr` + `screenshot` for visual feedback.

### Desktop / Headed
```bash
npm run start:headed    # visible browser window
```

### CLI Flags
| Flag | Example | Purpose |
|------|---------|---------|
| `--headed` | — | Show browser window |
| `--cdp` | `ws://localhost:9222` | Connect to existing Chrome via CDP |
| `--viewport` | `1920x1080` | Browser viewport size |
| `--storage-state` | `~/.aether/session.json` | Load saved cookies/sessions |
| `--locale` | `en-US` | Browser locale (default: zh-CN) |
| `--user-agent` | `"Mozilla/5.0 ..."` | Custom user agent string |

## Rules

1. **Never type passwords or sensitive credentials.** If a login form appears, tell the user to do it manually.
2. **Always get_hint_map first.** Blind clicking wastes tokens and fails often.
3. **Respect Safe Mode.** Present every approval request to the user. Their trust is earned, not assumed.
4. **Use regions to focus.** If the task is about main content, ignore nav/footer elements.
5. **Read the summary line.** It tells you in one sentence what you're looking at.
6. **Check semantics.** Prices, dates, and counts are auto-extracted — don't scrape manually.
7. **Verify after acting.** Call get_hint_map after important actions to confirm the page changed as expected.
8. **Save sessions.** After successful login, always `save_session()` so the user doesn't have to log in again.
