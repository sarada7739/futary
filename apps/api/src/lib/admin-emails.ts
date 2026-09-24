// 運営のメール（ADMIN_EMAILS。wrangler secret）。コードにメールを書かない。比べるときは小文字化・trim。
// 空・未設定なら運営はいない（fail-closed。057）
export function parseAdminEmails(raw: string | undefined): readonly string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

export function isAdminEmail(email: string, adminEmails: readonly string[]): boolean {
  const normalized = email.trim().toLowerCase();
  return normalized.length > 0 && adminEmails.includes(normalized);
}
