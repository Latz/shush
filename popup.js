import { switchToTab } from './shared/vivaldi.js';
import { cleanTabTitle, shortTitle, isWebTab } from './shared/tab-title.js';

// Popup script for Shush! extension

const tabDataMap = new Map();

/**
 * Replaces #content with a single status line.
 * Built from a text node rather than an innerHTML template so no caller can ever inject markup.
 * @param {string} text
 */
function showMessage(text) {
  const message = document.createElement('div');
  message.className = 'no-tabs';
  message.textContent = text;
  document.querySelector('#content').replaceChildren(message);
}

/**
 * Normalizes a chrome.tabs.Tab into the flat shape the popup renders and persists.
 * Single construction site, so every object in tabDataMap shares one V8 hidden class.
 * @param {chrome.tabs.Tab} tab
 * @param {boolean} [muted] - Overrides the tab's own mutedInfo; used for context-menu-muted tabs,
 *   whose live mutedInfo is unreliable in Vivaldi.
 * @returns {{id: number, windowId: number, title: string, url: string, favIconUrl: string, muted: boolean}}
 */
function toDisplayTab(tab, muted = tab.mutedInfo?.muted || false) {
  return {
    id: tab.id,
    windowId: tab.windowId,
    title: tab.title || chrome.i18n.getMessage('untitled'),
    url: tab.url,
    favIconUrl: tab.favIconUrl || '',
    muted
  };
}

/**
 * Applies the muted/unmuted appearance to a tab row's mute button.
 * Single place that knows the label, class and accessible name belong together — the click
 * handler flips this three times and previously updated only the first two.
 * @param {HTMLButtonElement} btn
 * @param {boolean} muted
 * @param {string} title - Tab title, already stripped of any notification count.
 */
function setMuteButtonState(btn, muted, title) {
  // "Shush!"/"Unshush!" are the product's own wording and stay untranslated by design;
  // aria-label carries the localized meaning for assistive tech.
  btn.textContent = muted ? 'Unshush!' : 'Shush!';
  btn.className = muted ? 'unmute-btn' : 'mute-btn';
  btn.setAttribute('aria-label',
    `${chrome.i18n.getMessage(muted ? 'menuUnmuteTab' : 'menuMuteTab')}: ${title}`);
}

/**
 * Resolves a tab's favicon through Chrome's local favicon cache.
 * Preferred over the tab's own favIconUrl, which points at the site itself — loading that
 * would tell every listed site, on every popup open, that the user is running Shush!.
 * @param {string} pageUrl
 * @returns {string} Extension-local favicon URL, or '' when one can't be built.
 */
function faviconUrl(pageUrl) {
  if (!pageUrl) return '';
  const url = new URL(chrome.runtime.getURL('/_favicon/'));
  url.searchParams.set('pageUrl', pageUrl);
  url.searchParams.set('size', '32');
  return url.href;
}

/**
 * Shows the Mute All button when tabDataMap has at least one unmuted entry, hides it otherwise.
 * Also resets its label/disabled state, so a single call after any render is enough.
 */
function updateMuteAllButton() {
  const btn = /** @type {HTMLButtonElement} */ (document.querySelector('#mute-all-btn'));
  const hasUnmuted = tabDataMap.values().some(tab => !tab.muted);
  btn.hidden = !hasUnmuted;
  if (!hasUnmuted) {
    return;
  }

  btn.disabled = false;
  btn.textContent = chrome.i18n.getMessage('btnMuteAll');
}

/**
 * Mutes every currently-rendered (background, non-active) tab that isn't already muted,
 * then reloads the popup to reflect the new state.
 * @returns {Promise<void>}
 */
async function muteAllVisibleTabs() {
  const targets = tabDataMap.values().filter(tab => !tab.muted).toArray();
  if (targets.length === 0) return;
  // One message for the whole batch: the worker saves and refreshes the menu once, not per tab.
  await chrome.runtime.sendMessage({ action: 'muteTabs', tabIds: targets.map(tab => tab.id), muted: true })
    .catch(() => {}); // reload below shows whatever state resulted
  await loadNoisyTabs();
}

