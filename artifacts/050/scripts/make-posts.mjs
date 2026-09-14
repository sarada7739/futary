// 050 の撮影用: 048 の make-session.mjs が作ったペア（zip-couple）に投稿 4 件を入れる。本番では使わない。
//   node make-posts.mjs
// 新しい順に: 4 枚 / 横長 1 枚 / 縦長 1 枚 / 文字 1 行（一番下 = 一番古い。撮影は上から順に測る）。
// 画像の実体は置かない（署名付き URL は本物の R2 を指す。capture.mjs が route で見本の JPEG を返す）
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const apiDir = path.join(repoRoot, "apps", "api");
const wranglerJs = path.join(apiDir, "node_modules", "wrangler", "bin", "wrangler.js");
function d1(sql) {
  execFileSync(process.execPath, [wranglerJs, "d1", "execute", "DB", "--local", "--command", sql], { cwd: apiDir, stdio: ["ignore", "ignore", "inherit"] });
}
const now = Math.floor(Date.now() / 1000);
const COUPLE = "zip-couple";
const ME = "zip-user-me";
const PARTNER = "zip-user-partner";
const q = (v) => `'${String(v).replace(/'/g, "''")}'`;

d1(
  [
    `DELETE FROM post_images WHERE post_id IN (SELECT id FROM posts WHERE couple_id = ${q(COUPLE)});`,
    `DELETE FROM reactions WHERE post_id IN (SELECT id FROM posts WHERE couple_id = ${q(COUPLE)});`,
    `DELETE FROM posts WHERE couple_id = ${q(COUPLE)};`,
  ].join(" "),
);

// key の末尾（imageId）の数字で capture.mjs が見本を選ぶ: 1 = 縦長（meetup-1 1024×1536）、2〜4 = 横長（1536×1024）
const posts = [
  { id: "dens-post-text", author: ME, body: "今日はいい天気だったね", at: now - 4 * 3600, images: [] },
  { id: "dens-post-portrait", author: PARTNER, body: "海に行ってきた", at: now - 3 * 3600, images: [[1, 1024, 1536]] },
  { id: "dens-post-landscape", author: ME, body: "夕焼けがきれい", at: now - 2 * 3600, images: [[2, 1536, 1024]] },
  { id: "dens-post-four", author: PARTNER, body: "4 枚まとめて", at: now - 1 * 3600, images: [[1, 1024, 1536], [2, 1536, 1024], [3, 1536, 1024], [4, 1536, 1024]] },
];
const sql = [];
for (const p of posts) {
  sql.push(`INSERT INTO posts (id, couple_id, author_id, body, created_at, deleted_at) VALUES (${q(p.id)}, ${q(COUPLE)}, ${q(p.author)}, ${q(p.body)}, ${p.at}, NULL);`);
  p.images.forEach(([n, w, h], i) => {
    const key = `couples/${COUPLE}/posts/${p.id.toUpperCase().replace(/-/g, "")}${String(n).padStart(3, "0")}P${i}.jpg`;
    sql.push(`INSERT INTO post_images (post_id, position, key, width, height) VALUES (${q(p.id)}, ${i}, ${q(key)}, ${w}, ${h});`);
  });
}
d1(sql.join(" "));
console.log("posts:", posts.map((p) => p.id).join(", "));
