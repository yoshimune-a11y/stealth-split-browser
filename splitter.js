/**
 * splitter.js — controls the 2-pane in-tab browser.
 *
 * Responsibilities:
 *  - Persist & restore per-pane URL, hidden state, monochrome/hide-images flags,
 *    divider position, active side.
 *  - Track active pane via window-blur (iframe focus) + mousedown on pane chrome.
 *  - Apply monochrome locally as CSS `filter: grayscale(100%)` on the iframe.
 *  - Apply hide-images by posting messages to the iframe's content script.
 *  - Render bookmark bar; click loads into the active pane.
 *  - Handle Shift+C / Shift+V keydown when focus is on splitter chrome (the
 *    iframe variant is handled by content.js + background routing).
 */

const TAG = '__stealthSplit';
const STATE_KEY = 'splitterState';

const FALLBACK = {
  defaultLeftUrl: 'https://www.bing.com',
  defaultRightUrl: 'https://ja.wikipedia.org'
};

let state = {
  left:  { url: '', hidden: false, monochrome: false, hideImages: false },
  right: { url: '', hidden: false, monochrome: false, hideImages: false },
  leftPct: 50,
  active: 'left'
};

let bookmarks = [];
let frameReady = { left: false, right: false };

// Per-pane navigation history (in-memory, not persisted).
// Maintained because cross-origin iframes don't let us call
// contentWindow.history.back/forward.
const histories = {
  left:  { stack: [], index: -1 },
  right: { stack: [], index: -1 }
};

// Latest reported scroll position per pane (used to restore on unhide).
const paneScroll = {
  left:  { x: 0, y: 0 },
  right: { x: 0, y: 0 }
};

const $ = (id) => document.getElementById(id);

// ----------------------------- Utilities ------------------------------------

