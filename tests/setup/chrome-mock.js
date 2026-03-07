// Chrome API mock factory for Vitest tests.
// `vi` is available as a global in setupFiles when globals: true.

function setupChromeMock() {
  globalThis.chrome = {
    tabs: {
      query: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({ windowId: 1 }),
      onUpdated: { addListener: vi.fn() },
      onRemoved: { addListener: vi.fn() },
      onActivated: { addListener: vi.fn() },
    },
    runtime: {
      onMessage: { addListener: vi.fn() },
      onInstalled: { addListener: vi.fn() },
      onStartup: { addListener: vi.fn() },
      lastError: null,
    },
    contextMenus: {
      create: vi.fn().mockImplementation((_props, cb) => { if (cb) cb(); }),
      removeAll: vi.fn().mockImplementation((cb) => { if (cb) cb(); }),
      update: vi.fn().mockResolvedValue({}),
      onClicked: { addListener: vi.fn() },
    },
    windows: {
      update: vi.fn().mockResolvedValue({}),
    },
    notifications: {
      create: vi.fn(),
    },
    i18n: {
      getMessage: vi.fn().mockImplementation((key) => key),
    },
    scripting: {
      executeScript: vi.fn().mockResolvedValue([]),
    },
  };
}

globalThis.setupChromeMock = setupChromeMock;
setupChromeMock();
