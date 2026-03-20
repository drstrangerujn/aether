/**
 * Aether Injected Script — page-context logic for Playwright injection.
 * Hint Map v2 · Self-Healing · Auto Dismiss · QR Detection
 */
(function () {
  if (window.__aether) return;

  // ── Helpers ───────────────────────────────────────────────────────────────

  function isVisible(el) {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  const inViewport = r => r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  const center = r => ({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });

  const TYPE_MAP = { A: 'link', BUTTON: 'button', TEXTAREA: 'textarea', SELECT: 'select', SUMMARY: 'toggle' };

  function getType(el) {
    if (TYPE_MAP[el.tagName]) return TYPE_MAP[el.tagName];
    const role = el.getAttribute('role');
    if (role === 'button') return 'button';
    if (role === 'tab') return 'tab';
    if (role === 'menuitem') return 'menuitem';
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

  // ── Region detection ──────────────────────────────────────────────────────

  function detectRegion(el) {
    let node = el;
    for (let i = 0; i < 8 && node && node !== document.body; i++) {
      const tag = node.tagName?.toLowerCase();
      const role = node.getAttribute?.('role');
      const cls = (node.className || '').toString().toLowerCase();
      const id = (node.id || '').toLowerCase();

      if (role === 'dialog' || role === 'alertdialog' || cls.includes('modal') || cls.includes('dialog')) return 'modal';
      if (tag === 'nav' || role === 'navigation' || cls.includes('nav') || cls.includes('menu')) return 'nav';
      if (tag === 'main' || role === 'main') return 'main';
      if (tag === 'aside' || role === 'complementary' || cls.includes('sidebar')) return 'sidebar';
      if (tag === 'footer' || role === 'contentinfo' || cls.includes('footer')) return 'footer';
      if (tag === 'header' || role === 'banner' || cls.includes('header')) return 'header';
      if (tag === 'form' || id.includes('search') || cls.includes('search')) return 'search';

      node = node.parentElement;
    }
    return 'main';
  }

  // ── Semantics ─────────────────────────────────────────────────────────────

  const SEMANTIC_PATTERNS = {
    price:   /[\$\¥\€\£]\s?\d[\d,]*\.?\d*/g,
    date:    /\d{4}[-\/]\d{1,2}[-\/]\d{1,2}/g,
    email:   /[\w.-]+@[\w.-]+\.\w+/g,
    count:   /\b(\d{1,3}(?:,\d{3})*)\s*(?:items?|results?|reviews?|ratings?|件|条|个)\b/gi,
    percent: /\d+\.?\d*\s?%/g,
  };

  function extractSemantics(text) {
    const found = {};
    for (const [key, re] of Object.entries(SEMANTIC_PATTERNS)) {
      const m = text.match(re);
      if (m?.length) found[key] = [...new Set(m)].slice(0, 5);
    }
    return Object.keys(found).length ? found : undefined;
  }

  function extractTables() {
    return Array.from(document.querySelectorAll('table')).slice(0, 3).map(t => {
      const headers = Array.from(t.querySelectorAll('th')).map(th => th.innerText.trim()).filter(Boolean);
      const rows = Array.from(t.querySelectorAll('tbody tr')).slice(0, 10).map(
        tr => Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim().slice(0, 80))
      );
      return (headers.length || rows.length) ? { headers, rows, rowCount: t.querySelectorAll('tr').length } : null;
    }).filter(Boolean);
  }

  // ── Priority ──────────────────────────────────────────────────────────────

  function scorePriority(el, rect) {
    let s = 50;
    if (inViewport(rect)) s += 30;
    if (rect.width > 100 && rect.height > 30) s += 10;
    if (el.tagName === 'BUTTON' || el.type === 'submit') s += 10;
    if (detectRegion(el) === 'modal') s += 20;
    if (el.getAttribute('aria-label')) s += 5;
    if (el.disabled) s -= 40;
    return Math.min(100, Math.max(0, s));
  }

  // ── Page state detectors ──────────────────────────────────────────────────

  const detect = {
    popup: () => Array.from(document.querySelectorAll('[role="dialog"], .modal, .popup, .overlay, [class*="modal"], [class*="dialog"]')).some(isVisible),
    login: () => document.querySelectorAll('input[type="password"]').length > 0,
    captcha: () => document.querySelectorAll('iframe[src*="recaptcha"], iframe[src*="captcha"], .g-recaptcha, [class*="captcha"]').length > 0,
    cookieBanner: () => Array.from(document.querySelectorAll('[class*="cookie"], [id*="cookie"], [class*="consent"], [id*="consent"]')).some(isVisible),
  };

  // ── Auto Dismiss ──────────────────────────────────────────────────────────

  const DISMISS_TEXTS = [
    'accept all', 'accept cookies', 'accept', 'agree', 'allow all', 'allow cookies',
    'got it', 'i agree', 'i understand', 'ok', 'okay', 'continue',
    'dismiss', 'close', 'no thanks', 'not now', 'maybe later', 'skip',
    'reject all', 'reject', 'deny', 'decline',
    '同意', '接受', '全部接受', '知道了', '关闭', '我同意', '不再提醒',
    '好的', '确定', '跳过', '以后再说', '暂不',
  ];

  const DISMISS_SELECTORS = [
    '[class*="cookie"]', '[id*="cookie"]', '[class*="consent"]', '[id*="consent"]',
    '[class*="gdpr"]', '[id*="gdpr"]', '[class*="notice"]', '[class*="newsletter"]',
    '[role="dialog"]', '[role="alertdialog"]', '.modal', '.popup', '.overlay',
  ];

  function autoDismiss() {
    const dismissed = [];

    for (const sel of DISMISS_SELECTORS) {
      for (const container of document.querySelectorAll(sel)) {
        if (!isVisible(container)) continue;

        // Try matching button text first
        let found = false;
        for (const btn of container.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]')) {
          const text = getText(btn).toLowerCase();
          const match = DISMISS_TEXTS.find(d => text.includes(d));
          if (match) {
            btn.click();
            dismissed.push({ text: getText(btn), matched: match });
            found = true;
            break;
          }
        }

        // Fallback: close/X button (per-container, not global)
        if (!found) {
          const closeBtn = container.querySelector(
            '[aria-label="Close"], [aria-label="close"], [aria-label="关闭"], .close, .close-btn, [class*="close"]'
          );
          if (closeBtn && isVisible(closeBtn)) {
            closeBtn.click();
            dismissed.push({ text: 'X', matched: 'close-button' });
          }
        }
      }
    }

    return dismissed;
  }

  // ── QR Detection ──────────────────────────────────────────────────────────

  function detectQR() {
    const results = [];
    const QR_RE = /qr|二维码|扫码|扫一扫|scan|微信|wechat|alipay|支付宝|钉钉/i;

    // Images
    for (const img of document.querySelectorAll('img[src*="qr"], img[src*="QR"], img[src*="qrcode"], img[class*="qr"], img[id*="qr"], img[alt*="二维码"], img[alt*="QR"], img[alt*="扫码"]')) {
      if (!isVisible(img) || img.width < 50 || img.height < 50) continue;
      results.push({ type: 'img', src: img.src, size: { w: img.width, h: img.height } });
    }

    // Canvas (square-ish, near QR text or large enough)
    for (const canvas of document.querySelectorAll('canvas')) {
      if (!isVisible(canvas)) continue;
      const r = canvas.getBoundingClientRect();
      if (r.width < 80 || r.height < 80 || Math.abs(r.width - r.height) > r.width * 0.2) continue;
      const nearbyText = (canvas.parentElement?.innerText || '').slice(0, 100);
      if (!QR_RE.test(nearbyText) && r.width <= 120) continue;
      try { results.push({ type: 'canvas', dataUrl: canvas.toDataURL('image/png'), size: { w: Math.round(r.width), h: Math.round(r.height) } }); }
      catch { results.push({ type: 'canvas', tainted: true, size: { w: Math.round(r.width), h: Math.round(r.height) } }); }
    }

    // SVG (many rects/paths = likely QR)
    for (const svg of document.querySelectorAll('svg')) {
      if (!isVisible(svg)) continue;
      const r = svg.getBoundingClientRect();
      if (r.width < 80 || r.height < 80 || Math.abs(r.width - r.height) > r.width * 0.2) continue;
      if (svg.querySelectorAll('rect, path').length > 50) {
        results.push({ type: 'svg', size: { w: Math.round(r.width), h: Math.round(r.height) } });
      }
    }

    return { found: results.length > 0, count: results.length, qrcodes: results };
  }

  // ── Self-Healing ──────────────────────────────────────────────────────────

  const signatures = new Map();

  function saveSignature(id, el) {
    signatures.set(id, {
      text: getText(el).toLowerCase(), type: getType(el), tag: el.tagName.toLowerCase(),
      region: detectRegion(el), name: el.name || null, href: el.href || null,
      aria: el.getAttribute('aria-label') || null, placeholder: el.placeholder || null,
    });
  }

  function similarity(sig, el) {
    let s = 0;
    const t = getText(el).toLowerCase();
    if (sig.text && t) { if (t === sig.text) s += 40; else if (t.includes(sig.text) || sig.text.includes(t)) s += 25; }
    if (getType(el) === sig.type) s += 20;
    if (el.tagName.toLowerCase() === sig.tag) s += 10;
    if (detectRegion(el) === sig.region) s += 10;
    if (sig.name && el.name === sig.name) s += 10;
    if (sig.placeholder && el.placeholder === sig.placeholder) s += 10;
    if (sig.aria && el.getAttribute('aria-label') === sig.aria) s += 10;
    if (sig.href && el.href && el.href.includes(sig.href.split('?')[0])) s += 10;
    return s;
  }

  function findElement(params) {
    // By hint_id (with self-healing fallback)
    if (params.hint_id) {
      const el = document.querySelector(`[data-aether-id="${params.hint_id}"]`);
      if (el && isVisible(el)) return { el, healed: false };

      const sig = signatures.get(params.hint_id);
      if (sig) {
        let best = null, bestScore = 0;
        for (const c of document.querySelectorAll('a, button, input, textarea, select, [role="button"], [onclick], [contenteditable]')) {
          if (!isVisible(c)) continue;
          const sc = similarity(sig, c);
          if (sc > bestScore) { bestScore = sc; best = c; }
        }
        if (best && bestScore >= 30) return { el: best, healed: true, score: bestScore, originalId: params.hint_id };
      }
    }

    // By visible text
    if (params.text) {
      const needle = params.text.toLowerCase();
      for (const el of document.querySelectorAll('a, button, input, textarea, select, [role="button"], [onclick]')) {
        if (isVisible(el) && getText(el).toLowerCase().includes(needle)) return { el, healed: false };
      }
    }

    // By CSS selector
    if (params.selector) {
      const el = document.querySelector(params.selector);
      if (el) return { el, healed: false };
    }

    return { el: null, healed: false };
  }

  // ── Hint Map ──────────────────────────────────────────────────────────────

  function generateHintMap(opts = {}) {
    const detail = opts.detail_level || 'standard';

    let dismissed = [];
    if (opts.auto_dismiss !== false) dismissed = autoDismiss();

    const map = {
      url: location.href, title: document.title, ts: Date.now(),
      viewport: { w: innerWidth, h: innerHeight, scrollX, scrollY, totalH: document.documentElement.scrollHeight },
      state: { loading: document.readyState !== 'complete', popup: detect.popup(), login: detect.login(), captcha: detect.captcha(), cookieBanner: detect.cookieBanner() },
      dismissed,
      interactables: [],
    };

    const seen = new Set();
    let hid = 0;

    for (const el of document.querySelectorAll('a[href], button, input, textarea, select, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [onclick], [contenteditable="true"], summary, [tabindex]:not([tabindex="-1"])')) {
      if (!isVisible(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) continue;
      const pk = `${Math.round(rect.x)},${Math.round(rect.y)}`;
      if (seen.has(pk)) continue;
      seen.add(pk);

      const hint = {
        id: `h${hid++}`, type: getType(el), text: getText(el),
        region: detectRegion(el), priority: scorePriority(el, rect),
        pos: center(rect), inView: inViewport(rect),
      };

      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        hint.inputType = el.type || 'text';
        if (el.placeholder) hint.placeholder = el.placeholder;
        if (el.value) hint.value = el.value;
      }
      if (el.tagName === 'A' && el.href) hint.href = el.href;
      if (el.tagName === 'SELECT') hint.options = Array.from(el.options).map(o => ({ text: o.text, value: o.value, selected: o.selected }));
      if (el.disabled) hint.disabled = true;
      const aria = el.getAttribute('aria-label');
      if (aria) hint.aria = aria;

      el.dataset.aetherId = hint.id;
      saveSignature(hint.id, el);
      map.interactables.push(hint);
    }

    map.interactables.sort((a, b) => b.priority - a.priority);

    if (detail !== 'minimal') {
      const mainEl = document.querySelector('main, [role="main"], article, .content, #content') || document.body;
      const mainText = (mainEl.innerText || '').trim();
      map.content = {
        headings: Array.from(document.querySelectorAll('h1,h2,h3')).slice(0, 20).map(h => ({ level: +h.tagName[1], text: h.innerText.trim().slice(0, 200) })),
        mainText: mainText.slice(0, detail === 'full' ? 3000 : 600),
        semantics: extractSemantics(mainText.slice(0, 5000)),
        tables: extractTables(),
        forms: Array.from(document.querySelectorAll('form')).slice(0, 5).map(f => ({
          action: f.action, method: f.method,
          fields: Array.from(f.elements).filter(e => e.tagName !== 'BUTTON' && e.type !== 'hidden').slice(0, 20)
            .map(e => ({ name: e.name, type: e.type, placeholder: e.placeholder, required: e.required }))
        })),
      };
    }

    const regions = [...new Set(map.interactables.map(h => h.region))];
    map.summary = `${map.interactables.length} elements across [${regions.join(', ')}]`
      + (map.state.popup ? ' ⚠️ popup' : '') + (map.state.captcha ? ' ⚠️ captcha' : '') + (map.state.cookieBanner ? ' 🍪 cookie' : '');

    return map;
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  function handleClick(params) {
    const { el, healed, score, originalId } = findElement(params);
    if (!el) return { success: false, error: `Not found: ${JSON.stringify(params)}` };
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.click();
    const r = { success: true, clicked: { tag: el.tagName.toLowerCase(), text: getText(el), href: el.href || null } };
    if (healed) r.healed = { originalId, confidence: score };
    return r;
  }

  function handleType(params) {
    const { el, healed, score, originalId } = findElement(params);
    if (!el) return { success: false, error: `Not found: ${JSON.stringify(params)}` };
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.focus();
    if (params.clear !== false) { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }
    el.value = params.text || '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    if (params.pressEnter) {
      const o = { key: 'Enter', keyCode: 13, bubbles: true };
      el.dispatchEvent(new KeyboardEvent('keydown', o));
      el.dispatchEvent(new KeyboardEvent('keyup', o));
    }
    const r = { success: true, typed: { tag: el.tagName.toLowerCase(), name: el.name, value: el.value } };
    if (healed) r.healed = { originalId, confidence: score };
    return r;
  }

  function handleScroll(params) {
    const d = params.direction || 'down', a = params.amount || 500;
    if (d === 'top') scrollTo(0, 0);
    else if (d === 'bottom') scrollTo(0, document.documentElement.scrollHeight);
    else { const m = { down: [0, a], up: [0, -a], left: [-a, 0], right: [a, 0] }; scrollBy(...(m[d] || [0, 0])); }
    return { success: true, pos: { x: scrollX, y: scrollY, maxY: document.documentElement.scrollHeight - innerHeight } };
  }

  function handleExtract(params) {
    if (params.hint_id || params.text || params.selector) {
      const { el } = params.selector ? { el: document.querySelector(params.selector) } : findElement(params);
      if (el) return { success: true, text: el.innerText.trim(), html: el.innerHTML };
      return { success: false, error: 'Not found' };
    }
    const main = document.querySelector('main, [role="main"], article') || document.body;
    return { success: true, text: main.innerText.trim().slice(0, 5000), title: document.title, url: location.href };
  }

  function handleWaitFor(params) {
    const timeout = params.timeout || 10000, start = Date.now();
    return new Promise(resolve => {
      (function check() {
        if (params.selector) { const el = document.querySelector(params.selector); if (el && isVisible(el)) return resolve({ success: true, waited: Date.now() - start }); }
        if (params.text && document.body.innerText.includes(params.text)) return resolve({ success: true, waited: Date.now() - start });
        if (params.url && location.href.includes(params.url)) return resolve({ success: true, waited: Date.now() - start });
        if (params.condition === 'loaded' && document.readyState === 'complete') return resolve({ success: true, waited: Date.now() - start });
        if (Date.now() - start > timeout) return resolve({ success: false, error: `Timeout (${timeout}ms)` });
        setTimeout(check, 200);
      })();
    });
  }

  // ── Public API ────────────────────────────────────────────────────────────

  window.__aether = { generateHintMap, handleClick, handleType, handleScroll, handleExtract, handleWaitFor, autoDismiss, detectQR };
})();
