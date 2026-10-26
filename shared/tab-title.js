// Tab helpers shared by the service worker and the popup.

/** Strips a leading notification count, e.g. "(3) Now Playing" → "Now Playing". */
export function cleanTabTitle(title) {
  return title.replace(/^\(\d+\)\s*/, '');
}

/** Cuts a (cleaned) title to 30 characters for menu and popup rows. */
export function shortTitle(cleanTitle) {
  return cleanTitle.length > 30 ? cleanTitle.slice(0, 27) + '...' : cleanTitle;
}

/** Only real web pages are listed; chrome://, file:// and the like are skipped. */
export function isWebTab(tab) {
  return Boolean(tab.url?.startsWith('http'));
}
