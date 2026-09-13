// 041 段階1の撮影用: ローカル D1 にログイン済みのペア（2人）・写真付きの投稿・アルバム 1 件（写真 3 枚）と、
// 片方のセッションを作り、Better Auth の署名付き Cookie の値を書き出す。本番では使わない。
//   node make-session.mjs <出力ファイル>
// 出力ファイルには Cookie の値（署名付き）が入るので、artifacts/ には置かない（scratchpad へ）。
// 040 の make-session.mjs と同じ形（署名は better-call の signCookieValue と同じ）
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const apiDir = path.join(repoRoot, "apps", "api");
const assetsDir = path.join(repoRoot, "packages", "db", "seed", "assets");
const [outFile = path.join(here, "session-cookie.txt")] = process.argv.slice(2);

const devVars = readFileSync(path.join(apiDir, ".dev.vars"), "utf8");
const secret = devVars.match(/^BETTER_AUTH_SECRET=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, "");
if (!secret) throw new Error(".dev.vars に BETTER_AUTH_SECRET が無い");

const wranglerJs = path.join(apiDir, "node_modules", "wrangler", "bin", "wrangler.js");
function d1(sql) {
  execFileSync(process.execPath, [wranglerJs, "d1", "execute", "DB", "--local", "--command", sql], {
    cwd: apiDir,
    stdio: ["ignore", "ignore", "inherit"],
  });
}
function r2put(key, file) {
  execFileSync(
    process.execPath,
    [wranglerJs, "r2", "object", "put", `futary-images/${key}`, "--file", file, "--content-type", "image/jpeg", "--local"],
    { cwd: apiDir, stdio: ["ignore", "ignore", "inherit"] },
  );
}

const now = Math.floor(Date.now() / 1000);
const COUPLE = "shot-couple";
const ME = "shot-user-me";
const PARTNER = "shot-user-partner";
const q = (v) => (v === null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);

// 前回の分を消してから入れる（何度でも実行できる）
d1(
  [
    `DELETE FROM session WHERE user_id IN (${q(ME)}, ${q(PARTNER)});`,
    `DELETE FROM album_photos WHERE album_id IN (SELECT id FROM albums WHERE couple_id = ${q(COUPLE)});`,
    `DELETE FROM albums WHERE couple_id = ${q(COUPLE)};`,
    `DELETE FROM post_images WHERE post_id IN (SELECT id FROM posts WHERE couple_id = ${q(COUPLE)});`,
    `DELETE FROM posts WHERE couple_id = ${q(COUPLE)};`,
    `DELETE FROM wants WHERE couple_id = ${q(COUPLE)};`,
    `DELETE FROM couple_members WHERE couple_id = ${q(COUPLE)};`,
    `DELETE FROM couples WHERE id = ${q(COUPLE)};`,
    `DELETE FROM account WHERE user_id IN (${q(ME)}, ${q(PARTNER)});`,
    `DELETE FROM user WHERE id IN (${q(ME)}, ${q(PARTNER)});`,
  ].join(" "),
);

const DAY = 24 * 60 * 60;
const photos = ["meetup-1.jpg", "meetup-2.jpg", "meetup-3.jpg", "meetup-4.jpg"];
const dims = { "meetup-1.jpg": [1024, 1536], "meetup-2.jpg": [1536, 1024], "meetup-3.jpg": [1536, 1024], "meetup-4.jpg": [1536, 1024] };

// 写真付きの投稿 3 件（タイムラインのアルバムに 1+2+4 = 7 枚が集まる）
const posts = [
  ["shot-post-1", ME, "海辺まで歩いた", now - 3 * DAY, ["meetup-1.jpg"]],
  ["shot-post-2", PARTNER, "紅葉のベンチで", now - 10 * DAY, ["meetup-2.jpg", "meetup-3.jpg"]],
  ["shot-post-3", ME, "桜並木の朝", now - 20 * DAY, ["meetup-4.jpg", "meetup-1.jpg", "meetup-2.jpg", "meetup-3.jpg"]],
];
const postSql = [];
let seq = 0;
for (const [id, author, body, createdAt, files] of posts) {
  postSql.push(`INSERT INTO posts (id, couple_id, author_id, body, created_at) VALUES (${q(id)}, ${q(COUPLE)}, ${q(author)}, ${q(body)}, ${createdAt});`);
  files.forEach((file, position) => {
    seq += 1;
    const key = `couples/${COUPLE}/posts/shot-post-image-${seq}.jpg`;
    r2put(key, path.join(assetsDir, file));
    const [w, h] = dims[file];
    postSql.push(`INSERT INTO post_images (post_id, position, key, width, height) VALUES (${q(id)}, ${position}, ${q(key)}, ${w}, ${h});`);
  });
}

