/**
 * Aether Content Script v0.2.0
 *
 * Hint Map v2 — structured page perception for AI agents
 *  + Region detection (nav, main, sidebar, footer, modal)
 *  + Semantic extraction (prices, dates, counts, status badges)
 *  + Priority scoring (visible > offscreen, large > small)
 *  + Smart element deduplication
 */

// ─── Visibility & geometry ──────────────────────────────────────────────────

function isVisible(el) {
  const s = getComputedStyle(el);
  if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function inViewport(rect) {
  return rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
}

function center(rect) {
  return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
}

// ─── Element classification ─────────────────────────────────────────────────

const TYPE_MAP = {
  A: 'link', BUTTON: 'button', TEXTAREA: 'textarea', SELECT: 'select', SUMMARY: 'toggle',
};

function getType(el) {
  if (TYPE_MAP[el.tagName]) return TYPE_MAP[el.tagName];
  if (el.getAttribute('role') === 'button') return 'button';
  if (el.getAttribute('role') === 'tab') return 'tab';
  if (el.getAttribute('role') === 'menuitem') return 'menuitem';
  if (el.getAttribute('contenteditable') === 'true') return 'editable';
  if (el.tagName === 'INPUT') {
    const t = (el.type || 'text').toLowerCase();
    return { submit: 'submit', checkbox: 'checkbox', radio: 'radio' }[t] || 'input';
  }
  return 'interactive';
}

function getText(el) {
  return (el.getAttribute('aria-label') || el.innerText || el.value || el.title || el.alt || '')
    .trim().replace(/\s+/g, ' ').slice(0, 120);
}

// ─── Region detection ───────────────────────────────────────────────────────

function detectRegion(el) {
  let node = el;
  for (let i = 0; i < 8 && node && node !== document.body; i++) {
    const tag = node.tagName?.toLowerCase();
    const role = node.getAttribute?.('role');
    const cls = (node.className || '').toString().toLowerCase();
    const id = (node.id || '').toLowerCase();

    // Modal/dialog (highest priority — overrides everything)
    if (role === 'dialog' || role === 'alertdialog' || cls.includes('modal') || cls.includes('dialog'))
      return 'modal';

    if (tag === 'nav' || role === 'navigation' || cls.includes('nav') || cls.includes('menu'))
      return 'nav';
    if (tag === 'main' || role === 'main')
      return 'main';
    if (tag === 'aside' || role === 'complementary' || cls.includes('sidebar') || cls.includes('side-panel'))
      return 'sidebar';
    if (tag === 'footer' || role === 'contentinfo' || cls.includes('footer'))
      return 'footer';
    if (tag === 'header' || role === 'banner' || cls.includes('header') || cls.includes('topbar'))
      return 'header';
    if (tag === 'form' || id.includes('search') || cls.includes('search'))
      return 'search';

    node = node.parentElement;
  }
  return 'main'; // default
}

// ─── Semantic data extraction ───────────────────────────────────────────────

const SEMANTIC_PATTERNS = {
  price:    /[\$\¥\€\£]\s?\d[\d,]*\.?\d*/g,
  date:     /\d{4}[-\/]\d{1,2}[-\/]\d{1,2}/g,
  email:    /[\w.-]+@[\w.-]+\.\w+/g,
  phone:    /[\+]?[\d\s\-\(\)]{7,15}/g,
  count:    /\b(\d{1,3}(?:,\d{3})*)\s*(?:items?|results?|reviews?|ratings?|件|条|个)\b/gi,
  percent:  /\d+\.?\d*\s?%/g,
};

function extractSemantics(text) {
  const found = {};
  for (const [key, regex] of Object.entries(SEMANTIC_PATTERNS)) {
    const matches = text.match(regex);
    if (matches?.length) found[key] = [...new Set(matches)].slice(0, 5);
  }
  return Object.keys(found).length ? found : undefined;
}

// ─── Table extraction ───────────────────────────────────────────────────────

function extractTables() {
  return Array.from(document.querySelectorAll('table')).slice(0, 3).map(table => {
    const headers = Array.from(table.querySelectorAll('th'))
      .map(th => th.innerText.trim()).filter(Boolean);
    const rows = Array.from(table.querySelectorAll('tbody tr')).slice(0, 10).map(
      tr => Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim().slice(0, 80))
    );
    return headers.length || rows.length ? { headers, rows, rowCount: table.querySelectorAll('tr').length } : null;
  }).filter(Boolean);
}

