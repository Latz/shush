'use strict';

let background;

beforeEach(async () => {
  globalThis.setupChromeMock();
  vi.resetModules();
  background = await import('../../background.js');
});

describe('getVivaldiWorkspaceId', () => {
  test('returns null when vivExtData is absent (e.g. Chrome)', () => {
    const { getVivaldiWorkspaceId } = background;
    expect(getVivaldiWorkspaceId({ id: 1 })).toBeNull();
  });

  test('returns null for a null/undefined tab', () => {
    const { getVivaldiWorkspaceId } = background;
    expect(getVivaldiWorkspaceId(null)).toBeNull();
    expect(getVivaldiWorkspaceId(undefined)).toBeNull();
  });

  test('parses an integer workspaceId', () => {
    const { getVivaldiWorkspaceId } = background;
    const tab = { vivExtData: JSON.stringify({ workspaceId: 1691949718695 }) };
    expect(getVivaldiWorkspaceId(tab)).toBe(1691949718695);
  });

  test('normalizes a float-formatted workspaceId to the same Number as its integer form', () => {
    const { getVivaldiWorkspaceId } = background;
    const floatTab = { vivExtData: JSON.stringify({ workspaceId: '1.691949718695e+12' }) };
    const intTab = { vivExtData: JSON.stringify({ workspaceId: 1691949718695 }) };
    expect(getVivaldiWorkspaceId(floatTab)).toBe(getVivaldiWorkspaceId(intTab));
  });

  test('returns null when vivExtData is malformed JSON', () => {
    const { getVivaldiWorkspaceId } = background;
    expect(getVivaldiWorkspaceId({ vivExtData: '{not json' })).toBeNull();
  });

  test('returns null when vivExtData has no workspaceId', () => {
    const { getVivaldiWorkspaceId } = background;
    expect(getVivaldiWorkspaceId({ vivExtData: JSON.stringify({ other: 1 }) })).toBeNull();
  });
});
