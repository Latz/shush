// The payload injected into muted tabs.
//
// IMPORTANT: applyMediaMute runs in the page's MAIN world via chrome.scripting.executeScript,
// which serializes it to source and re-evaluates it there. It therefore must not reference
// anything outside its own body — no imports, no module-scope constants, no closures. Keeping
// it in its own module is purely so tests can drive it directly under jsdom; the extension
// still ships it by value, not by URL.

/**
 * Mutes or unmutes every audio/video element in the current document, and while muted keeps
 * them that way against both the page's own scripts and newly inserted media.
 *
 * Three mechanisms, each covering what the others cannot:
 * 1. A one-time patch of HTMLMediaElement.prototype.muted, so a player that re-uses an
 *    existing element (Spotify and podcast players set `el.muted = false` between tracks)
 *    cannot un-mute out from under us.
 * 2. A direct pass over the elements present right now.
 * 3. A MutationObserver for elements added later. It inspects only the added nodes rather
 *    than re-scanning the document per batch — on churny pages (live chat, infinite scroll)
 *    nearly every batch contains no media, and a full querySelectorAll per batch is
 *    page-visible jank.
 *
 * Idempotent: safe to run repeatedly on the same document.
 * @param {boolean} m - true to mute and hold, false to release and resume.
 */
export function applyMediaMute(m) {
  const proto = HTMLMediaElement.prototype;
  if (!globalThis.__shushMutedDescriptor) {
    const desc = Object.getOwnPropertyDescriptor(proto, 'muted');
    globalThis.__shushMutedDescriptor = desc;
    Object.defineProperty(proto, 'muted', {
      configurable: true,
      get() { return desc.get.call(this); },
      set(v) { desc.set.call(this, globalThis.__shushActive ? true : v); }
    });
  }
  globalThis.__shushActive = m;

  document.querySelectorAll('audio, video').forEach(el => {
    el.muted = m;
    if (!m && el.paused && !el.ended) el.play().catch(() => {});
  });

  if (m) {
    if (!globalThis.__shushObserver) {
      globalThis.__shushObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            if (node.matches('audio, video')) {
              node.muted = true;
            } else {
              node.querySelectorAll('audio, video').forEach(el => { el.muted = true; });
            }
          }
        }
      });
      globalThis.__shushObserver.observe(document.documentElement, { childList: true, subtree: true });
    }
  } else if (globalThis.__shushObserver) {
    globalThis.__shushObserver.disconnect();
    globalThis.__shushObserver = null;
  }
}
