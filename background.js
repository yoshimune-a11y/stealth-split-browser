const ADBLOCK_RULESET = 'adblock';
const FRAME_UNBLOCK_RULESET = 'frame_unblock';

const DEFAULTS = {
  adBlock: true,
  frameUnblock: true,
  globalMonochrome: false,
  monoTextColor: '#808080',
  defaultLeftUrl: 'https://www.bing.com',
  defaultRightUrl: 'https://ja.wikipedia.org',
  bookmarks: []
};

async function setRuleset(id, on) {
  try {
    await chrome.declarativeNetRequest.updateEnabledRulesets(
      on ? { enableRulesetIds: [id] } : { disableRulesetIds: [id] }
    );
  } catch (e) {
    console.warn('updateEnabledRulesets failed', id, e);
  }
}

async function syncRulesets() {
  const st = await chrome.storage.local.get(['adBlock', 'frameUnblock']);
  await setRuleset(ADBLOCK_RULESET, st.adBlock !== false);
  await setRuleset(FRAME_UNBLOCK_RULESET, st.frameUnblock !== false);
}

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(Object.keys(DEFAULTS));
  await chrome.storage.local.set({ ...DEFAULTS, ...existing });
  await syncRulesets();
});

chrome.runtime.onStartup.addListener(syncRulesets);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if ('adBlock' in changes) setRuleset(ADBLOCK_RULESET, !!changes.adBlock.newValue);
  if ('frameUnblock' in changes) setRuleset(FRAME_UNBLOCK_RULESET, !!changes.frameUnblock.newValue);
});

const splitterUrl = () => chrome.runtime.getURL('splitter.html');

function isSplitterTab(tab) {
  return !!(tab && tab.url && tab.url.startsWith(splitterUrl()));
}

async function openSplitter() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = splitterUrl();
  if (tab) {
    if (isSplitterTab(tab)) return; // already on splitter
    await chrome.tabs.update(tab.id, { url });
  } else {
    await chrome.tabs.create({ url });
  }
}

async function forwardToSplitter(command) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!isSplitterTab(tab)) return; // shortcut C/V only acts when on splitter
  try {
    await chrome.runtime.sendMessage({ type: 'splitter-command', command });
  } catch (_) { /* no listener — ignore */ }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'open-splitter') openSplitter();
});

async function toggleGlobalMonochrome() {
  const { globalMonochrome } = await chrome.storage.local.get('globalMonochrome');
  await chrome.storage.local.set({ globalMonochrome: !globalMonochrome });
}

chrome.commands.onCommand.addListener((command) => {
  if (command === 'open-splitter') openSplitter();
  else if (command === 'toggle-left') forwardToSplitter('toggle-left');
  else if (command === 'toggle-right') forwardToSplitter('toggle-right');
  else if (command === 'toggle-monochrome') toggleGlobalMonochrome();
});