// ─── List extraction ────────────────────────────────────────────────────────

function extractLists() {
  return Array.from(document.querySelectorAll('ul, ol'))
    .filter(l => l.children.length >= 2 && l.children.length <= 50 && isVisible(l))
    .slice(0, 5)
    .map(l => ({
      type: l.tagName.toLowerCase(),
      items: Array.from(l.children).slice(0, 10).map(li => li.innerText.trim().slice(0, 100)),
      total: l.children.length
    }));
}

// ─── Priority scoring ───────────────────────────────────────────────────────

function scorePriority(el, rect) {
  let score = 50;
  if (inViewport(rect)) score += 30;                                  // visible
  if (rect.width > 100 && rect.height > 30) score += 10;             // substantial size
  if (el.tagName === 'BUTTON' || el.type === 'submit') score += 10;  // actionable
  if (detectRegion(el) === 'modal') score += 20;                      // modal = urgent
  if (el.getAttribute('aria-label')) score += 5;                      // well-labeled
  if (el.disabled) score -= 40;                                       // disabled
  return Math.min(100, Math.max(0, score));
}

// ─── Detection helpers ──────────────────────────────────────────────────────

function detectPopup() {
  const sel = '[role="dialog"], .modal, .popup, .overlay, [class*="modal"], [class*="dialog"]';
  return Array.from(document.querySelectorAll(sel)).some(isVisible);
}

function detectLogin() {
  return document.querySelectorAll('input[type="password"]').length > 0;
}

function detectCaptcha() {
  const sel = 'iframe[src*="recaptcha"], iframe[src*="captcha"], .g-recaptcha, [class*="captcha"]';
  return document.querySelectorAll(sel).length > 0;
}

function detectCookieBanner() {
  const sel = '[class*="cookie"], [id*="cookie"], [class*="consent"], [id*="consent"]';
  return Array.from(document.querySelectorAll(sel)).some(isVisible);
}

// ─── Auto Dismiss — clear common roadblocks ────────────────────────────────
//
// Cookie banners, notification prompts, newsletter popups, age gates, etc.
// These waste agent tokens and block the real task. Kill them on sight.

const DISMISS_BUTTONS = [
  // Cookie / consent
  'accept all', 'accept cookies', 'accept', 'agree', 'allow all', 'allow cookies',
  'got it', 'i agree', 'i understand', 'ok', 'okay', 'continue',
  'dismiss', 'close', 'no thanks', 'not now', 'maybe later', 'skip',
  'reject all', 'reject', 'deny', 'decline',         // privacy-first: try reject first
  // Chinese
  '同意', '接受', '全部接受', '知道了', '关闭', '我同意', '不再提醒',
  '好的', '确定', '跳过', '以后再说', '暂不',
];

const DISMISS_CONTAINERS = [
  '[class*="cookie"]', '[id*="cookie"]',
  '[class*="consent"]', '[id*="consent"]',
  '[class*="gdpr"]', '[id*="gdpr"]',
  '[class*="notice"]', '[id*="notice-banner"]',
  '[class*="newsletter"]', '[class*="subscribe-popup"]',
  '[class*="notification-prompt"]',
  '[role="dialog"]', '[role="alertdialog"]',
  '.modal', '.popup', '.overlay',
];

