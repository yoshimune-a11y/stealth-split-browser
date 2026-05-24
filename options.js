const KEYS = ['defaultLeftUrl', 'defaultRightUrl', 'bookmarks', 'adBlock', 'frameUnblock'];

function $(id) { return document.getElementById(id); }

function showStatus(msg) {
  const el = $('status');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(showStatus._t);
  showStatus._t = setTimeout(() => el.classList.remove('show'), 1400);
}

function debounce(fn, ms) {
  let t = null;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

let bookmarks = [];

function renderBookmarks() {
  const tb = $('bmTbody');
  tb.innerHTML = '';
  if (!bookmarks.length) {
    const tr = document.createElement('tr');
    tr.className = 'empty';
    tr.innerHTML = '<td colspan="3">ブックマークがありません。下のフォームから追加してください。</td>';
    tb.appendChild(tr);
    return;
  }
  bookmarks.forEach((bm, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="text" data-field="title" data-idx="${idx}" value="${escapeHtml(bm.title || '')}"></td>
      <td><input type="text" data-field="url" data-idx="${idx}" value="${escapeHtml(bm.url || '')}"></td>
      <td class="actions"><button class="del" data-idx="${idx}">削除</button></td>
    `;
    tb.appendChild(tr);
  });

  tb.querySelectorAll('input').forEach((inp) => {
    inp.addEventListener('input', onBmEdit);
  });
  tb.querySelectorAll('.del').forEach((b) => {
    b.addEventListener('click', onBmDelete);
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const saveBookmarks = debounce(() => {
  chrome.storage.local.set({ bookmarks });
  showStatus('保存しました');
}, 250);

function onBmEdit(e) {
  const idx = parseInt(e.target.dataset.idx, 10);
  const field = e.target.dataset.field;
  if (!bookmarks[idx]) return;
  bookmarks[idx][field] = e.target.value;
  saveBookmarks();
}

function onBmDelete(e) {
  const idx = parseInt(e.target.dataset.idx, 10);
  bookmarks.splice(idx, 1);
  renderBookmarks();
  chrome.storage.local.set({ bookmarks });
  showStatus('削除しました');
}

function onBmAdd() {
  const title = $('newBmTitle').value.trim();
  const url = $('newBmUrl').value.trim();
  if (!url) {
    $('newBmUrl').focus();
    return;
  }
  bookmarks.push({ title: title || url, url });
  $('newBmTitle').value = '';
  $('newBmUrl').value = '';
  renderBookmarks();
  chrome.storage.local.set({ bookmarks });
  showStatus('追加しました');
}

async function init() {
  const data = await chrome.storage.local.get(KEYS);
  $('defaultLeftUrl').value  = data.defaultLeftUrl  || '';
  $('defaultRightUrl').value = data.defaultRightUrl || '';
  $('adBlock').checked       = data.adBlock !== false;
  $('frameUnblock').checked  = data.frameUnblock !== false;
  bookmarks = Array.isArray(data.bookmarks) ? data.bookmarks : [];
  renderBookmarks();
}

function bind() {
  const persistDefault = debounce((key, value) => {
    chrome.storage.local.set({ [key]: value });
    showStatus('保存しました');
  }, 300);

  $('defaultLeftUrl').addEventListener('input', (e) => {
    persistDefault('defaultLeftUrl', e.target.value.trim());
  });
  $('defaultRightUrl').addEventListener('input', (e) => {
    persistDefault('defaultRightUrl', e.target.value.trim());
  });

  $('adBlock').addEventListener('change', (e) => {
    chrome.storage.local.set({ adBlock: e.target.checked });
    showStatus(e.target.checked ? '広告ブロック ON' : '広告ブロック OFF');
  });
  $('frameUnblock').addEventListener('change', (e) => {
    chrome.storage.local.set({ frameUnblock: e.target.checked });
    showStatus(e.target.checked ? 'iframe制限解除 ON' : 'iframe制限解除 OFF');
  });

  $('addBm').addEventListener('click', onBmAdd);
  $('newBmUrl').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') onBmAdd();
  });
  $('newBmTitle').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('newBmUrl').focus();
  });

  $('resetState').addEventListener('click', async () => {
    if (!confirm('保存されている分割画面の状態 (URL, 表示/非表示, モノクロ等) をすべてリセットします。よろしいですか?')) return;
    await chrome.storage.local.remove('splitterState');
    showStatus('分割状態をリセットしました');
  });
}

document.addEventListener('DOMContentLoaded', () => {
  bind();
  init();
});
