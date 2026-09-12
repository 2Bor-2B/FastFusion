import '@testing-library/jest-dom/vitest';

if (!window.PointerEvent) {
  class PointerEventMock extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly isPrimary: boolean;

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? 'mouse';
      this.isPrimary = init.isPrimary ?? true;
    }
  }

  Object.defineProperty(window, 'PointerEvent', { configurable: true, value: PointerEventMock });
}

// jsdom in this setup ships no Web Storage, so the persistence code would always
// take its "storage unavailable" branch. Give it a minimal in-memory Storage.
if (!(globalThis as { localStorage?: Storage }).localStorage) {
  const store = new Map<string, string>();
  const memoryStorage: Storage = {
    get length() { return store.size; },
    clear: () => store.clear(),
    getItem: (key) => (store.has(key) ? store.get(key)! : null),
    key: (index) => [...store.keys()][index] ?? null,
    removeItem: (key) => { store.delete(key); },
    setItem: (key, value) => { store.set(key, String(value)); },
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: memoryStorage });
}
