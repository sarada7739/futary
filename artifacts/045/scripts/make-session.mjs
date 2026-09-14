// 045 の撮影用: ローカル D1/R2 にログイン済みのペア（2 人。プランの行なし = free）とアルバム 1 件
// （写真 N 枚。4 枚の見本を繰り返し置く）を作り、片方のセッションの Cookie の値を書き出す。本番では使わない。
//   node make-session.mjs <出力ファイル> [--used N]   （既定 N = 26 → 「あと 4 枚」）
// 041 の make-session.mjs と同じ形。出力ファイルには署名付きの Cookie が入るので artifacts/ には置かない（scratchpad へ）
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const apiDir = path.join(repoRoot, "apps", "api");
const assetsDir = path.join(repoRoot, "packages", "db", "seed", "assets");
const args = process.argv.slice(2);
const [outFile = path.join(here, "session-cookie.txt")] = args.filter((a) => !a.startsWith("--"));
const usedArg = args.find((a) => a.startsWith("--used="));
const USED = usedArg ? Number(usedArg.slice("--used=".length)) : 26;

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

// 前回の分を消してから入れる（何度でも実行できる）。couple_plans は couples より先（FK）
d1(
  [
    `DELETE FROM session WHERE user_id IN (${q(ME)}, ${q(PARTNER)});`,
    `DELETE FROM album_photos WHERE album_id IN (SELECT id FROM albums WHERE couple_id = ${q(COUPLE)});`,
    `DELETE FROM albums WHERE couple_id = ${q(COUPLE)};`,
    `DELETE FROM post_images WHERE post_id IN (SELECT id FROM posts WHERE couple_id = ${q(COUPLE)});`,
    `DELETE FROM posts WHERE couple_id = ${q(COUPLE)};`,
    `DELETE FROM wants WHERE couple_id = ${q(COUPLE)};`,
    `DELETE FROM couple_plans WHERE couple_id = ${q(COUPLE)};`,
    `DELETE FROM couple_members WHERE couple_id = ${q(COUPLE)};`,
    `DELETE FROM couples WHERE id = ${q(COUPLE)};`,
    `DELETE FROM account WHERE user_id IN (${q(ME)}, ${q(PARTNER)});`,
    `DELETE FROM user WHERE id IN (${q(ME)}, ${q(PARTNER)});`,
  ].join(" "),
);

const DAY = 24 * 60 * 60;
const photos = ["meetup-1.jpg", "meetup-2.jpg", "meetup-3.jpg", "meetup-4.jpg"];
const dims = { "meetup-1.jpg": [1024, 1536], "meetup-2.jpg": [1536, 1024], "meetup-3.jpg": [1536, 1024], "meetup-4.jpg": [1536, 1024] };

// アルバム 1 件（3 日間の旅行・写真 USED 枚。カバーは 1 枚目）
const ALBUM = "shot-album-trip";
const albumStart = new Date((now - 40 * DAY) * 1000).toISOString().slice(0, 10);
const albumEnd = new Date((now - 38 * DAY) * 1000).toISOString().slice(0, 10);
const albumSql = [
  `INSERT INTO albums (id, couple_id, title, note, start_date, end_date, cover_photo_id, created_by, created_at, updated_at) VALUES (${q(ALBUM)}, ${q(COUPLE)}, '京都旅行', '紅葉の季節に', ${q(albumStart)}, ${q(albumEnd)}, 'SHOTALBUMPHOTO00000000001', ${q(ME)}, ${now - 37 * DAY}, ${now - 37 * DAY});`,
];
for (let i = 0; i < USED; i++) {
  const file = photos[i % photos.length];
  const id = `SHOTALBUMPHOTO${String(i + 1).padStart(11, "0")}`;
  const key = `couples/${COUPLE}/albums/${id}.jpg`;
  r2put(key, path.join(assetsDir, file));
  const [w, h] = dims[file];
  const caption = i === 0 ? "夕暮れの伏見稲荷大社。二人で歩き切った達成感。" : "";
  albumSql.push(
    `INSERT INTO album_photos (id, album_id, key, width, height, caption, taken_at, created_at) VALUES (${q(id)}, ${q(ALBUM)}, ${q(key)}, ${w}, ${h}, ${q(caption)}, ${now - 40 * DAY + 12 * 3600 + i * 600}, ${now - 37 * DAY});`,
  );
}

d1(
  [
    `INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (${q(ME)}, 'ゆう', 'shot-me@example.com', 1, ${now}, ${now}), (${q(PARTNER)}, 'さき', 'shot-partner@example.com', 1, ${now}, ${now});`,
    `INSERT INTO couples (id, dating_date, married_date, primary_date, is_demo, created_at) VALUES (${q(COUPLE)}, '2024-04-06', NULL, 'dating', 0, ${now});`,
    `INSERT INTO couple_members (couple_id, user_id, slot, joined_at) VALUES (${q(COUPLE)}, ${q(ME)}, 1, ${now}), (${q(COUPLE)}, ${q(PARTNER)}, 2, ${now});`,
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
console.log("session cookie written:", outFile, "(user:", ME, ") album:", ALBUM, "used:", USED);
