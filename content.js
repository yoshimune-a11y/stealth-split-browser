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
  // The splitter sets this as each pane iframe's `name` attribute. Because
  // window.name is readable synchronously at document_start (and persists
  // across same-frame navigations), we can detect "I'm a splitter pane" and
  // install the navigation interceptors before the page's own scripts run.
  const PANE_NAME = '__stealthSplitPane';

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

  function navigateHere(url) {
    if (!url) return;
    try { window.location.href = url; } catch (_) { /* ignore */ }
  }

  // Read the document's <base target="..."> if present — anchors / forms
  // without an explicit target attribute inherit this.
  function getBaseTarget() {
    const base = document.head && document.head.querySelector('base[target]');
    return ((base && base.getAttribute('target')) || '').toLowerCase();
  }

  // Anything that's not "_self" (and not empty without a base override)
  // would take navigation out of the current frame — including _blank,
  // _new, _top, _parent, named windows, and inherited base targets.
  function divertsOutOfFrame(explicitTarget) {
    const t = (explicitTarget || '').toLowerCase();
    if (t === '_self') return false;
    if (t) return true; // _blank, _top, _parent, named
    const base = getBaseTarget();
    return !!base && base !== '_self';
  }

  function installInterceptors() {
    if (insideSplitter) return;
    insideSplitter = true;

    // Resolve a clicked <a> to the URL we should load in-pane, or null if we
    // should leave it to the page. We divert when the link's target would
    // leave the frame (_blank/_top/etc.) OR the destination is cross-origin
    // (almost always a "leave this site" link, e.g. a Google result — never
    // SPA-internal, so navigating the iframe ourselves is safe).
    function resolveDivertTarget(a) {
      if (!a) return null;
      const href = a.getAttribute('href');
      if (!href || href.startsWith('#') || /^javascript:/i.test(href)) return null;
      let dest;
      try { dest = new URL(a.href, document.baseURI); } catch (_) { return null; }
      if (dest.protocol !== 'http:' && dest.protocol !== 'https:') return null;
      const diverts =
        divertsOutOfFrame(a.getAttribute('target')) || dest.origin !== location.origin;
      return diverts ? dest.href : null;
    }

    // Some sites (notably Google search) navigate on pointerdown / mousedown
    // via delegated handlers and do `top.location = href` — which the sandbox
    // / cross-origin policy blocks, so the click silently does nothing. We
    // register in the CAPTURE phase and (thanks to the window.name early
    // install) before the page's own scripts run, then stopPropagation so
    // those handlers never see the event. We deliberately do NOT preventDefault
    // here, so the natural click still fires into our click handler below.
    function killEarly(e) {
      if (e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.button && e.button !== 0) return; // primary button only
      const a = e.target && e.target.closest && e.target.closest('a[href]');
      if (!a || !resolveDivertTarget(a)) return;
      e.stopPropagation();
    }
    document.addEventListener('pointerdown', killEarly, true);
    document.addEventListener('mousedown', killEarly, true);

    // Primary click on a diverting link → load it in this pane.
    document.addEventListener('click', (e) => {
      if (e.defaultPrevented) return;
      if (e.ctrlKey || e.metaKey || e.shiftKey) return; // user wants a new tab
      const a = e.target && e.target.closest && e.target.closest('a[href]');
      const url = resolveDivertTarget(a);
      if (!url) return;
      e.preventDefault();
      e.stopPropagation();
      navigateHere(url);
    }, true);

    // Middle-click on links is always a "new tab" gesture — divert into pane.
    document.addEventListener('auxclick', (e) => {
      if (e.button !== 1) return;
      const a = e.target && e.target.closest && e.target.closest('a[href]');
      if (!a) return;
      e.preventDefault();
      e.stopPropagation();
      navigateHere(a.href);
    }, true);

    // <form target="..."> that would diverge — rewrite to _self on submit.
    document.addEventListener('submit', (e) => {
      const form = e.target;
      if (!form) return;
      if (divertsOutOfFrame(form.getAttribute('target'))) {
        form.target = '_self';
      }
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

  // -------------------- Scroll position reporting ----------------------------
  // Throttled scroll reporter so the splitter knows where to restore to.
  let scrollReportTimer = null;
  function reportScroll() {
    if (window.parent === window) return;
    try {
      window.parent.postMessage({
        [TAG]: true,
        type: 'scroll',
        x: window.scrollX,
        y: window.scrollY
      }, '*');
    } catch (_) { /* ignore */ }
  }
  document.addEventListener('scroll', () => {
    if (scrollReportTimer) return;
    scrollReportTimer = setTimeout(() => {
      scrollReportTimer = null;
      reportScroll();
    }, 180);
  }, { passive: true, capture: true });

  // --------------- postMessage from parent splitter --------------------------
  window.addEventListener('message', (e) => {
    const data = e.data;
    if (!data || data[TAG] !== true) return;
    installInterceptors();
    if (data.type === 'apply') {
      applyHideImages(data.hideImages);
      paneMonoOn = !!data.monochrome;
      applyMonoState();
    } else if (data.type === 'restore-scroll') {
      try { window.scrollTo(data.x || 0, data.y || 0); } catch (_) {}
    } else if (data.type === 'snapshot-scroll') {
      // Bypass throttle — report current scroll immediately
      reportScroll();
    }
  });

  function postToParent(payload) {
    if (window.parent && window.parent !== window) {
      try { window.parent.postMessage(payload, '*'); } catch (_) {}
    }
  }

  function announceReady() {
    postToParent({ [TAG]: true, type: 'ready' });
  }
  function announceNavigated() {
    postToParent({ [TAG]: true, type: 'navigated', url: window.location.href });
  }

  announceReady();
  announceNavigated();
  document.addEventListener('DOMContentLoaded', () => {
    announceReady();
    announceNavigated();
  });

  // Same-document URL changes (SPA / hash) — best-effort tracking
  window.addEventListener('hashchange', announceNavigated);
  window.addEventListener('popstate', announceNavigated);

  // Early, synchronous install: if the parent tagged this iframe via its
  // name attribute, we're a splitter pane. Installing here — at document_start,
  // before any page script executes — lets our capture-phase listeners win the
  // race against the page's delegated pointerdown/mousedown navigation. The
  // postMessage handshake above still calls installInterceptors() as a fallback
  // (e.g. if the page overwrites window.name).
  if (window.name === PANE_NAME) installInterceptors();
})();
