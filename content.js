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

  window.addEventListener('message', (e) => {
    const data = e.data;
    if (!data || data[TAG] !== true) return;
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
