// Vivaldi-specific tab helpers, shared by the service worker and the popup.

/**
 * Reads the Vivaldi-specific workspace ID off a tab, if present.
 * Undocumented field (vivExtData); absent entirely on Chrome, so this is a natural no-op there.
 * Normalizes to Number since Vivaldi has been observed reporting the same ID as either an int or a float.
 * @param {chrome.tabs.Tab} tab
 * @returns {number|null}
 */
export function getVivaldiWorkspaceId(tab) {
  if (!tab?.vivExtData) return null;
  try {
    const id = JSON.parse(tab.vivExtData)?.workspaceId;
    return id === undefined || id === null ? null : Number(id);
  } catch {
    return null;
  }
}

/**
 * Activates a tab and focuses its window. On Vivaldi, if the tab belongs to a different
 * Workspace than the one currently shown, the tab becomes active per the API but stays
 * hidden (Workspaces are a UI-only filter with no extension API to switch) — in that case
 * also shows a notification explaining why nothing visibly changed.
 * @param {number} tabId
 * @param {number} [windowId] - Window to compare against and focus. Resolved from the tab
 *   itself when omitted, which is what the service worker needs.
 * @returns {Promise<void>}
 */
export async function switchToTab(tabId, windowId) {
  const target = await chrome.tabs.get(tabId).catch(() => null);
  const compareWindowId = windowId ?? target?.windowId;
  if (target && compareWindowId !== undefined) {
    const [activeInWindow] = await chrome.tabs.query({ active: true, windowId: compareWindowId }).catch(() => []);
    // vivExtData is Vivaldi-only; its presence on *either* tab means we're on Vivaldi and can
    // compare workspaces. Tabs in the default/no-name workspace can report a null workspaceId,
    // so null must be treated as a distinct, comparable state — not "no data, skip the check".
    if (target.vivExtData || activeInWindow?.vivExtData) {
      const targetWorkspace = getVivaldiWorkspaceId(target);
      const activeWorkspace = getVivaldiWorkspaceId(activeInWindow);
      if (targetWorkspace !== activeWorkspace) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon48.png',
          title: "Shush!",
          message: chrome.i18n.getMessage('tabInOtherWorkspace')
        });
      }
    }
  }
  const tab = await chrome.tabs.update(tabId, { active: true });
  await chrome.windows.update(windowId ?? tab.windowId, { focused: true });
}
