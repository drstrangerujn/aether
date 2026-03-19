/**
 * Aether - Content Script
 *
 * Runs in every page. Handles:
 * 1. Hint Map generation (page perception layer)
 * 2. Element interaction (click, type, scroll)
 * 3. Content extraction
 * 4. Smart waiting
 */

// ─── Hint Map Generator ────────────────────────────────────────────────────

function generateHintMap(options = {}) {
  const detailLevel = options.detail_level || 'standard'; // 'minimal', 'standard', 'full'

  const map = {
    url: window.location.href,
    title: document.title,
    timestamp: Date.now(),
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      totalHeight: document.documentElement.scrollHeight
    },
    interactables: [],
    content: {},
    state: {}
  };

  // ─── Collect interactable elements ───
  const selectors = [
    'a[href]',
    'button',
    'input',
    'textarea',
    'select',
    '[role="button"]',
    '[role="link"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[onclick]',
    '[contenteditable="true"]',
    'summary',
    'details',
    '[tabindex]'
  ];

  const elements = document.querySelectorAll(selectors.join(','));
  let hintId = 0;

  elements.forEach(el => {
    // Skip hidden elements
    if (!isVisible(el)) return;

    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const hint = {
      id: `h${hintId++}`,
      tag: el.tagName.toLowerCase(),
      type: getElementType(el),
      text: getElementText(el).slice(0, 100),
      position: {
        x: Math.round(rect.x + rect.width / 2),
        y: Math.round(rect.y + rect.height / 2)
      }
    };

    // Add element-specific info
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      hint.inputType = el.type || 'text';
      hint.placeholder = el.placeholder || '';
      hint.value = el.value || '';
      hint.name = el.name || '';
    }
    if (el.tagName === 'A') {
      hint.href = el.href || '';
    }
    if (el.tagName === 'SELECT') {
      hint.options = Array.from(el.options).map(o => ({
        text: o.text,
        value: o.value,
        selected: o.selected
      }));
    }

    // Add aria labels
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) hint.ariaLabel = ariaLabel;

    // Store reference for later interaction
    el.dataset.aetherId = hint.id;

    map.interactables.push(hint);
  });

  // ─── Page content summary ───
  if (detailLevel !== 'minimal') {
    map.content = {
      headings: getHeadings(),
      mainText: getMainText(detailLevel === 'full' ? 2000 : 500),
      forms: getForms(),
      images: getImages()
    };
  }

  // ─── Page state ───
  map.state = {
    hasPopup: detectPopups(),
    isLoading: document.readyState !== 'complete',
    hasLogin: detectLoginForm(),
    hasCaptcha: detectCaptcha()
  };

  return map;
}

// ─── Element helpers ───────────────────────────────────────────────────────

function isVisible(el) {
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function getElementType(el) {
  const tag = el.tagName.toLowerCase();
  if (tag === 'a') return 'link';
  if (tag === 'button' || el.getAttribute('role') === 'button') return 'button';
  if (tag === 'input') {
    const t = (el.type || 'text').toLowerCase();
    if (t === 'submit') return 'submit';
    if (t === 'checkbox') return 'checkbox';
    if (t === 'radio') return 'radio';
    return 'input';
  }
  if (tag === 'textarea') return 'textarea';
  if (tag === 'select') return 'select';
  if (el.getAttribute('role') === 'tab') return 'tab';
  if (el.getAttribute('role') === 'menuitem') return 'menuitem';
  if (el.getAttribute('contenteditable') === 'true') return 'editable';
  return 'interactive';
}

function getElementText(el) {
  // Prefer aria-label, then innerText, then value
  return (
    el.getAttribute('aria-label') ||
    el.innerText ||
    el.value ||
    el.title ||
    el.alt ||
    ''
  ).trim().replace(/\s+/g, ' ');
}

function getHeadings() {
  return Array.from(document.querySelectorAll('h1, h2, h3')).map(h => ({
    level: parseInt(h.tagName[1]),
    text: h.innerText.trim().slice(0, 200)
  })).slice(0, 20);
}

function getMainText(maxLength) {
  // Try to find main content area
  const main = document.querySelector('main, [role="main"], article, .content, #content');
  const source = main || document.body;
  const text = source.innerText || '';
  return text.trim().slice(0, maxLength);
}

function getForms() {
  return Array.from(document.querySelectorAll('form')).map(f => ({
    action: f.action || '',
    method: f.method || 'GET',
    fields: Array.from(f.elements)
      .filter(el => el.tagName !== 'BUTTON' && el.type !== 'hidden')
      .map(el => ({
        name: el.name || '',
        type: el.type || 'text',
        placeholder: el.placeholder || '',
        required: el.required || false
      }))
      .slice(0, 20)
  })).slice(0, 5);
}

function getImages() {
  return Array.from(document.querySelectorAll('img[alt]'))
    .filter(img => img.width > 50 && img.height > 50)
    .map(img => ({
      alt: img.alt.slice(0, 100),
      src: img.src
    }))
    .slice(0, 10);
}

function detectPopups() {
  // Check for common modal/popup patterns
  const modals = document.querySelectorAll(
    '[role="dialog"], .modal, .popup, .overlay, [class*="modal"], [class*="dialog"]'
  );
  return Array.from(modals).some(m => isVisible(m));
}

function detectLoginForm() {
  const passwordInputs = document.querySelectorAll('input[type="password"]');
  return passwordInputs.length > 0;
}

function detectCaptcha() {
  const captchaSelectors = [
    'iframe[src*="recaptcha"]',
    'iframe[src*="captcha"]',
    '.g-recaptcha',
    '#captcha',
    '[class*="captcha"]',
    'iframe[src*="challenge"]'
  ];
  return document.querySelectorAll(captchaSelectors.join(',')).length > 0;
}

// ─── Element finder by hint ID or text ─────────────────────────────────────

function findElement(params) {
  // By hint ID
  if (params.hint_id) {
    const el = document.querySelector(`[data-aether-id="${params.hint_id}"]`);
    if (el) return el;
  }

  // By text content
  if (params.text) {
    const text = params.text.toLowerCase();

    // Try buttons and links first
    const candidates = document.querySelectorAll('a, button, input[type="submit"], [role="button"]');
    for (const el of candidates) {
      if (isVisible(el) && getElementText(el).toLowerCase().includes(text)) {
        return el;
      }
    }

    // Then try all interactables
    const allInteractable = document.querySelectorAll(
      'a, button, input, textarea, select, [role="button"], [onclick]'
    );
    for (const el of allInteractable) {
      if (isVisible(el) && getElementText(el).toLowerCase().includes(text)) {
        return el;
      }
    }
  }

  // By CSS selector
  if (params.selector) {
    return document.querySelector(params.selector);
  }

  return null;
}

// ─── Action handlers ───────────────────────────────────────────────────────

function handleClick(params) {
  const el = findElement(params);
  if (!el) {
    return { success: false, error: `Element not found: ${JSON.stringify(params)}` };
  }

  // Scroll into view first
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Small delay then click
  return new Promise(resolve => {
    setTimeout(() => {
      el.click();
      resolve({
        success: true,
        clicked: {
          tag: el.tagName.toLowerCase(),
          text: getElementText(el).slice(0, 100),
          href: el.href || null
        }
      });
    }, 200);
  });
}

function handleType(params) {
  const el = findElement(params);
  if (!el) {
    return { success: false, error: `Element not found: ${JSON.stringify(params)}` };
  }

  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.focus();

  // Clear existing value if requested
  if (params.clear !== false) {
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Type character by character for better compatibility
  const text = params.text || '';
  el.value = text;

  // Dispatch events to trigger frameworks (React, Vue, etc.)
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));

  // If we should press Enter after typing
  if (params.pressEnter) {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', keyCode: 13, bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true }));
  }

  return {
    success: true,
    typed: {
      tag: el.tagName.toLowerCase(),
      name: el.name || '',
      value: el.value
    }
  };
}

