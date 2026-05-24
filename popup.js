const KEYS = ['adBlock', 'frameUnblock'];

function init() {
  chrome.storage.local.get(KEYS, (state) => {
    KEYS.forEach((k) => {
      const el = document.getElementById(k);
      if (el) el.checked = state[k] !== false; // default true
    });
  });

  KEYS.forEach((k) => {
    const el = document.getElementById(k);
    if (!el) return;
    el.addEventListener('change', () => {
      chrome.storage.local.set({ [k]: el.checked });
    });
  });

  document.getElementById('openSplit').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'open-splitter' });
    window.close();
  });

  document.getElementById('openOpts').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });
}

document.addEventListener('DOMContentLoaded', init);
