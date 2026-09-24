import { ORPCError } from "@orpc/server";

// 想定外の例外（手続きのバグ・DB エラー等）の詳細をクライアントへ出さない（security-requirements.md 8節）。
// oRPC の既定でもメッセージは固定の "Internal server error" になるが、それでは問い合わせとログを
// 突き合わせられない。想定外の例外にだけ一意の ID を振り、詳細はサーバログ、クライアントには ID だけ返す。
//
// - 対象は /api/* の oRPC 手続きだけ。/api/auth/*（Better Auth）はこの外で、詳細は Hono の既定で
//   漏れないが ID は振られない
// - ORPCError（意図して投げた FORBIDDEN 等）は素通し
// - SyntaxError も素通し。リクエストボディの JSON が壊れているときに oRPC が投げ、外側で 400 に変わる。
//   ここで 500 にすると利用者の不正な入力をサーバの異常として記録してしまう
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