function normalizeUrl(input) {
  const s = (input || '').trim();
  if (!s) return '';
  // Already a fully qualified URL we accept
  if (/^(https?|ftp|file|about|data):/i.test(s)) return s;
  // Windows path: C:\foo\bar.pdf or C:/foo/bar.pdf
  if (/^[a-z]:[\\\/]/i.test(s)) {
    return 'file:///' + s.replace(/\\/g, '/');
  }
  // UNC path: \\server\share\file
  if (/^\\\\/.test(s)) {
    return 'file:' + s.replace(/\\/g, '/');
  }
  // Unix absolute path
  if (/^\//.test(s) && !/\s/.test(s)) {
    return 'file://' + s;
  }
  // Domain-like
  if (/^[\w.-]+\.[a-z]{2,}([\/?#].*)?$/i.test(s)) return 'https://' + s;
  return 'https://www.bing.com/search?q=' + encodeURIComponent(s);
}

function persist() {
  const toSave = {
    left:  { ...state.left },
    right: { ...state.right },
    leftPct: state.leftPct,
    active: state.active
  };
  chrome.storage.local.set({ [STATE_KEY]: toSave });
}

// ----------------------------- Rendering ------------------------------------

function applyLayout() {
  const leftPane = $('leftPane');
  const rightPane = $('rightPane');
  const divider = $('divider');

  const lH = state.left.hidden;
  const rH = state.right.hidden;

  leftPane.classList.toggle('hidden', lH);
  rightPane.classList.toggle('hidden', rH);
  leftPane.classList.toggle('full', !lH && rH);
  rightPane.classList.toggle('full', !rH && lH);
  divider.classList.toggle('hidden', lH || rH);

  if (!lH && !rH) {
    const pct = Math.max(10, Math.min(90, state.leftPct || 50));
    leftPane.style.flex = `0 0 ${pct}%`;
    rightPane.style.flex = `0 0 ${100 - pct}%`;
  } else {
    leftPane.style.flex = '';
    rightPane.style.flex = '';
  }
}

function pushIframeState(side) {
  if (!frameReady[side]) return; // will re-apply when ready msg arrives
  const frame = $(side + 'Frame');
  try {
    frame.contentWindow.postMessage({
      [TAG]: true,
      type: 'apply',
      hideImages: state[side].hideImages,
      monochrome: state[side].monochrome
    }, '*');
  } catch (_) { /* iframe might not be loaded yet */ }
}

function updateToggleButtons() {
  ['left', 'right'].forEach((side) => {
    document.querySelector(`.toggle.mono[data-side="${side}"]`)
      ?.classList.toggle('active', !!state[side].monochrome);
    document.querySelector(`.toggle.imgs[data-side="${side}"]`)
      ?.classList.toggle('active', !!state[side].hideImages);
  });
}

function updateActiveBorder() {
  document.querySelectorAll('.pane').forEach((p) => {
    p.classList.toggle('active', p.dataset.side === state.active);
  });
}

function renderBookmarks() {
  const list = $('bookmarks');
  list.innerHTML = '';
  if (!bookmarks.length) {
    const span = document.createElement('span');
    span.className = 'empty-hint';
    span.textContent = 'ブックマーク未登録 — ⚙ から追加';
    list.appendChild(span);
    return;
  }
  bookmarks.forEach((bm) => {
    const btn = document.createElement('button');
    btn.className = 'bookmark';
    btn.textContent = bm.title && bm.title.trim() ? bm.title : bm.url;
    btn.title = bm.url;
    btn.addEventListener('mousedown', (e) => e.preventDefault()); // don't steal focus
    btn.addEventListener('click', () => loadIntoActive(bm.url));
    list.appendChild(btn);
  });
}

// ----------------------------- Actions --------------------------------------

function setActive(side) {
  state.active = side;
  updateActiveBorder();
  persist();
}

function loadIntoActive(url) {
  const side = state.active;
  if (state[side].hidden) {
    state[side].hidden = false;
    applyLayout();
  }
  loadSide(side, url);
}

function loadSide(side, url) {
  const u = normalizeUrl(url);
  if (!u) return;
  state[side].url = u;
  $(side + 'Url').value = u;
  frameReady[side] = false;
  $(side + 'Frame').src = u;
  pushHistory(side, u);
  // Pane state (monochrome/hideImages) will be pushed when the iframe's
  // content script announces 'ready' (see the message listener below).
  persist();
}

function pushHistory(side, url) {
  const h = histories[side];
  // Skip if URL already matches current entry (e.g. reload)
  if (h.index >= 0 && h.stack[h.index] === url) return;
  // Drop any "forward" entries beyond current index
  h.stack = h.stack.slice(0, h.index + 1);
  h.stack.push(url);
  h.index = h.stack.length - 1;
  if (h.stack.length > 50) {
    h.stack.shift();
    h.index--;
  }
}

function goBack(side) {
  const h = histories[side];
  if (h.index <= 0) return;
  h.index--;
  navigateFromHistory(side, h.stack[h.index]);
}

function goForward(side) {
  const h = histories[side];
  if (h.index >= h.stack.length - 1) return;
  h.index++;
  navigateFromHistory(side, h.stack[h.index]);
}

function navigateFromHistory(side, url) {
  state[side].url = url;
  $(side + 'Url').value = url;
  frameReady[side] = false;
  $(side + 'Frame').src = url;
  persist();
}

function reloadSide(side) {
  const url = state[side].url;
  if (!url) return;
  const frame = $(side + 'Frame');
  // Same-origin pages allow contentWindow.location.reload(); for cross-origin
  // we fall back to bouncing through about:blank to force a fresh load.
  try {
    frame.contentWindow.location.reload();
  } catch (_) {
    frame.src = 'about:blank';
    setTimeout(() => { frame.src = url; }, 30);
  }
}

function restoreScroll(side) {
  const frame = $(side + 'Frame');
  if (!frame) return;
  try {
    frame.contentWindow.postMessage({
      [TAG]: true,
      type: 'restore-scroll',
      x: paneScroll[side].x,
      y: paneScroll[side].y
    }, '*');
  } catch (_) { /* iframe not ready */ }
}

function toggleHide(side, force) {
  const newVal = (typeof force === 'boolean') ? force : !state[side].hidden;
  const wasHidden = state[side].hidden;
  // About to hide: ask the iframe for an immediate scroll snapshot so we have
  // a fresh value (the throttled reporter may have a stale 180ms delay).
  if (!wasHidden && newVal) {
    const frame = $(side + 'Frame');
    try {
      frame.contentWindow.postMessage({ [TAG]: true, type: 'snapshot-scroll' }, '*');
    } catch (_) { /* ignore */ }
  }
  state[side].hidden = newVal;
  applyLayout();
  // If transitioning hidden → visible, restore scroll once the layout settles.
  // The iframe is re-flowed when its container resizes back to non-zero, which
  // can shift the visible scroll position; we push the saved value back.
  if (wasHidden && !newVal) {
    setTimeout(() => restoreScroll(side), 80);
    setTimeout(() => restoreScroll(side), 250); // belt-and-suspenders for slow reflows
  }
  persist();
}

function toggleMonochrome(side) {
  state[side].monochrome = !state[side].monochrome;
  pushIframeState(side);
  updateToggleButtons();
  persist();
}

function toggleHideImages(side) {
  state[side].hideImages = !state[side].hideImages;
  pushIframeState(side);
  updateToggleButtons();
  persist();
}

// ------------------------------ Bindings ------------------------------------

function bind() {
  ['left', 'right'].forEach((side) => {
    const input = $(side + 'Url');
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        loadSide(side, input.value);
      }
    });
  });

  document.querySelectorAll('.go').forEach((btn) => {
    btn.addEventListener('click', () => {
      const side = btn.dataset.side;
      loadSide(side, $(side + 'Url').value);
    });
  });

  document.querySelectorAll('.close').forEach((btn) => {
    btn.addEventListener('click', () => toggleHide(btn.dataset.side, true));
  });

  document.querySelectorAll('.toggle.mono').forEach((btn) => {
    btn.addEventListener('click', () => toggleMonochrome(btn.dataset.side));
  });
  document.querySelectorAll('.toggle.imgs').forEach((btn) => {
    btn.addEventListener('click', () => toggleHideImages(btn.dataset.side));
  });

  document.querySelectorAll('.nav').forEach((btn) => {
    btn.addEventListener('click', () => {
      const side = btn.dataset.side;
      const act = btn.dataset.act;
      if (act === 'back') goBack(side);
      else if (act === 'forward') goForward(side);
      else if (act === 'reload') reloadSide(side);
    });
  });

  // Active pane via clicking on pane chrome
  ['left', 'right'].forEach((side) => {
    $(side + 'Pane').addEventListener('mousedown', () => setActive(side), true);
  });

  // Active pane via iframe focus (parent window loses focus when iframe takes it)
  window.addEventListener('blur', () => {
    setTimeout(() => {
      const ae = document.activeElement;
      if (ae && ae.tagName === 'IFRAME') {
        setActive(ae.id === 'leftFrame' ? 'left' : 'right');
      }
    }, 0);
  });

  $('openOptions').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  initDivider();
  initIframeUrlSync();
}

