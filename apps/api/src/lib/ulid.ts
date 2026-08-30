// R2 のオブジェクトキーに使う imageId（architecture.md 6節: ULID）。
// invite-code.ts と同じ理由で crypto.getRandomValues を使い、Math.random() は使わない。
// Crockford's Base32（紛らわしい I/L/O/U を含まない）。文字集合が32文字（256 % 32 === 0）
// なのでバイト値を割った余りに偏りが出ない（invite-code.ts と同じ技法）
const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_LEN = 10;
const RANDOM_LEN = 16;

function encodeTime(time: number): string {
  let remaining = time;
  let str = "";
  for (let i = 0; i < TIME_LEN; i++) {
    const mod = remaining % 32;
    str = ENCODING[mod] + str;
    remaining = (remaining - mod) / 32;
  }
  return str;
}

function encodeRandom(): string {
  const bytes = new Uint8Array(RANDOM_LEN);
  crypto.getRandomValues(bytes);
  let str = "";
  for (const byte of bytes) {
    str += ENCODING[byte % ENCODING.length];
  }
  return str;
}

// 48bit のタイムスタンプ（先頭10文字。ミリ秒単位）+ 80bit の乱数（末尾16文字）。
// 生成時刻順に文字列としてもソート可能になる
// ULIDのミリ秒タイムスタンプ成分。JSTの暦日計算ではないためpackages/date対象外
// eslint-disable-next-line no-restricted-syntax
export function generateImageId(now: number = Date.now()): string {
  return encodeTime(now) + encodeRandom();
}