function autoDismiss() {
  const dismissed = [];

  // Find visible roadblock containers
  for (const sel of DISMISS_CONTAINERS) {
    for (const container of document.querySelectorAll(sel)) {
      if (!isVisible(container)) continue;

      // Look for dismiss buttons inside
      const buttons = container.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]');
      for (const btn of buttons) {
        const text = getText(btn).toLowerCase();
        // Try reject/decline first (privacy-first), then accept/dismiss
        const match = DISMISS_BUTTONS.find(d => text.includes(d));
        if (match) {
          btn.click();
          dismissed.push({ text: getText(btn), container: sel, matched: match });
          break; // one click per container
        }
      }

      // Fallback: look for close/X button by aria-label or class
      if (dismissed.length === 0) {
        const closeBtn = container.querySelector(
          '[aria-label="Close"], [aria-label="close"], [aria-label="关闭"], ' +
          '.close, .close-btn, [class*="close"], [class*="dismiss"]'
        );
        if (closeBtn && isVisible(closeBtn)) {
          closeBtn.click();
          dismissed.push({ text: 'X', container: sel, matched: 'close-button' });
        }
      }
    }
  }

  // Also dismiss browser notification permission prompts (can't click them, but can detect)
  // and remove fixed/sticky overlays that cover the page
  for (const el of document.querySelectorAll('*')) {
    const style = getComputedStyle(el);
    if (style.position === 'fixed' && style.zIndex > 9000 && el.offsetHeight < 300) {
      const text = (el.innerText || '').toLowerCase();
      if (DISMISS_BUTTONS.some(d => text.includes(d))) {
        const btn = el.querySelector('button, a, [role="button"]');
        if (btn) {
          btn.click();
          dismissed.push({ text: getText(btn), container: 'high-z-fixed', matched: 'overlay' });
        }
      }
    }
  }

  return dismissed;
}

// ─── Hint Map v2 Generator ──────────────────────────────────────────────────

function generateHintMap(options = {}) {
  const detail = options.detail_level || 'standard';

  // Auto-dismiss roadblocks before scanning (unless explicitly disabled)
  let dismissed = [];
  if (options.auto_dismiss !== false) {
    dismissed = autoDismiss();
  }

  const map = {
    url: location.href,
    title: document.title,
    ts: Date.now(),
    viewport: {
      w: innerWidth, h: innerHeight,
      scrollX, scrollY,
      totalH: document.documentElement.scrollHeight
    },
    state: {
      loading: document.readyState !== 'complete',
      popup: detectPopup(),
      login: detectLogin(),
      captcha: detectCaptcha(),
      cookieBanner: detectCookieBanner(),
      qrCode: detectQRCodes().length > 0,
    },
    dismissed,   // what was auto-cleared this round
    interactables: [],
  };

  // ─── Collect & score interactables ───

  const selectors = [
    'a[href]', 'button', 'input', 'textarea', 'select',
    '[role="button"]', '[role="link"]', '[role="tab"]', '[role="menuitem"]',
    '[onclick]', '[contenteditable="true"]', 'summary', '[tabindex]:not([tabindex="-1"])'
  ];

  const seen = new Set(); // dedup by position
  let hintId = 0;

  document.querySelectorAll(selectors.join(',')).forEach(el => {
    if (!isVisible(el)) return;
    const rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return;

    // Dedup: skip elements at the same pixel position
    const posKey = `${Math.round(rect.x)},${Math.round(rect.y)}`;
    if (seen.has(posKey)) return;
    seen.add(posKey);

    const hint = {
      id: `h${hintId++}`,
      type: getType(el),
      text: getText(el),
      region: detectRegion(el),
      priority: scorePriority(el, rect),
      pos: center(rect),
      inView: inViewport(rect),
    };

    // Conditionals — only include if present
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      hint.inputType = el.type || 'text';
      if (el.placeholder) hint.placeholder = el.placeholder;
      if (el.value) hint.value = el.value;
      if (el.name) hint.name = el.name;
    }
    if (el.tagName === 'A' && el.href) hint.href = el.href;
    if (el.tagName === 'SELECT') {
      hint.options = Array.from(el.options).map(o => ({
        text: o.text, value: o.value, selected: o.selected
      }));
    }
    if (el.disabled) hint.disabled = true;

    const aria = el.getAttribute('aria-label');
    if (aria) hint.aria = aria;

    el.dataset.aetherId = hint.id;
    saveSignature(hint.id, el); // for self-healing
    map.interactables.push(hint);
  });

  // Sort: highest priority first
  map.interactables.sort((a, b) => b.priority - a.priority);

  // ─── Content layer (standard & full) ───

  if (detail !== 'minimal') {
    const mainEl = document.querySelector('main, [role="main"], article, .content, #content') || document.body;
    const mainText = (mainEl.innerText || '').trim();

    map.content = {
      headings: Array.from(document.querySelectorAll('h1,h2,h3')).slice(0, 20)
        .map(h => ({ level: +h.tagName[1], text: h.innerText.trim().slice(0, 200) })),
      mainText: mainText.slice(0, detail === 'full' ? 3000 : 600),
      semantics: extractSemantics(mainText.slice(0, 5000)),
      tables: extractTables(),
      lists: extractLists(),
      forms: Array.from(document.querySelectorAll('form')).slice(0, 5).map(f => ({
        action: f.action, method: f.method,
        fields: Array.from(f.elements)
          .filter(e => e.tagName !== 'BUTTON' && e.type !== 'hidden')
          .slice(0, 20)
          .map(e => ({ name: e.name, type: e.type, placeholder: e.placeholder, required: e.required }))
      })),
      images: Array.from(document.querySelectorAll('img[alt]'))
        .filter(i => i.width > 50 && i.height > 50).slice(0, 10)
        .map(i => ({ alt: i.alt.slice(0, 100), src: i.src })),
    };
  }

  // Summary line for quick orientation
  const interactCount = map.interactables.length;
  const regions = [...new Set(map.interactables.map(h => h.region))];
  map.summary = `${interactCount} elements across [${regions.join(', ')}]`
    + (map.state.popup ? ' ⚠️ popup detected' : '')
    + (map.state.captcha ? ' ⚠️ captcha detected' : '')
    + (map.state.cookieBanner ? ' 🍪 cookie banner' : '');

  return map;
}