function handleScroll(params) {
  const direction = params.direction || 'down';
  const amount = params.amount || 500;

  switch (direction) {
    case 'down': window.scrollBy(0, amount); break;
    case 'up': window.scrollBy(0, -amount); break;
    case 'left': window.scrollBy(-amount, 0); break;
    case 'right': window.scrollBy(amount, 0); break;
    case 'top': window.scrollTo(0, 0); break;
    case 'bottom': window.scrollTo(0, document.documentElement.scrollHeight); break;
  }

  return {
    success: true,
    position: {
      x: window.scrollX,
      y: window.scrollY,
      maxY: document.documentElement.scrollHeight - window.innerHeight
    }
  };
}

function handleExtract(params) {
  if (params.selector) {
    const el = document.querySelector(params.selector);
    if (!el) return { success: false, error: `Selector not found: ${params.selector}` };
    return { success: true, text: el.innerText.trim(), html: el.innerHTML };
  }

  if (params.hint_id) {
    const el = document.querySelector(`[data-aether-id="${params.hint_id}"]`);
    if (!el) return { success: false, error: `Hint ID not found: ${params.hint_id}` };
    return { success: true, text: el.innerText.trim(), html: el.innerHTML };
  }

  // Extract all main content
  return {
    success: true,
    text: getMainText(5000),
    title: document.title,
    url: window.location.href
  };
}

function handleWaitFor(params) {
  const timeout = params.timeout || 10000;
  const interval = 200;
  const startTime = Date.now();

  return new Promise((resolve) => {
    function check() {
      // Check for element existence
      if (params.selector) {
        const el = document.querySelector(params.selector);
        if (el && isVisible(el)) {
          return resolve({ success: true, waited: Date.now() - startTime });
        }
      }

      // Check for text content
      if (params.text) {
        if (document.body.innerText.includes(params.text)) {
          return resolve({ success: true, waited: Date.now() - startTime });
        }
      }

      // Check for URL change
      if (params.url) {
        if (window.location.href.includes(params.url)) {
          return resolve({ success: true, waited: Date.now() - startTime });
        }
      }

      // Check for page load
      if (params.condition === 'loaded') {
        if (document.readyState === 'complete') {
          return resolve({ success: true, waited: Date.now() - startTime });
        }
      }

      // Timeout
      if (Date.now() - startTime > timeout) {
        return resolve({ success: false, error: `Timeout after ${timeout}ms`, waited: timeout });
      }

      setTimeout(check, interval);
    }

    check();
  });
}

// ─── Message listener ──────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const { action, params } = msg;

  const handleAsync = async () => {
    switch (action) {
      case 'get_hint_map':
        return generateHintMap(params);
      case 'click':
        return await handleClick(params);
      case 'type':
        return handleType(params);
      case 'scroll':
        return handleScroll(params);
      case 'extract':
        return handleExtract(params);
      case 'wait_for':
        return await handleWaitFor(params);
      default:
        return { error: `Unknown action: ${action}` };
    }
  };

  handleAsync().then(sendResponse).catch(e => sendResponse({ error: e.message }));
  return true; // Keep message channel open for async
});

// ─── Ready signal ──────────────────────────────────────────────────────────
console.log('[Aether] Content script loaded on', window.location.href);
