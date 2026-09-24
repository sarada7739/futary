// R2 のオブジェクトキーに使う imageId（ULID。architecture.md 6節）。Math.random() でなく crypto.getRandomValues。
// Crockford's Base32（紛らわしい I/L/O/U を含まない）。32 文字（256 % 32 === 0）なので余りに偏りが出ない
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

// 48bit のタイムスタンプ（先頭 10 文字。ミリ秒）+ 80bit の乱数（末尾 16 文字）。文字列でも時刻順に並ぶ
export function generateImageId(now: number = Date.now()): string {
  return encodeTime(now) + encodeRandom();
}