// ─── Self-Healing Element Finder ────────────────────────────────────────────
//
// When a hint_id can't be found (page changed, dynamic reload), we don't just
// fail. We remember what that element looked like and search for the closest
// match on the current page. This is the core of self-healing.

// Cache of element signatures from the last Hint Map scan
const elementSignatures = new Map(); // hint_id -> { text, type, region, tag, inputType, name, href, aria }

function saveSignature(hintId, el) {
  elementSignatures.set(hintId, {
    text: getText(el).toLowerCase(),
    type: getType(el),
    tag: el.tagName.toLowerCase(),
    region: detectRegion(el),
    inputType: el.type || null,
    name: el.name || null,
    href: el.href || null,
    aria: el.getAttribute('aria-label') || null,
    placeholder: el.placeholder || null,
  });
}

function similarity(sig, el) {
  let score = 0;
  const elText = getText(el).toLowerCase();
  const elType = getType(el);

  // Text match (most important)
  if (sig.text && elText) {
    if (elText === sig.text) score += 40;
    else if (elText.includes(sig.text) || sig.text.includes(elText)) score += 25;
  }

  // Type match
  if (elType === sig.type) score += 20;

  // Tag match
  if (el.tagName.toLowerCase() === sig.tag) score += 10;

  // Region match
  if (detectRegion(el) === sig.region) score += 10;

  // Attribute matches
  if (sig.name && el.name === sig.name) score += 10;
  if (sig.inputType && el.type === sig.inputType) score += 5;
  if (sig.placeholder && el.placeholder === sig.placeholder) score += 10;
  if (sig.aria && el.getAttribute('aria-label') === sig.aria) score += 10;
  if (sig.href && el.href && el.href.includes(sig.href.split('?')[0])) score += 10;

  return score;
}

function findElement(params) {
  let healed = false;

  // Direct lookup by hint_id
  if (params.hint_id) {
    const el = document.querySelector(`[data-aether-id="${params.hint_id}"]`);
    if (el && isVisible(el)) return { el, healed: false };

    // Self-Healing: hint_id not found, search by signature
    const sig = elementSignatures.get(params.hint_id);
    if (sig) {
      const candidates = document.querySelectorAll(
        'a, button, input, textarea, select, [role="button"], [onclick], [contenteditable]'
      );
      let bestEl = null, bestScore = 0;

      for (const candidate of candidates) {
        if (!isVisible(candidate)) continue;
        const s = similarity(sig, candidate);
        if (s > bestScore) {
          bestScore = s;
          bestEl = candidate;
        }
      }

      // Threshold: need at least 30 points to consider it a match
      if (bestEl && bestScore >= 30) {
        return { el: bestEl, healed: true, score: bestScore, originalId: params.hint_id };
      }
    }
  }

  // Text search (unchanged, but wrapped)
  if (params.text) {
    const needle = params.text.toLowerCase();
    for (const scope of [
      'a, button, input[type="submit"], [role="button"]',
      'a, button, input, textarea, select, [role="button"], [onclick]'
    ]) {
      for (const el of document.querySelectorAll(scope)) {
        if (isVisible(el) && getText(el).toLowerCase().includes(needle))
          return { el, healed: false };
      }
    }
  }

  // CSS selector
  if (params.selector) {
    const el = document.querySelector(params.selector);
    if (el) return { el, healed: false };
  }

  return { el: null, healed: false };
}

