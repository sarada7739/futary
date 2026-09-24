// invite_failures のレート制限キー（schema/couple.ts）。Google の識別子（account_id）をそのまま入れず、
// BETTER_AUTH_SECRET を鍵にした HMAC-SHA256 にして保存する（DB を読める者が実在の Google アカウントを
// 引けず、他の漏洩データと突き合わせても同一人物と分からない）
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
