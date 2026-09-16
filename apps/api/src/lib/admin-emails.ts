// 057: 運営のメール（ADMIN_EMAILS。wrangler secret。カンマ区切り）。コードにメールを書かない。
// 比べるときは小文字化・trim（大文字小文字・前後の空白の違いで漏れない。T1）。
// 空・未設定なら運営はいない（fail-closed）
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