/**
 * Replaces #content with a tab item for each entry in noisyTabsList.
 * Populates tabDataMap so the delegated click listener can resolve tab objects by ID.
 * @param {Array<{id: number, windowId: number, title: string, url: string, favIconUrl: string, muted: boolean}>} noisyTabsList
 */
function renderTabs(noisyTabsList) {
  tabDataMap.clear();
  noisyTabsList.forEach(tab => { tabDataMap.set(tab.id, tab); });

  const content = document.querySelector('#content');
  // Build off-document, then attach once — #content stays in the live tree, so appending each
  // item directly would touch the rendered DOM once per tab instead of once per render.
  const fragment = document.createDocumentFragment();
  noisyTabsList.forEach(tab => {
    const cleanTitle = cleanTabTitle(tab.title);

    const item = document.createElement('div');
    item.className = 'tab-item';
    item.dataset.tabId = String(tab.id);

    // Still gated on the tab actually having a favicon, so tabs without one keep rendering
    // without an image rather than picking up Chrome's placeholder globe.
    const faviconSrc = tab.favIconUrl ? faviconUrl(tab.url) : '';
    if (faviconSrc) {
      const img = document.createElement('img');
      img.className = 'tab-favicon';
      img.alt = '';
      img.src = faviconSrc;
      item.append(img);
    }

    const titleDiv = document.createElement('div');
    titleDiv.className = 'tab-title';
    titleDiv.title = cleanTitle;
    titleDiv.textContent = shortTitle(cleanTitle);
    item.append(titleDiv);

    const actions = document.createElement('div');
    actions.className = 'tab-actions';

    const switchBtn = document.createElement('button');
    switchBtn.className = 'switch-btn';
    switchBtn.textContent = chrome.i18n.getMessage('btnSwitch');
    // The visible label is the same on every row, so name the target tab for screen readers.
    switchBtn.setAttribute('aria-label', `${chrome.i18n.getMessage('btnSwitch')}: ${cleanTitle}`);
    actions.append(switchBtn);

    const muteBtn = document.createElement('button');
    setMuteButtonState(muteBtn, tab.muted, cleanTitle);
    actions.append(muteBtn);

    item.append(actions);
    fragment.append(item);
  });
  content.replaceChildren(fragment);

  updateMuteAllButton();
}

/**
 * Merges the audible and background-muted tabs into one list, first source wins.
 * Displayable = a real web page that is not the tab the user is already looking at.
 * @param {chrome.tabs.Tab[]} audibleTabs
 * @param {chrome.tabs.Tab[]} bgMutedTabs
 * @param {number|undefined} activeTabId
 * @returns {{allDisplayedTabs: ReturnType<typeof toDisplayTab>[], totalAudioTabs: number}}
 *   totalAudioTabs counts audible web pages including the active one, to tell "no audio
 *   anywhere" from "audio, but only where you already are".
 */
function mergeDisplayTabs(audibleTabs, bgMutedTabs, activeTabId) {
  const isDisplayable = tab => tab.id !== activeTabId && isWebTab(tab);
  // One insertion-ordered Map replaces the previous three filter/map passes and the two
  // intermediate id Sets: the merge is strictly first-wins, which `has` expresses directly.
  const byId = new Map();
  let totalAudioTabs = 0;
  for (const tab of audibleTabs) {
    if (!isWebTab(tab)) continue;
    totalAudioTabs++;
    if (isDisplayable(tab)) byId.set(tab.id, toDisplayTab(tab));
  }
  for (const tab of bgMutedTabs) {
    if (isDisplayable(tab) && !byId.has(tab.id)) byId.set(tab.id, toDisplayTab(tab, true));
  }
  return { allDisplayedTabs: byId.values().toArray(), totalAudioTabs };
}

/**
 * Entry point called on DOMContentLoaded.
 * Fetches audible and shush-muted tabs in parallel, then renders them.
 * @returns {Promise<void>}
 */
