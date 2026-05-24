/**
 * Runs on every page (including inside splitter iframes).
 *
 * Responsibilities:
 *   1. Toggle `.stealth-adblock` on <html> based on the adBlock storage flag
 *      (global feature, applies to all tabs).
 *   2. Toggle `.stealth-monochrome` on <html> based on EITHER the global
 *      monochrome flag (storage) OR a per-pane flag pushed from the splitter
 *      via postMessage. Apply the user-chosen text color as a CSS variable.
 *   3. Toggle `.stealth-hide-images` only when the splitter parent sends
 *      a postMessage `apply` event (scoped to splitter iframes only).
 *   4. Keep new-tab navigation inside the current pane (link clicks,
 *      middle-clicks, form submits, and window.open).
 *
 * Keyboard shortcuts are handled by the native chrome.commands API in
 * background.js, not here.
 */
(function () {
  const TAG = '__stealthSplit';

  // --------------------------- State -----------------------------------------
  let globalMonoOn = false;
  let paneMonoOn = false;
  let textColor = '#808080';

  function applyMonoState() {
    const html = document.documentElement;
    if (!html) return;
    html.style.setProperty('--stealth-text-color', textColor);
    html.classList.toggle('stealth-monochrome', globalMonoOn || paneMonoOn);
  }

  function applyAdBlock(enabled) {
    const html = document.documentElement;
    if (!html) return;
    html.classList.toggle('stealth-adblock', !!enabled);
  }

  function applyHideImages(value) {
    const html = document.documentElement;
    if (!html) return;
    html.classList.toggle('stealth-hide-images', !!value);
  }

  // -------------------- Storage-driven globals -------------------------------
  try {
    chrome.storage.local.get(['adBlock', 'globalMonochrome', 'monoTextColor'], (st) => {
      applyAdBlock(st.adBlock !== false);
      globalMonoOn = !!st.globalMonochrome;
      if (st.monoTextColor) textColor = st.monoTextColor;
      applyMonoState();
    });
  } catch (_) { /* extension context invalidated — ignore */ }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if ('adBlock' in changes) applyAdBlock(!!changes.adBlock.newValue);
      if ('globalMonochrome' in changes) {
        globalMonoOn = !!changes.globalMonochrome.newValue;
        applyMonoState();
      }
      if ('monoTextColor' in changes) {
        textColor = changes.monoTextColor.newValue || '#808080';
        applyMonoState();
      }
    });
  } catch (_) { /* ignore */ }

  // -------------------- New-tab link interception ----------------------------
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

    document.addEventListener('auxclick', (e) => {
      if (e.button !== 1) return;
      const a = e.target && e.target.closest && e.target.closest('a[href]');
      if (!a) return;
      e.preventDefault();
      e.stopPropagation();
      navigateHere(a.href);
    }, true);

    document.addEventListener('submit', (e) => {
      const form = e.target;
      if (form && isNewTabTarget(form.target)) form.target = '_self';
    }, true);

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
    } catch (_) { /* ignore */ }
  }

  // --------------- postMessage from parent splitter --------------------------
  window.addEventListener('message', (e) => {
    const data = e.data;
    if (!data || data[TAG] !== true) return;
    installInterceptors();
    if (data.type === 'apply') {
      applyHideImages(data.hideImages);
      paneMonoOn = !!data.monochrome;
      applyMonoState();
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