function initDivider() {
  const divider = $('divider');
  const left = $('leftPane');
  const right = $('rightPane');

  divider.addEventListener('mousedown', () => {
    document.body.style.userSelect = 'none';
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:9998;cursor:ew-resize;';
    document.body.appendChild(overlay);

    function onMove(e) {
      const total = window.innerWidth;
      const pct = (e.clientX / total) * 100;
      const leftPct = Math.max(10, Math.min(90, pct));
      state.leftPct = leftPct;
      left.style.flex = `0 0 ${leftPct}%`;
      right.style.flex = `0 0 ${100 - leftPct}%`;
    }
    function onUp() {
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      overlay.remove();
      persist();
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

function initIframeUrlSync() {
  ['left', 'right'].forEach((side) => {
    const frame = $(side + 'Frame');
    frame.addEventListener('load', () => {
      try {
        const u = frame.contentWindow.location.href;
        if (u && u !== 'about:blank') {
          state[side].url = u;
          $(side + 'Url').value = u;
          persist();
        }
      } catch (e) { /* cross-origin — ignore */ }
    });
  });
}

// ----------------------- Iframe -> Parent messages --------------------------

function findSideForSource(source) {
  for (const side of ['left', 'right']) {
    const frame = $(side + 'Frame');
    if (frame && source === frame.contentWindow) return side;
  }
  return null;
}

function handleNavigated(side, url) {
  if (!url || url === 'about:blank') return;
  if (url !== state[side].url) {
    state[side].url = url;
    $(side + 'Url').value = url;
    persist();
  }
  // pushHistory dedupes internally against the current entry, so it's safe to
  // call unconditionally and lets us catch same-origin internal navigations
  // that initIframeUrlSync also picked up.
  pushHistory(side, url);
}

window.addEventListener('message', (e) => {
  const data = e.data;
  if (!data || data[TAG] !== true) return;
  const side = findSideForSource(e.source);
  if (!side) return;

  switch (data.type) {
    case 'ready':
      frameReady[side] = true;
      pushIframeState(side);
      break;
    case 'navigated':
      handleNavigated(side, data.url);
      break;
    case 'scroll':
      paneScroll[side] = { x: data.x || 0, y: data.y || 0 };
      break;
  }
});

// -------------------------- Background commands -----------------------------

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== 'splitter-command') return;
  // Only the visible splitter tab should react (multiple splitter tabs may exist)
  if (document.visibilityState !== 'visible') return;
  if (msg.command === 'toggle-left') toggleHide('left');
  else if (msg.command === 'toggle-right') toggleHide('right');
});

// (Shortcut keys are handled by chrome.commands → background → message above.)

// ---------------------------- Storage sync ----------------------------------

function applyGlobalMonochrome(enabled, textColor) {
  if (textColor) {
    document.documentElement.style.setProperty('--stealth-text-color', textColor);
  }
  document.documentElement.classList.toggle('stealth-monochrome', !!enabled);
}

function applyMonoTextColor(textColor) {
  document.documentElement.style.setProperty('--stealth-text-color', textColor || '#808080');
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if ('bookmarks' in changes) {
    bookmarks = changes.bookmarks.newValue || [];
    renderBookmarks();
  }
  if ('globalMonochrome' in changes) {
    applyGlobalMonochrome(!!changes.globalMonochrome.newValue);
  }
  if ('monoTextColor' in changes) {
    applyMonoTextColor(changes.monoTextColor.newValue);
  }
});

