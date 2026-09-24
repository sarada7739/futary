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

// Node 22 以降は `localStorage` を global に持つが、`--localstorage-file` 無しではメソッドを持たない空の
// オブジェクトになる（`clear is not a function`）。vitest の jsdom 環境は既にある global を上書きしない
// ので、`window.localStorage` もこれを指す。メソッドが無いときだけ Storage 相当を補う。sessionStorage も
// 同じ形で補う（環境で変わりうる）
function installMemoryStorage(name: "localStorage" | "sessionStorage") {
  const existing = (globalThis as unknown as Record<string, Partial<Storage> | undefined>)[name];
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
  Object.defineProperty(globalThis, name, { value: memoryStorage, configurable: true, writable: true });
}

installMemoryStorage("localStorage");
installMemoryStorage("sessionStorage");
