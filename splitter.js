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

const $ = (id) => document.getElementById(id);

// ----------------------------- Utilities ------------------------------------

function normalizeUrl(input) {
  const s = (input || '').trim();
  if (!s) return '';
  if (/^(https?|ftp|file):\/\//i.test(s)) return s;
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
  // Pane state (monochrome/hideImages) will be pushed when the iframe's
  // content script announces 'ready' (see the message listener below).
  persist();
}

function toggleHide(side, force) {
  const newVal = (typeof force === 'boolean') ? force : !state[side].hidden;
  state[side].hidden = newVal;
  applyLayout();
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
      const frame = $(side + 'Frame');
      try {
        if (act === 'back') frame.contentWindow.history.back();
        else if (act === 'forward') frame.contentWindow.history.forward();
        else if (act === 'reload') frame.contentWindow.location.reload();
      } catch (e) {
        if (act === 'reload') frame.src = frame.src;
      }
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

window.addEventListener('message', (e) => {
  const data = e.data;
  if (!data || data[TAG] !== true) return;
  if (data.type !== 'ready') return;
  ['left', 'right'].forEach((side) => {
    const frame = $(side + 'Frame');
    if (frame && e.source === frame.contentWindow) {
      frameReady[side] = true;
      pushIframeState(side);
    }
  });
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

  applyLayout();
  // Per-pane monochrome/hideImages are pushed via postMessage once each
  // iframe content script signals ready (no need to set anything here).
  updateToggleButtons();
  updateActiveBorder();
  renderBookmarks();
}

bind();
init();
