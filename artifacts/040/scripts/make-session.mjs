// 040 段階1の撮影用: ローカル D1 にログイン済みのペア（2人）と、片方のセッションを作り、
// Better Auth の署名付き Cookie の値を書き出す。本番では使わない。
//   node make-session.mjs <出力ファイル>
// 出力ファイルには Cookie の値（署名付き）が入るので、artifacts/ には置かない（scratchpad へ）。
// 署名は better-call の signCookieValue と同じ形: `${token}.${base64(HMAC-SHA256(secret, token))}` を
// encodeURIComponent したもの。Cookie 名は http のため `better-auth.session_token`
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const apiDir = path.join(repoRoot, "apps", "api");
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
    `DELETE FROM wants WHERE couple_id = ${q(COUPLE)};`,
    `DELETE FROM couple_members WHERE couple_id = ${q(COUPLE)};`,
    `DELETE FROM couples WHERE id = ${q(COUPLE)};`,
    `DELETE FROM account WHERE user_id IN (${q(ME)}, ${q(PARTNER)});`,
    `DELETE FROM user WHERE id IN (${q(ME)}, ${q(PARTNER)});`,
  ].join(" "),
);

const imageKey = `couples/${COUPLE}/wants/shot-want-image-mug.jpg`;
r2put(imageKey, path.join(repoRoot, "packages", "db", "seed", "assets", "want-mug.jpg"));

const DAY = 24 * 60 * 60;
const wants = [
  // 相手（さき）のほしいもの。画像あり・URL あり・メモあり / 画像なし・URL あり / 手に入れた
  [`shot-want-1`, PARTNER, "ペアのマグカップ", "https://shop.example.com/items/pair-mug", "朝のコーヒー用。白い方がいい", imageKey, now - 2 * DAY, null],
  [`shot-want-2`, PARTNER, "オーバーサイズのニット", "https://shop.example.com/items/oversized-knit", "", null, now - 12 * DAY, null],
  [`shot-want-3`, PARTNER, "インテリアの写真集", "https://shop.example.com/items/interior-book", "", null, now - 30 * DAY, now - 8 * DAY],
  // 自分（ゆう）のほしいもの
  [`shot-want-4`, ME, "フィルムカメラ", "https://shop.example.com/items/film-camera", "旅行の前に。中古でもいい", null, now - 5 * DAY, null],
];

d1(
  [
    `INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (${q(ME)}, 'ゆう', 'shot-me@example.com', 1, ${now}, ${now}), (${q(PARTNER)}, 'さき', 'shot-partner@example.com', 1, ${now}, ${now});`,
    `INSERT INTO couples (id, dating_date, married_date, primary_date, is_demo, created_at) VALUES (${q(COUPLE)}, '2024-04-06', NULL, 'dating', 0, ${now});`,
    `INSERT INTO couple_members (couple_id, user_id, slot, joined_at) VALUES (${q(COUPLE)}, ${q(ME)}, 1, ${now}), (${q(COUPLE)}, ${q(PARTNER)}, 2, ${now});`,
    ...wants.map(
      ([id, owner, title, url, note, key, createdAt, obtainedAt]) =>
        `INSERT INTO wants (id, couple_id, owner_id, title, url, note, image_key, created_at, obtained_at) VALUES (${q(id)}, ${q(COUPLE)}, ${q(owner)}, ${q(title)}, ${q(url)}, ${q(note)}, ${q(key)}, ${createdAt}, ${obtainedAt ?? "NULL"});`,
    ),
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
console.log("session cookie written:", outFile, "(user:", ME, ")");
