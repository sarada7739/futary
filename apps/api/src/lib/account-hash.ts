// invite_failures のレート制限キー（024・Aの決定。packages/db/src/schema/couple.ts
// のinviteFailuresコメント参照）。Google側の識別子（account.account_id）を
// そのまま列に入れず、BETTER_AUTH_SECRETで鍵付けしたHMAC-SHA256のハッシュに
// してから保存する。DBへの読み取りアクセスを持つ者が、招待の失敗履歴から
// 実在のGoogleアカウントIDを直接引けないようにするため（塩無しのハッシュや
// account_idそのままの保存では、外部の別データ漏洩とだけ突き合わせても
// 同一人物であることが分かってしまう）
export async function hashAccountId(secret: string, accountId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(accountId));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