// アルバム 1 件（3 日間の旅行・写真 3 枚。カバーは 1 枚目）と、空のアルバム 1 件
const ALBUM = "shot-album-trip";
const albumStart = new Date((now - 40 * DAY) * 1000).toISOString().slice(0, 10);
const albumEnd = new Date((now - 38 * DAY) * 1000).toISOString().slice(0, 10);
const albumSql = [
  `INSERT INTO albums (id, couple_id, title, note, start_date, end_date, cover_photo_id, created_by, created_at, updated_at) VALUES (${q(ALBUM)}, ${q(COUPLE)}, '京都旅行', '紅葉の季節に', ${q(albumStart)}, ${q(albumEnd)}, 'SHOTALBUMPHOTO00000000001', ${q(ME)}, ${now - 37 * DAY}, ${now - 37 * DAY});`,
  `INSERT INTO albums (id, couple_id, title, note, start_date, end_date, cover_photo_id, created_by, created_at, updated_at) VALUES ('shot-album-empty', ${q(COUPLE)}, '誕生日', '', NULL, NULL, NULL, ${q(PARTNER)}, ${now - 2 * DAY}, ${now - 2 * DAY});`,
];
photos.slice(0, 3).forEach((file, i) => {
  const id = `SHOTALBUMPHOTO0000000000${i + 1}`;
  const key = `couples/${COUPLE}/albums/${id}.jpg`;
  r2put(key, path.join(assetsDir, file));
  const [w, h] = dims[file];
  const caption = i === 0 ? "夕暮れの伏見稲荷大社。二人で歩き切った達成感。" : "";
  albumSql.push(
    `INSERT INTO album_photos (id, album_id, key, width, height, caption, taken_at, created_at) VALUES (${q(id)}, ${q(ALBUM)}, ${q(key)}, ${w}, ${h}, ${q(caption)}, ${now - (40 - i) * DAY + 12 * 3600}, ${now - 37 * DAY});`,
  );
});

d1(
  [
    `INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (${q(ME)}, 'ゆう', 'shot-me@example.com', 1, ${now}, ${now}), (${q(PARTNER)}, 'さき', 'shot-partner@example.com', 1, ${now}, ${now});`,
    `INSERT INTO couples (id, dating_date, married_date, primary_date, is_demo, created_at) VALUES (${q(COUPLE)}, '2024-04-06', NULL, 'dating', 0, ${now});`,
    `INSERT INTO couple_members (couple_id, user_id, slot, joined_at) VALUES (${q(COUPLE)}, ${q(ME)}, 1, ${now}), (${q(COUPLE)}, ${q(PARTNER)}, 2, ${now});`,
    ...postSql,
    ...albumSql,
  ].join(" "),
);

// セッション（7日）
const token = Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString("base64url");
d1(
  `INSERT INTO session (id, expires_at, token, created_at, updated_at, ip_address, user_agent, user_id) VALUES (${q(`shot-session-${now}`)}, ${(now + 7 * DAY) * 1000}, ${q(token)}, ${now * 1000}, ${now * 1000}, NULL, 'capture', ${q(ME)});`,
);

const key = await webcrypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
const sig = Buffer.from(await webcrypto.subtle.sign("HMAC", key, new TextEncoder().encode(token))).toString("base64");
const cookieValue = encodeURIComponent(`${token}.${sig}`);
writeFileSync(outFile, cookieValue);
console.log("session cookie written:", outFile, "(user:", ME, ") album:", ALBUM);
