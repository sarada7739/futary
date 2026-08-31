import { env } from "cloudflare:test";
import { ORPCError } from "@orpc/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/index";
import type { Bindings } from "../src/index";
import { withErrorId } from "../src/lib/error-id";

// 想定外の例外に一意のIDを振り、クライアントにはIDだけを返す
// （docs/tasks/016-release.md「エラー処理の統一」）。
describe("withErrorId", () => {
  it("ORPCErrorはそのまま素通しする（procedureが意図的にthrowしたエラーはIDを振る対象ではない）", async () => {
    const original = new ORPCError("FORBIDDEN");
    await expect(
      withErrorId(() => {
        throw original;
      }),
    ).rejects.toBe(original);
  });

  it("SyntaxErrorはそのまま素通しする（リクエストボディのJSONパース失敗をINTERNAL_SERVER_ERRORへ誤変換しない）", async () => {
    const original = new SyntaxError("Unexpected token");
    await expect(
      withErrorId(() => {
        throw original;
      }),
    ).rejects.toBe(original);
  });

  it("想定外の例外はINTERNAL_SERVER_ERRORへ変換し、メッセージにIDを含める。元のメッセージ自体は含めない", async () => {
    const original = new Error("SELECT * FROM secret_table WHERE password = 'xxx'");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    let caught: unknown;
    try {
      await withErrorId(() => {
        throw original;
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ORPCError);
    const orpcError = caught as ORPCError<"INTERNAL_SERVER_ERROR", unknown>;
    expect(orpcError.code).toBe("INTERNAL_SERVER_ERROR");
    // UUID形式のIDがメッセージに含まれる
    expect(orpcError.message).toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    // 元の例外のメッセージ（SQL文）はクライアント向けメッセージに含まれない
    expect(orpcError.message).not.toContain("secret_table");
    expect(orpcError.message).not.toContain("password");

    // サーバログには元の例外（スタックトレース含む）がそのまま渡っている
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("["), original);

    consoleError.mockRestore();
  });
});

// D1のバインディングが壊れている状況をシミュレートし、procedureが投げる
// 想定外の例外がHTTPレスポンスまで一意のID付きINTERNAL_SERVER_ERRORとして
// 伝わることを実際のHonoアプリ経由で確認する（procedure内部の実装に依存せず、
// index.tsに登録したinterceptorが実際に機能していることの結合テスト）
describe("想定外の例外がHTTPレスポンスまで一意のIDとして伝わる（結合）", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it("DBバインディングが例外を投げると、500・INTERNAL_SERVER_ERROR・ID付きメッセージが返る", async () => {
    const brokenDb = {
      prepare: () => {
        throw new Error("D1_ERROR: internal database error at /some/internal/path.sql");
      },
    };
    const brokenEnv = { ...env, DB: brokenDb };

    const response = await app.fetch(
      new Request("http://localhost/api/couple/get", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ json: null }),
      }),
      brokenEnv as unknown as Bindings,
    );

    expect(response.status).toBe(500);
    const body = (await response.json()) as { json: { code: string; message: string } };
    expect(body.json.code).toBe("INTERNAL_SERVER_ERROR");
    expect(body.json.message).toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    // D1のエラーメッセージ（内部パスを含む）がクライアントへ漏れていない
    expect(body.json.message).not.toContain("internal database error");
    expect(body.json.message).not.toContain("/some/internal/path.sql");

    expect(consoleError).toHaveBeenCalled();
  });
});
