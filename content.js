/**
 * Runs on every page (including inside splitter iframes).
 *
 * Responsibilities:
 *   1. Toggle a `.stealth-adblock` class on <html> based on the adBlock
 *      setting. This enables the cosmetic CSS filter (content.css) which
 *      hides ad containers that URL blocking can't catch.
 *      Applied to all tabs — adBlock is a global feature.
 *
 *   2. Listen for postMessage from the splitter parent to toggle image
 *      hiding. Monochrome is applied at the iframe element level by the
 *      parent — no injection needed inside the iframe. Image-hide and
 *      monochrome are scoped to splitter only.
 *
 * Keyboard shortcuts (Alt+X / Alt+C / Alt+V) are handled by the native
 * chrome.commands API in background.js.
 */
(function () {
  const TAG = '__stealthSplit';

  // ----------------------------------------------------------------
  // Storage-driven globals: cosmetic ad blocking + global monochrome
  // ----------------------------------------------------------------
  function applyAdBlock(enabled) {
    const html = document.documentElement;
    if (!html) return;
    html.classList.toggle('stealth-adblock', !!enabled);
  }

  function applyMonochrome(enabled) {
    const html = document.documentElement;
    if (!html) return;
    html.classList.toggle('stealth-monochrome', !!enabled);
  }

  try {
    chrome.storage.local.get(['adBlock', 'globalMonochrome'], (st) => {
      // adBlock defaults to true if unset (matches background DEFAULTS)
      applyAdBlock(st.adBlock !== false);
      applyMonochrome(!!st.globalMonochrome);
    });
  } catch (_) { /* extension context invalidated — ignore */ }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if ('adBlock' in changes) applyAdBlock(!!changes.adBlock.newValue);
      if ('globalMonochrome' in changes) applyMonochrome(!!changes.globalMonochrome.newValue);
    });
  } catch (_) { /* ignore */ }

  // ----------------------------------------------------------------
  // Image hiding — only when parent splitter sends an apply message
  // ----------------------------------------------------------------
  function applyHideImages(value) {
    const html = document.documentElement;
    if (!html) return;
    html.classList.toggle('stealth-hide-images', !!value);
  }

  // ----------------------------------------------------------------
  // Keep new-tab navigation inside the current pane.
  // Activated only after we know we're inside the splitter (handshake).
  // ----------------------------------------------------------------
  let insideSplitter = false;

  function isNewTabTarget(t) {
    if (!t) return false;
    const v = String(t).toLowerCase();
    return v === '_blank' || v === '_new';
  }

  function navigateHere(url) {
    if (!url) return;
    try { window.location.href = url; } catch (_) { /* ignore */ }
  }

  function installInterceptors() {
    if (insideSplitter) return;
    insideSplitter = true;

    // <a target="_blank"> clicks
    document.addEventListener('click', (e) => {
      if (e.defaultPrevented) return;
      const a = e.target && e.target.closest && e.target.closest('a[href]');
      if (!a) return;
      if (isNewTabTarget(a.getAttribute('target'))) {
        e.preventDefault();
        e.stopPropagation();
        navigateHere(a.href);
      }
    }, true);

    // Middle-click (button === 1) on links → also opens a new tab by default
    document.addEventListener('auxclick', (e) => {
      if (e.button !== 1) return;
      const a = e.target && e.target.closest && e.target.closest('a[href]');
      if (!a) return;
      e.preventDefault();
      e.stopPropagation();
      navigateHere(a.href);
    }, true);

    // <form target="_blank"> submit → rewrite to same-frame
    document.addEventListener('submit', (e) => {
      const form = e.target;
      if (form && isNewTabTarget(form.target)) {
        form.target = '_self';
      }
    }, true);

    // Override window.open in the page's main world via injected <script>.
    // Content scripts run in an isolated world, so we must inject inline to
    // affect the page's own JavaScript calls.
    try {
      const code = '(function(){' +
        'var _open=window.open;' +
        'window.open=function(url){' +
          'if(url&&typeof url==="string"){' +
            'try{window.location.href=url;}catch(e){}' +
            'return null;' +
          '}' +
          'return _open.apply(this,arguments);' +
        '};' +
      '})();';
      const s = document.createElement('script');
      s.textContent = code;
      (document.head || document.documentElement || document).appendChild(s);
      s.remove();
    } catch (_) { /* ignore — CSP might still block in rare cases */ }
  }

  window.addEventListener('message', (e) => {
    const data = e.data;
    if (!data || data[TAG] !== true) return;
    // Any tagged message from the parent means we're in the splitter.
    installInterceptors();
    if (data.type === 'apply') {
      applyHideImages(data.hideImages);
    }
  });

  function announceReady() {
    if (window.parent && window.parent !== window) {
      try {
        window.parent.postMessage({ [TAG]: true, type: 'ready' }, '*');
      } catch (_) { /* ignore */ }
    }
  }
  announceReady();
  document.addEventListener('DOMContentLoaded', announceReady);
})();
