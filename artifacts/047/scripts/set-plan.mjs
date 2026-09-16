// 047 の撮影用: ローカル D1 の shot-couple（045 の make-session.mjs が作る）の couple_plans を
// 猶予中（grace: 期限が 1 日前に切れた）/ 鍵の後（locked: 31 日前）/ paid に切り替える。本番では使わない。
//   node set-plan.mjs grace|locked|paid
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.resolve(here, "../../../apps/api");
const wranglerJs = path.join(apiDir, "node_modules", "wrangler", "bin", "wrangler.js");
const state = process.argv[2];
const now = Math.floor(Date.now() / 1000);
const DAY = 24 * 60 * 60;
const COUPLE = "shot-couple";

const rows = {
  grace: { plan: "free", expires: now - DAY },
  locked: { plan: "free", expires: now - 31 * DAY },
  paid: { plan: "paid", expires: now + 30 * DAY },
};
const row = rows[state];
if (!row) throw new Error("grace | locked | paid");

const sql = `INSERT INTO couple_plans (couple_id, plan, source, expires_at, updated_at) VALUES ('${COUPLE}', '${row.plan}', 'stripe', ${row.expires}, ${now})
  ON CONFLICT(couple_id) DO UPDATE SET plan = '${row.plan}', source = 'stripe', expires_at = ${row.expires}, updated_at = ${now};
  SELECT * FROM couple_plans WHERE couple_id = '${COUPLE}';`;
execFileSync(process.execPath, [wranglerJs, "d1", "execute", "DB", "--local", "--command", sql], { cwd: apiDir, stdio: "inherit" });