// ─── Actions ────────────────────────────────────────────────────────────────

function handleClick(params) {
  const { el, healed, score, originalId } = findElement(params);
  if (!el) return { success: false, error: `Not found: ${JSON.stringify(params)}` };

  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return new Promise(resolve => {
    setTimeout(() => {
      el.click();
      const result = {
        success: true,
        clicked: { tag: el.tagName.toLowerCase(), text: getText(el), href: el.href || null }
      };
      if (healed) result.healed = { originalId, newText: getText(el), confidence: score };
      resolve(result);
    }, 200);
  });
}

function handleType(params) {
  const { el, healed, score, originalId } = findElement(params);
  if (!el) return { success: false, error: `Not found: ${JSON.stringify(params)}` };

  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.focus();

  if (params.clear !== false) {
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  el.value = params.text || '';
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));

  if (params.pressEnter) {
    const opts = { key: 'Enter', keyCode: 13, bubbles: true };
    el.dispatchEvent(new KeyboardEvent('keydown', opts));
    el.dispatchEvent(new KeyboardEvent('keypress', opts));
    el.dispatchEvent(new KeyboardEvent('keyup', opts));
  }

  const result = { success: true, typed: { tag: el.tagName.toLowerCase(), name: el.name, value: el.value } };
  if (healed) result.healed = { originalId, newText: getText(el), confidence: score };
  return result;
}

function handleScroll(params) {
  const d = params.direction || 'down';
  const a = params.amount || 500;
  const ops = {
    down: [0, a], up: [0, -a], left: [-a, 0], right: [a, 0],
    top: null, bottom: null
  };
  if (d === 'top') scrollTo(0, 0);
  else if (d === 'bottom') scrollTo(0, document.documentElement.scrollHeight);
  else scrollBy(...ops[d]);

  return { success: true, pos: { x: scrollX, y: scrollY, maxY: document.documentElement.scrollHeight - innerHeight } };
}

function handleExtract(params) {
  if (params.hint_id || params.text) {
    const { el, healed } = findElement(params);
    if (el) {
      const result = { success: true, text: el.innerText.trim(), html: el.innerHTML };
      if (healed) result.healed = true;
      return result;
    }
    return { success: false, error: 'Not found' };
  }
  if (params.selector) {
    const el = document.querySelector(params.selector);
    if (el) return { success: true, text: el.innerText.trim(), html: el.innerHTML };
    return { success: false, error: 'Not found' };
  }

  // Full page extract
  const main = document.querySelector('main, [role="main"], article') || document.body;
  return { success: true, text: main.innerText.trim().slice(0, 5000), title: document.title, url: location.href };
}

function handleWaitFor(params) {
  const timeout = params.timeout || 10000;
  const start = Date.now();
  return new Promise(resolve => {
    (function check() {
      if (params.selector) {
        const el = document.querySelector(params.selector);
        if (el && isVisible(el)) return resolve({ success: true, waited: Date.now() - start });
      }
      if (params.text && document.body.innerText.includes(params.text))
        return resolve({ success: true, waited: Date.now() - start });
      if (params.url && location.href.includes(params.url))
        return resolve({ success: true, waited: Date.now() - start });
      if (params.condition === 'loaded' && document.readyState === 'complete')
        return resolve({ success: true, waited: Date.now() - start });
      if (Date.now() - start > timeout)
        return resolve({ success: false, error: `Timeout (${timeout}ms)`, waited: timeout });
      setTimeout(check, 200);
    })();
  });
}

// ─── QR Code Detection ──────────────────────────────────────────────────────
//
// On headless servers, the user can't see QR codes for WeChat/Alipay/DingTalk
// login. We detect them and extract the image so the AI can push it to the user.

