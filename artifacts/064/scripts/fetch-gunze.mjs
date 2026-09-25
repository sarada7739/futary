// 064: デモの「ほしいもの」の画像（グンゼ）を 1 度だけ取る。抽出は 040 の link-preview と同じ関数
// （apps/api/src/lib/link-preview.ts の extractMeta。Amazon は data-old-hires）を使う。
//   node artifacts/064/scripts/fetch-gunze.mjs <出力先の元画像>
// 取ったあと resize-gunze.py で 800×800・品質 82 にして packages/db/seed/assets/want-gunze.jpg に置く
import { writeFileSync } from "node:fs";
import { extractMeta, LINK_PREVIEW_USER_AGENT } from "../../../apps/api/src/lib/link-preview.ts";

const PAGE = "https://www.amazon.co.jp/dp/B00F2G8ZLS";
const [out = "gunze-original.jpg"] = process.argv.slice(2);

const page = await fetch(PAGE, { headers: { "user-agent": LINK_PREVIEW_USER_AGENT, accept: "text/html" } });
const html = await page.text();
const meta = extractMeta(html, new URL(page.url).hostname);
console.log(`page: ${page.status} ${page.url}`);
console.log(`title: ${meta.title}`);
console.log(`image: ${meta.imageUrl}`);
if (!meta.imageUrl) {
  console.error("画像が取れない（ボット対策の画面の可能性）。A へ");
  process.exit(1);
}
const image = await fetch(meta.imageUrl, { headers: { "user-agent": LINK_PREVIEW_USER_AGENT } });
const bytes = new Uint8Array(await image.arrayBuffer());
console.log(`image: ${image.status} ${image.headers.get("content-type")} ${bytes.length} bytes`);
writeFileSync(out, bytes);
