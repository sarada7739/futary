import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// @testing-library/react は Jest では afterEach を自動登録するが、
// Vitest ではグローバル afterEach に自前で繋ぐ必要がある。
// 無いと前のテストの render() 結果が DOM に残り続け、getByText が
// 複数要素にマッチしてしまう
afterEach(() => {
  cleanup();
});

// 039: Node 22 以降は `localStorage` を global に持つが、`--localstorage-file` 無しでは
// メソッドを持たない空のオブジェクトになる（Node 25.2 で実測。`clear is not a
// function`）。vitest の jsdom 環境は既に global にある名前を jsdom のもので
// 上書きしないため、`window.localStorage` もこの空のオブジェクトを指す。
// jsdom が本来提供する Storage 相当を、メソッドが無いときだけ補う
// （ブラウザ・jsdom が正しく提供する環境では触らない）
function installMemoryStorage() {
  const existing = (globalThis as { localStorage?: Partial<Storage> }).localStorage;
  if (existing && typeof existing.setItem === "function") return;
  const store = new Map<string, string>();
  const memoryStorage: Storage = {
    get length() {
      return store.size;
    },
    key: (index: number) => [...store.keys()][index] ?? null,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
  Object.defineProperty(globalThis, "localStorage", { value: memoryStorage, configurable: true, writable: true });
}

installMemoryStorage();
