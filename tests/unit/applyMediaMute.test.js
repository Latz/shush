// @vitest-environment jsdom
'use strict';

import { applyMediaMute } from '../../shared/media-mute.js';

// jsdom implements HTMLMediaElement's `muted` property but not playback, so `play` is stubbed
// per element. Every test starts from a clean document and clean page globals, since
// applyMediaMute deliberately keeps its state on globalThis (it runs in a page, not a module).
//
// The pristine accessor is captured once, before any test can patch it: deleting the property
// instead would drop jsdom's own implementation, and the next patch would then wrap undefined.
const ORIGINAL_MUTED = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'muted');

beforeEach(() => {
  document.body.innerHTML = '';
  globalThis.__shushObserver?.disconnect();
  delete globalThis.__shushMutedDescriptor;
  delete globalThis.__shushActive;
  delete globalThis.__shushObserver;
  Object.defineProperty(HTMLMediaElement.prototype, 'muted', ORIGINAL_MUTED);
});

/** Adds a media element to the document, with playback state and a stubbed play(). */
function addMedia(tag = 'audio', { paused = false, ended = false } = {}) {
  const el = document.createElement(tag);
  el.play = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(el, 'paused', { value: paused, configurable: true });
  Object.defineProperty(el, 'ended', { value: ended, configurable: true });
  document.body.appendChild(el);
  return el;
}

/** MutationObserver callbacks are microtask-scheduled; this lets them run. */
const flushObserver = () => new Promise(resolve => setTimeout(resolve, 0));

describe('applyMediaMute — muting', () => {
  test('mutes every audio and video element already in the document', () => {
    const audio = addMedia('audio');
    const video = addMedia('video');

    applyMediaMute(true);

    expect(audio.muted).toBe(true);
    expect(video.muted).toBe(true);
  });

  test("the page's own scripts cannot un-mute an existing element", () => {
    const audio = addMedia('audio');
    applyMediaMute(true);

    // What a player does between tracks. The prototype patch must swallow it.
    audio.muted = false;

    expect(audio.muted).toBe(true);
  });

  test('media inserted after the mute is muted too', async () => {
    applyMediaMute(true);

    const late = addMedia('video');
    await flushObserver();

    expect(late.muted).toBe(true);
  });

  test('media nested inside an inserted subtree is muted', async () => {
    applyMediaMute(true);

    const wrapper = document.createElement('div');
    const nested = document.createElement('audio');
    wrapper.appendChild(nested);
    document.body.appendChild(wrapper);
    await flushObserver();

    expect(nested.muted).toBe(true);
  });

  test('is idempotent — a second mute does not double-patch or re-observe', () => {
    const audio = addMedia('audio');
    applyMediaMute(true);
    const firstObserver = globalThis.__shushObserver;
    const firstDescriptor = globalThis.__shushMutedDescriptor;

    applyMediaMute(true);

    expect(globalThis.__shushObserver).toBe(firstObserver);
    expect(globalThis.__shushMutedDescriptor).toBe(firstDescriptor);
    expect(audio.muted).toBe(true);
  });
});

describe('applyMediaMute — unmuting', () => {
  test('unmutes existing elements and releases the write guard', () => {
    const audio = addMedia('audio');
    applyMediaMute(true);

    applyMediaMute(false);

    expect(audio.muted).toBe(false);
    // The patch stays installed but must no longer force writes to true.
    audio.muted = false;
    expect(audio.muted).toBe(false);
  });

  test('resumes media the page paused while muted', () => {
    const paused = addMedia('audio', { paused: true });
    applyMediaMute(true);

    applyMediaMute(false);

    expect(paused.play).toHaveBeenCalled();
  });

  test('does not resume media that has ended or is already playing', () => {
    const ended = addMedia('audio', { paused: true, ended: true });
    const playing = addMedia('audio', { paused: false });
    applyMediaMute(true);

    applyMediaMute(false);

    expect(ended.play).not.toHaveBeenCalled();
    expect(playing.play).not.toHaveBeenCalled();
  });

  test('a rejected play() does not propagate', () => {
    const paused = addMedia('audio', { paused: true });
    paused.play = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    applyMediaMute(true);

    expect(() => applyMediaMute(false)).not.toThrow();
  });

  test('disconnects the observer so later inserts are left alone', async () => {
    applyMediaMute(true);
    applyMediaMute(false);

    const late = addMedia('audio');
    await flushObserver();

    expect(late.muted).toBe(false);
    expect(globalThis.__shushObserver).toBeNull();
  });
});
