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
 * 2. A direct pass over the elements present right now. On release each element gets back its
 *    pre-mute muted/playing state rather than being forced audible and playing.
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

  // What each element looked like before we first muted it, so release restores that instead of
  // forcing everything audible and playing. Recorded once per element: a re-run while muted
  // would otherwise capture our own mute as the "original".
  const prior = (globalThis.__shushPrior ??= new WeakMap());
  document.querySelectorAll('audio, video').forEach(/** @param {HTMLMediaElement} el */ el => {
    if (m) {
      if (!prior.has(el)) prior.set(el, { muted: el.muted, playing: !el.paused });
      el.muted = true;
      return;
    }
    const was = prior.get(el);
    el.muted = was?.muted ?? false;
    // Resume only what was playing before the mute and was paused since (players that pause
    // while muted); never something the user had paused.
    if (was?.playing && el.paused && !el.ended) el.play().catch(() => {});
    prior.delete(el);
  });

  if (m) {
    if (!globalThis.__shushObserver) {
      globalThis.__shushObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            const element = /** @type {HTMLMediaElement} */ (node);
            if (element.matches('audio, video')) {
              element.muted = true;
            } else {
              element.querySelectorAll('audio, video').forEach(/** @param {HTMLMediaElement} el */ el => { el.muted = true; });
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
