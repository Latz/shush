'use strict';

let background;

beforeEach(async () => {
  global.setupChromeMock();
  vi.resetModules();
  background = await import('../../background.js');
});

describe('buildNoisyTabsList', () => {
  test('returns empty array when input is empty', () => {
    const { buildNoisyTabsList } = background;
    expect(buildNoisyTabsList([], null)).toEqual([]);
  });

  test('excludes tabs with non-http URLs', () => {
    const { buildNoisyTabsList } = background;
    const tabs = [
      { id: 1, url: 'chrome://newtab', title: 'New Tab' },
      { id: 2, url: 'https://example.com', title: 'Example' },
      { id: 3, url: 'file:///etc/hosts', title: 'Hosts' },
    ];
    const result = buildNoisyTabsList(tabs, null);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(2);
  });

  test('includes http:// tabs (not only https)', () => {
    const { buildNoisyTabsList } = background;
    const tabs = [{ id: 1, url: 'http://example.com', title: 'Example' }];
    expect(buildNoisyTabsList(tabs, null)).toHaveLength(1);
  });

  test('marks the current active tab with isCurrentTab true', () => {
    const { buildNoisyTabsList } = background;
    const tabs = [
      { id: 1, url: 'https://a.com', title: 'A' },
      { id: 2, url: 'https://b.com', title: 'B' },
    ];
    const result = buildNoisyTabsList(tabs, { id: 1 });
    expect(result.find(t => t.id === 1).isCurrentTab).toBe(true);
    expect(result.find(t => t.id === 2).isCurrentTab).toBe(false);
  });

  test('marks shush-muted tabs as muted even when mutedInfo is false', () => {
    const { buildNoisyTabsList, shushMutedTabs } = background;
    shushMutedTabs.add(42);
    const tabs = [{ id: 42, url: 'https://a.com', title: 'A', mutedInfo: { muted: false } }];
    expect(buildNoisyTabsList(tabs, null)[0].muted).toBe(true);
  });

  test('marks browser-muted tabs as muted via mutedInfo', () => {
    const { buildNoisyTabsList } = background;
    const tabs = [{ id: 5, url: 'https://a.com', title: 'A', mutedInfo: { muted: true } }];
    expect(buildNoisyTabsList(tabs, null)[0].muted).toBe(true);
  });

  test('defaults muted to false when neither shush-muted nor browser-muted', () => {
    const { buildNoisyTabsList } = background;
    const tabs = [{ id: 5, url: 'https://a.com', title: 'A', mutedInfo: { muted: false } }];
    expect(buildNoisyTabsList(tabs, null)[0].muted).toBe(false);
  });

  test('handles null currentActiveTab without throwing', () => {
    const { buildNoisyTabsList } = background;
    const tabs = [{ id: 1, url: 'https://a.com', title: 'A' }];
    expect(() => buildNoisyTabsList(tabs, null)).not.toThrow();
    expect(buildNoisyTabsList(tabs, null)[0].isCurrentTab).toBeFalsy();
  });

  test('uses i18n untitled key for tabs with empty title', () => {
    const { buildNoisyTabsList } = background;
    buildNoisyTabsList([{ id: 1, url: 'https://a.com', title: '' }], null);
    expect(chrome.i18n.getMessage).toHaveBeenCalledWith('untitled');
  });
});