function detectQRCodes() {
  const qrCandidates = [];

  // 1. Images with QR-related attributes
  const qrSelectors = [
    'img[src*="qr"]', 'img[src*="QR"]', 'img[src*="qrcode"]',
    'img[class*="qr"]', 'img[id*="qr"]',
    'img[alt*="二维码"]', 'img[alt*="QR"]', 'img[alt*="扫码"]', 'img[alt*="scan"]',
    'img[src*="login"]img[src*="code"]',
  ];

  for (const sel of qrSelectors) {
    for (const img of document.querySelectorAll(sel)) {
      if (!isVisible(img) || img.width < 50 || img.height < 50) continue;
      qrCandidates.push({
        type: 'img',
        src: img.src,
        alt: img.alt || '',
        size: { w: img.width, h: img.height },
        rect: img.getBoundingClientRect(),
      });
    }
  }

  // 2. Canvas elements (many QR generators render to canvas)
  for (const canvas of document.querySelectorAll('canvas')) {
    if (!isVisible(canvas)) continue;
    const rect = canvas.getBoundingClientRect();
    // QR codes are usually square-ish, 100-400px
    if (rect.width < 80 || rect.height < 80) continue;
    if (Math.abs(rect.width - rect.height) > rect.width * 0.2) continue; // not square

    // Check if near QR-related text
    const parent = canvas.parentElement;
    const nearbyText = (parent?.innerText || '').toLowerCase();
    const isQR = /qr|二维码|扫码|扫一扫|scan|微信|wechat|alipay|支付宝|钉钉/.test(nearbyText);

    if (isQR || rect.width > 120) {
      try {
        qrCandidates.push({
          type: 'canvas',
          dataUrl: canvas.toDataURL('image/png'),
          size: { w: Math.round(rect.width), h: Math.round(rect.height) },
          nearbyText: nearbyText.slice(0, 100),
          rect,
        });
      } catch (e) {
        // Canvas may be tainted (cross-origin), skip
        qrCandidates.push({
          type: 'canvas',
          tainted: true,
          size: { w: Math.round(rect.width), h: Math.round(rect.height) },
          nearbyText: nearbyText.slice(0, 100),
          rect,
        });
      }
    }
  }

  // 3. SVG-based QR codes
  for (const svg of document.querySelectorAll('svg')) {
    if (!isVisible(svg)) continue;
    const rect = svg.getBoundingClientRect();
    if (rect.width < 80 || rect.height < 80) continue;
    if (Math.abs(rect.width - rect.height) > rect.width * 0.2) continue;

    // SVG QR codes have many small rect/path elements
    const pathCount = svg.querySelectorAll('rect, path').length;
    if (pathCount > 50) {
      const parent = svg.parentElement;
      const nearbyText = (parent?.innerText || '').toLowerCase();
      qrCandidates.push({
        type: 'svg',
        size: { w: Math.round(rect.width), h: Math.round(rect.height) },
        nearbyText: nearbyText.slice(0, 100),
        pathCount,
        rect,
      });
    }
  }

  return qrCandidates;
}

// Capture a specific region of the page as base64 image
function captureRegion(rect) {
  try {
    const canvas = document.createElement('canvas');
    const scale = window.devicePixelRatio || 1;
    canvas.width = rect.width * scale;
    canvas.height = rect.height * scale;
    // We can't directly capture a region from content script,
    // but we can return the rect for the background script to handle via CDP
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      devicePixelRatio: scale
    };
  } catch (e) {
    return null;
  }
}

function handleDetectQR() {
  const qrs = detectQRCodes();
  return {
    found: qrs.length > 0,
    count: qrs.length,
    qrcodes: qrs.map(qr => ({
      type: qr.type,
      src: qr.src || null,
      dataUrl: qr.dataUrl || null,
      tainted: qr.tainted || false,
      size: qr.size,
      nearbyText: qr.nearbyText || qr.alt || '',
      captureRect: qr.rect ? captureRegion(qr.rect) : null,
    }))
  };
}

// ─── Message router ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const { action, params } = msg;
  const handlers = {
    get_hint_map:  () => generateHintMap(params),
    click:         () => handleClick(params),
    type:          () => handleType(params),
    scroll:        () => handleScroll(params),
    extract:       () => handleExtract(params),
    wait_for:      () => handleWaitFor(params),
    auto_dismiss:  () => ({ dismissed: autoDismiss() }),
    detect_qr:     () => handleDetectQR(),
  };
  const fn = handlers[action];
  if (!fn) { sendResponse({ error: `Unknown: ${action}` }); return true; }
  Promise.resolve(fn()).then(sendResponse).catch(e => sendResponse({ error: e.message }));
  return true;
});

console.log('[Aether] v0.2 loaded on', location.href);
