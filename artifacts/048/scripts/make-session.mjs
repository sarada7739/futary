// 048 段階1 の検証用: ローカル D1 にログイン済みのペア（2 人。paid の行）とアルバム 2 件を作り、
// 片方のセッションの Cookie の値を書き出す。本番では使わない。
//   node make-session.mjs <出力ファイル>
// 045 の make-session.mjs と同じ形。R2 には置かない（ローカルの署名付き URL は本物の R2 を指すので
// 置いても届かない。写真の実体は capture.mjs が Playwright の route で差し込む）。
// 出力ファイルには署名付きの Cookie が入るので artifacts/ には置かない（scratchpad へ）
//
// アルバム: 「京都旅行」3 枚（説明文あり: 1 枚目・3 枚目）/ 「沖縄/夏 2026」101 枚（説明文なし。ZIP が 2 つに分かれる）
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const apiDir = path.join(repoRoot, "apps", "api");
const args = process.argv.slice(2);
const [outFile = path.join(here, "session-cookie.txt")] = args.filter((a) => !a.startsWith("--"));

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

const now = Math.floor(Date.now() / 1000);
const COUPLE = "zip-couple";
const ME = "zip-user-me";
const PARTNER = "zip-user-partner";
const q = (v) => (v === null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);

// 前回の分を消してから入れる（何度でも実行できる）。couple_plans は couples より先（FK）
d1(
  [
    `DELETE FROM session WHERE user_id IN (${q(ME)}, ${q(PARTNER)});`,
    `DELETE FROM album_photos WHERE album_id IN (SELECT id FROM albums WHERE couple_id = ${q(COUPLE)});`,
    `DELETE FROM albums WHERE couple_id = ${q(COUPLE)};`,
    `DELETE FROM post_images WHERE post_id IN (SELECT id FROM posts WHERE couple_id = ${q(COUPLE)});`,
    `DELETE FROM posts WHERE couple_id = ${q(COUPLE)};`,
    `DELETE FROM couple_plans WHERE couple_id = ${q(COUPLE)};`,
    `DELETE FROM couple_members WHERE couple_id = ${q(COUPLE)};`,
    `DELETE FROM couples WHERE id = ${q(COUPLE)};`,
    `DELETE FROM account WHERE user_id IN (${q(ME)}, ${q(PARTNER)});`,
    `DELETE FROM user WHERE id IN (${q(ME)}, ${q(PARTNER)});`,
  ].join(" "),
);

const DAY = 24 * 60 * 60;
const dims = [
  [1024, 1536],
  [1536, 1024],
  [1536, 1024],
  [1536, 1024],
];

// 101 枚を超えると 1 文が長くなるので、アルバムごとに分けて流す
function albumSql(albumId, title, note, count, captions, startOffsetDays) {
  const start = new Date((now - startOffsetDays * DAY) * 1000).toISOString().slice(0, 10);
  const end = new Date((now - (startOffsetDays - 2) * DAY) * 1000).toISOString().slice(0, 10);
  const firstId = `${albumId.toUpperCase().replace(/-/g, "")}00000000001`.slice(0, 26);
  const rows = [
    `INSERT INTO albums (id, couple_id, title, note, start_date, end_date, cover_photo_id, created_by, created_at, updated_at) VALUES (${q(albumId)}, ${q(COUPLE)}, ${q(title)}, ${q(note)}, ${q(start)}, ${q(end)}, ${q(firstId)}, ${q(ME)}, ${now - startOffsetDays * DAY}, ${now - startOffsetDays * DAY});`,
  ];
  for (let i = 0; i < count; i++) {
    const id = `${albumId.toUpperCase().replace(/-/g, "")}${String(i + 1).padStart(11, "0")}`.slice(0, 26);
    const key = `couples/${COUPLE}/albums/${id}.jpg`;
    const [w, h] = dims[i % dims.length];
    rows.push(
      `INSERT INTO album_photos (id, album_id, key, width, height, caption, taken_at, created_at) VALUES (${q(id)}, ${q(albumId)}, ${q(key)}, ${w}, ${h}, ${q(captions[i] ?? "")}, ${now - startOffsetDays * DAY + 12 * 3600 + i * 600}, ${now - startOffsetDays * DAY});`,
    );
  }
  return rows.join(" ");
}

d1(
  [
    `INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (${q(ME)}, 'ゆう', 'zip-me@example.com', 1, ${now}, ${now}), (${q(PARTNER)}, 'さき', 'zip-partner@example.com', 1, ${now}, ${now});`,
    `INSERT INTO couples (id, dating_date, married_date, primary_date, is_demo, created_at) VALUES (${q(COUPLE)}, '2024-04-06', NULL, 'dating', 0, ${now});`,
    `INSERT INTO couple_members (couple_id, user_id, slot, joined_at) VALUES (${q(COUPLE)}, ${q(ME)}, 1, ${now}), (${q(COUPLE)}, ${q(PARTNER)}, 2, ${now});`,
    // 無料枠の 30 枚を超えるアルバムを持つので paid（045 の判定はサーバ側の追加時だけだが、画面の枠の表示を消す）
    `INSERT INTO couple_plans (couple_id, plan, source, expires_at, updated_at) VALUES (${q(COUPLE)}, 'paid', 'manual', NULL, ${now});`,
  ].join(" "),
);
d1(albumSql("zip-album-kyoto", "京都旅行", "紅葉の季節に", 3, ["夕暮れの伏見稲荷大社。二人で歩き切った達成感。", "", "抹茶パフェ\n二人で半分こ"], 40));
d1(albumSql("zip-album-okinawa", "沖縄/夏 2026", "", 101, [], 20));

// セッション（7日）
const token = Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString("base64url");
d1(
  `INSERT INTO session (id, expires_at, token, created_at, updated_at, ip_address, user_agent, user_id) VALUES (${q(`zip-session-${now}`)}, ${(now + 7 * DAY) * 1000}, ${q(token)}, ${now * 1000}, ${now * 1000}, NULL, 'capture', ${q(ME)});`,
);

const key = await webcrypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
const sig = Buffer.from(await webcrypto.subtle.sign("HMAC", key, new TextEncoder().encode(token))).toString("base64");
const cookieValue = encodeURIComponent(`${token}.${sig}`);
writeFileSync(outFile, cookieValue);
console.log("session cookie written:", outFile, "(user:", ME, ") albums: zip-album-kyoto (3), zip-album-okinawa (101)");