// --------------------------------- Boot -------------------------------------

async function init() {
  const data = await chrome.storage.local.get([
    STATE_KEY, 'bookmarks', 'defaultLeftUrl', 'defaultRightUrl',
    'globalMonochrome', 'monoTextColor'
  ]);
  bookmarks = data.bookmarks || [];
  applyMonoTextColor(data.monoTextColor || '#808080');
  applyGlobalMonochrome(!!data.globalMonochrome, data.monoTextColor);

  const dLeft  = data.defaultLeftUrl  || FALLBACK.defaultLeftUrl;
  const dRight = data.defaultRightUrl || FALLBACK.defaultRightUrl;

  const stored = data[STATE_KEY] || {};
  state.left  = { ...state.left,  ...(stored.left  || {}) };
  state.right = { ...state.right, ...(stored.right || {}) };
  state.leftPct = stored.leftPct || 50;
  state.active  = stored.active  || 'left';

  if (!state.left.url)  state.left.url  = dLeft;
  if (!state.right.url) state.right.url = dRight;

  $('leftUrl').value  = state.left.url;
  $('rightUrl').value = state.right.url;
  $('leftFrame').src  = state.left.url;
  $('rightFrame').src = state.right.url;

  // Seed history with the initial URLs (content.js will also announce
  // navigation; pushHistory dedupes so it's safe to call now too).
  pushHistory('left',  state.left.url);
  pushHistory('right', state.right.url);

  applyLayout();
  // Per-pane monochrome/hideImages are pushed via postMessage once each
  // iframe content script signals ready (no need to set anything here).
  updateToggleButtons();
  updateActiveBorder();
  renderBookmarks();
}

bind();
init();
