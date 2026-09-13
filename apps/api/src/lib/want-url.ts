// 040 タスク定義3節「URL の正規化」: Amazon だけ、`/dp/{ASIN}` を含む URL は
// `https://www.amazon.co.jp/dp/{ASIN}` に揃えて保存する（`?tag=…&th=1` のような
// 追跡パラメータを落とす。人間が貼った URL にもアフィリエイトの tag が付いていた）。
// 他の店は触らない。正規化の一般化はしない（店ごとの規則を集め始めると終わらない）

const AMAZON_JP_HOSTS = new Set(["amazon.co.jp", "www.amazon.co.jp"]);
const ASIN_PATH = /\/dp\/([A-Z0-9]{10})(?=[/?#]|$)/;

// Amazon（co.jp）の `/dp/{ASIN}` を含む URL なら正規形を返す。それ以外は null
export function canonicalAmazonUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!AMAZON_JP_HOSTS.has(url.hostname.toLowerCase())) return null;
  const match = url.pathname.match(ASIN_PATH);
  if (!match?.[1]) return null;
  return `https://www.amazon.co.jp/dp/${match[1]}`;
}

export function normalizeWantUrl(value: string): string {
  return canonicalAmazonUrl(value) ?? value;
}
