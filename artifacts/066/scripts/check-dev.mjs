// 066 T4: hono と wrangler を上げたあと、wrangler dev（http://localhost:8787）で Worker が今まで通り動くかを見る。
//   node artifacts/066/scripts/check-dev.mjs <session-cookie ファイル>
// Cookie は artifacts/045/scripts/make-session.mjs が作る（ローカル D1 の撮影用ペア。本番では使わない）。
// Google の画面には進まない（ログインの入口が accounts.google.com への URL を返すところまで）
import { readFileSync } from "node:fs";

const base = "http://localhost:8787";
const origin = "http://localhost:8081";
const [cookieFile] = process.argv.slice(2);
const cookie = `better-auth.session_token=${readFileSync(cookieFile, "utf8").trim()}`;
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "OK  " : "NG  "} ${name}${detail ? ` — ${detail}` : ""}`);
}
async function rpc(path, json, withCookie = true) {
  const res = await fetch(`${base}/api/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, ...(withCookie ? { cookie } : {}) },
    body: JSON.stringify({ json }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

// 1. LP と /app/
for (const path of ["/", "/app/"]) {
  const res = await fetch(`${base}${path}`);
  const html = await res.text();
  check(`GET ${path}`, res.status === 200 && html.includes("<html"), `${res.status}・CSP ${res.headers.get("content-security-policy") ? "あり" : "なし"}`);
}

// 2. ログインの入口: Google へのリダイレクト先を返す（ここで止める）
{
  const res = await fetch(`${base}/api/auth/sign-in/social`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ provider: "google", callbackURL: `${origin}/` }),
  });
  const body = await res.json().catch(() => null);
  check("POST /api/auth/sign-in/social（google）", res.status === 200 && String(body?.url).startsWith("https://accounts.google.com/"), `${res.status}・${String(body?.url).slice(0, 40)}…`);
}

// 3. セッションで本人が取れる
{
  const res = await fetch(`${base}/api/auth/get-session`, { headers: { cookie, origin } });
  const body = await res.json().catch(() => null);
  check("GET /api/auth/get-session（ログイン中）", res.status === 200 && body?.user?.id === "shot-user-me", `${res.status}・user ${body?.user?.id}`);
}

// 4. 投稿 1 件 → 一覧に出る
{
  const text = `066 の確認 ${new Date().toISOString()}`;
  const created = await rpc("post/create", { body: text });
  check("POST /api/post/create", created.status === 200 && created.body?.json?.body === text, `${created.status}`);
  const list = await rpc("post/list", {});
  const found = list.body?.json?.items?.some((p) => p.body === text);
  check("POST /api/post/list に今の投稿がある", list.status === 200 && found === true, `${list.status}`);
  const anonymous = await rpc("post/create", { body: "未認証" }, false);
  check("未認証の post.create は拒まれる", anonymous.status === 403, `${anonymous.status}`);
}

// 5. ログアウト → 同じ Cookie では本人が取れない
{
  const out = await fetch(`${base}/api/auth/sign-out`, { method: "POST", headers: { cookie, origin, "content-type": "application/json" }, body: "{}" });
  check("POST /api/auth/sign-out", out.status === 200, `${out.status}`);
  const res = await fetch(`${base}/api/auth/get-session`, { headers: { cookie, origin } });
  const body = await res.json().catch(() => null);
  check("ログアウト後の get-session は空", res.status === 200 && (body === null || !body?.user), `${res.status}・${JSON.stringify(body)}`);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} / ${results.length} OK`);
process.exit(failed === 0 ? 0 : 1);
