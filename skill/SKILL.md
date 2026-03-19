---
name: aether
description: "Control the user's real browser with AI. Navigate, click, type, extract — with login sessions preserved and zero bot detection. Uses Hint Map for structured page perception."
user-invocable: true
metadata: {"openclaw":{"emoji":"👻","homepage":"https://github.com/liuxiyu1992/aether","requires":{"bins":["node"]}}}
---

# Aether — AI Browser Agent

You have access to the user's **real browser** via Aether. All their login sessions, cookies, and browsing history are intact. Websites see a normal human, not a bot.

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
   - Which category triggered it (payment, delete, send, account, download)
2. Ask the user to choose:
   - **approve** — do it this once
   - **approve_all** — always allow this category (user trusts this type of action)
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
| `extract` | Pull text from specific elements by hint_id or full page content |

### Action
| Tool | When to use |
|------|-------------|
| `navigate` | Open a URL. Always safe, no approval needed. |
| `click` | Click elements. Prefer `hint_id`, fallback to `text`. Sensitive targets trigger Safe Mode. |
| `type` | Type into inputs. Set `pressEnter: true` to submit search forms. |
| `scroll` | Scroll page. Use after get_hint_map shows `inView: false` elements. |
| `wait_for` | Wait for dynamic content. Use after clicks that trigger page changes. |
| `execute_js` | Run JS in page. **Always requires approval.** Use sparingly. |

### Control
| Tool | When to use |
|------|-------------|
| `safe_mode_respond` | Reply to approval requests. |
| `safe_mode_policy` | View/change approval policies. |
| `get_tabs` | See which tabs are open. |
| `get_audit_log` | Review what actions have been taken. |

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

### Login-Protected Flow
```
navigate({ url: "https://app.example.com" })
get_hint_map()
→ if state.login is true: tell user "this page requires login,
  but you should already be logged in since we're using your real browser.
  If not, please log in manually and I'll continue."
→ if state.login is false: proceed normally
```

### Popups, Cookies, Overlays
`get_hint_map` **automatically dismisses** cookie banners, consent popups, newsletter overlays, and notification prompts before scanning. Check the `dismissed` array in the response to see what was cleared. If something persists:
```
auto_dismiss()        → force another sweep
get_hint_map()        → check if it's gone
→ if still there: click the close/dismiss button manually via hint_id
```

## Rules

1. **Never type passwords or sensitive credentials.** If a login form appears, tell the user to do it manually.
2. **Always get_hint_map first.** Blind clicking wastes tokens and fails often.
3. **Respect Safe Mode.** Present every approval request to the user. Their trust is earned, not assumed.
4. **Use regions to focus.** If the task is about main content, ignore nav/footer elements.
5. **Read the summary line.** It tells you in one sentence what you're looking at.
6. **Check semantics.** Prices, dates, and counts are auto-extracted — don't scrape manually.
7. **Verify after acting.** Call get_hint_map after important actions to confirm the page changed as expected.
