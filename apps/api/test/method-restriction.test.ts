import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import app from "../src/index";
import type { Bindings } from "../src/index";

// oRPC の RPCHandler は既定（strictGetMethodPluginEnabled を渡さない場合）で
// StrictGetMethodPlugin を自動登録しており、GET経由での書き込み手続き実行は
// 元々拒否されている（M2まとめ監査で「GETが通ってしまう」という誤ったHigh
// 指摘が出たが、Rレビューで既定値を確認し誤りと判明した。詳細は
// docs/security-report.md M2まとめ監査エントリのHigh行参照）。
// apps/api/src/index.ts での明示登録（ライブラリの既定に依存しない防御。
// 既定の自動登録と合わせて2重登録になるが実害は無い）がこの動作を固定して
// いることを、実際に Hono の app.fetch を経由して検証する（call() 経由の
// テストでは HTTP メソッドという概念自体が無いため、ここでは HTTP レイヤー
// ごと確認する）
describe("書き込み手続きは GET で実行できない（fix/reject-get-writes）", () => {
  it("GET経由で couple.update を呼ぶと METHOD_NOT_SUPPORTED（405）になり、手続きは実行されない", async () => {
    const data = encodeURIComponent(JSON.stringify({ json: { datingDate: "2020-01-01" } }));
    const response = await app.fetch(
      new Request(`http://localhost/api/couple/update?data=${data}`, { method: "GET" }),
      env as unknown as Bindings,
    );

    expect(response.status).toBe(405);
    const body = await response.json();
    expect(body).toMatchObject({ json: { code: "METHOD_NOT_SUPPORTED" } });
  });

  it("同じ入力を POST で送れば通常どおり手続きが実行される（未認証のため FORBIDDEN で拒否される）", async () => {
    const response = await app.fetch(
      new Request("http://localhost/api/couple/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          json: { datingDate: "2020-01-01", marriedDate: null, primaryDate: "dating" },
        }),
      }),
      env as unknown as Bindings,
    );

    // GET のときの 405（METHOD_NOT_SUPPORTED）とは異なるエラーコードで拒否される
    // ＝ POST は StrictGetMethodPlugin を通過し、通常の認可判定に到達している証拠
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toMatchObject({ json: { code: "FORBIDDEN" } });
  });

  it("GET経由で invite.issue を呼んでも METHOD_NOT_SUPPORTED になる", async () => {
    const response = await app.fetch(
      new Request("http://localhost/api/invite/issue?data=%7B%22json%22%3Anull%7D", { method: "GET" }),
      env as unknown as Bindings,
    );

    expect(response.status).toBe(405);
    const body = await response.json();
    expect(body).toMatchObject({ json: { code: "METHOD_NOT_SUPPORTED" } });
  });
});
