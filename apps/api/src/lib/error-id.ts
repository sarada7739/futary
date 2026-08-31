import { ORPCError } from "@orpc/server";

// 想定外の例外（procedureのバグ・DBエラー等）がそのままクライアントへ
// 露出しないようにする（docs/tasks/016-release.md「エラー処理の統一」・
// docs/security-requirements.md 8節）。
//
// 対象はRPCHandler（/api/*のoRPC手続き）のみ。/api/auth/*（Better Auth）は
// このinterceptorsの外にあり、意図的に対象外にしている（付け忘れではない。
// Rレビュー全体監査指摘）。Better Authが投げた例外の詳細は既にHonoの既定
// （`c.text("Internal Server Error", 500)`）によりクライアントへ漏れないが、
// 問い合わせ用のIDは振られない
//
// oRPCの既定動作（toORPCError）は、ORPCErrorでない例外を"Internal server
// error"という固定メッセージのORPCErrorに変換する。この時点でスタック
// トレース・SQL文・ファイルパスはクライアントへのJSONに含まれず（ORPCError.toJSON()は
// defined/code/status/message/dataのみを返す）、実測でも確認済み。
// ただしメッセージが常に同一のため、利用者からの問い合わせと
// サーバログを突き合わせる手段が無い。ここでは想定外の例外だけに
// 一意のIDを振り、フルの詳細（スタックトレース含む）はサーバログにのみ出し、
// クライアントにはIDだけを返す。
//
// ORPCErrorのインスタンス（procedure側が意図的にthrowしたFORBIDDEN等）は
// そのまま素通しする（想定内のエラーはIDを振る対象ではない）。
//
// SyntaxErrorは素通しする。oRPCのRPCコーデックがリクエストボディの
// JSONパースに失敗したときに投げるもので、このハンドラより外側の
// StandardHandler内部でBAD_REQUEST（400）に変換される経路に乗っている
// （@orpc/server/dist/shared/server.CMf4nKky.mjs参照）。ここで拾って
// INTERNAL_SERVER_ERROR（500）に変えると、クライアントの不正な入力を
// サーバの異常として誤記録してしまう
export async function withErrorId<T>(next: () => Promise<T>): Promise<T> {
  try {
    return await next();
  } catch (error) {
    if (error instanceof ORPCError || error instanceof SyntaxError) throw error;
    const errorId = crypto.randomUUID();
    console.error(`[${errorId}]`, error);
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: `サーバ内部でエラーが発生しました。問い合わせる場合はこのIDを伝えてください: ${errorId}`,
    });
  }
}
