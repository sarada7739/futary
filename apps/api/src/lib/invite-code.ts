// 招待コード生成。security-requirements.md 4節: crypto.getRandomValues を使い、
// Math.random() は使わない。紛らわしい文字（0/O、1/I/l）を除いた文字集合を使う
const INVITE_CODE_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const INVITE_CODE_LENGTH = 6;

// 文字集合が32文字（256 % 32 === 0）なのでバイト値を割った余りに偏りが出ない
export function generateInviteCode(): string {
  const bytes = new Uint8Array(INVITE_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = "";
  for (const byte of bytes) {
    code += INVITE_CODE_CHARS[byte % INVITE_CODE_CHARS.length];
  }
  return code;
}