async function loadNoisyTabs() {
  showMessage(chrome.i18n.getMessage('popupScanning'));

  try {
    const [[currentActiveTab], allTabs, bgMutedIds] = await Promise.all([
      chrome.tabs.query({ active: true, currentWindow: true }),
      chrome.tabs.query({}),
      chrome.runtime.sendMessage({ action: 'getShushMutedTabs' }).catch(() => []),
    ]);

    // Derived from allTabs rather than a second chrome.tabs.query({ audible: true }) —
    // the audible set is a strict subset, so the extra round-trip bought nothing.
    const audibleTabs = allTabs.filter(t => t.audible);

    // Single map covering all open tabs — used instead of N individual chrome.tabs.get calls
    const tabById = new Map(allTabs.map(t => [t.id, t]));

    // ?? []: sendMessage resolves undefined (rather than rejecting) when no listener answers,
    // so .catch above does not cover that case.
    const bgMutedTabs = (bgMutedIds ?? [])
      .map(id => tabById.get(id))
      .filter(Boolean);

    const { allDisplayedTabs, totalAudioTabs } = mergeDisplayTabs(
      audibleTabs, bgMutedTabs, currentActiveTab?.id);

    if (allDisplayedTabs.length > 0) {
      renderTabs(allDisplayedTabs);
      return;
    }
    // Nothing to list: distinguish "no audio anywhere" from "audio, but only where you already are"
    tabDataMap.clear();
    showMessage(chrome.i18n.getMessage(totalAudioTabs === 0 ? 'noAudio' : 'audioCurrentTab'));
    updateMuteAllButton();
  } catch (error) {
    console.error('Error loading noisy tabs:', error);
    showMessage(chrome.i18n.getMessage('errorLoadTabs'));
    tabDataMap.clear();
    updateMuteAllButton();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // popup.html can only carry one static lang; correct it to the UI locale so screen
  // readers pronounce the localized strings properly.
  document.documentElement.lang = chrome.i18n.getUILanguage?.() ?? 'en';

  const content = document.querySelector('#content');
  const muteAllBtn = /** @type {HTMLButtonElement} */ (document.querySelector('#mute-all-btn'));

  muteAllBtn.addEventListener('click', async () => {
    muteAllBtn.disabled = true;
    muteAllBtn.textContent = chrome.i18n.getMessage('btnMuting');
    await muteAllVisibleTabs();
  });

  content.addEventListener('click', async (e) => {
    const target = /** @type {Element} */ (e.target);
    const item = /** @type {HTMLElement|null} */ (target.closest('[data-tab-id]'));
    if (!item) return;
    const tab = tabDataMap.get(Number(item.dataset.tabId));
    if (!tab) return;

    if (target.closest('.switch-btn')) {
      try {
        await switchToTab(tab.id, tab.windowId);
        window.close();
      } catch (error) {
        console.error('Switch failed:', error); // tab closed since the list was rendered
      }
    } else {
      const muteBtn = /** @type {HTMLButtonElement|null} */ (target.closest('.mute-btn, .unmute-btn'));
      if (!muteBtn) return;
      const title = cleanTabTitle(tab.title);
      const nowMuted = !tab.muted;
      // Update UI immediately; correct below if background returns a different state
      tab.muted = nowMuted;
      setMuteButtonState(muteBtn, nowMuted, title);
      try {
        // Delegate mute to background service worker to avoid popup-context revert
        const response = await chrome.runtime.sendMessage({ action: 'muteTab', tabId: tab.id, muted: nowMuted });
        const actuallyMuted = response?.muted ?? nowMuted;
        if (actuallyMuted !== nowMuted) {
          tab.muted = actuallyMuted;
          setMuteButtonState(muteBtn, actuallyMuted, title);
        }
      } catch (error) {
        console.error('Mute failed:', error);
        // Revert optimistic update on error
        tab.muted = !nowMuted;
        setMuteButtonState(muteBtn, tab.muted, title);
      }
      updateMuteAllButton();
    }
  });

  // Capture phase: error events don't bubble, so use capture to handle favicon load failures
  content.addEventListener('error', (e) => {
    const target = /** @type {Element} */ (e.target);
    if (target.matches('.tab-favicon')) target.remove();
  }, {capture: true});

  loadNoisyTabs();
});
