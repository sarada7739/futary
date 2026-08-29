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
