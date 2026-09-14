# 045: プランの切り替え（運営が手で D1 に書く）

タスク定義 1節の SQL。**本番の D1 に書くので、人間の許可を取ってから。**行が無ければ free。CHECK は無く、判定は `apps/api/src/lib/plan.ts` の `resolvePlan` の 1 箇所（`plan = 'paid' AND (expires_at IS NULL OR expires_at > now)` だけが paid）。

## paid にする

```bash
pnpm --filter @futary/api exec wrangler d1 execute futary --remote \
  --command "INSERT INTO couple_plans (couple_id, plan, source, updated_at) VALUES ('<coupleId>', 'paid', 'manual', unixepoch()) ON CONFLICT(couple_id) DO UPDATE SET plan = 'paid', updated_at = unixepoch()"
```

## free に戻す

```bash
pnpm --filter @futary/api exec wrangler d1 execute futary --remote \
  --command "INSERT INTO couple_plans (couple_id, plan, source, updated_at) VALUES ('<coupleId>', 'free', 'manual', unixepoch()) ON CONFLICT(couple_id) DO UPDATE SET plan = 'free', updated_at = unixepoch()"
```

（行を消しても free。`DELETE FROM couple_plans WHERE couple_id = '<coupleId>'`）

## 確かめる

```bash
pnpm --filter @futary/api exec wrangler d1 execute futary --remote \
  --command "SELECT couple_id, plan, source, expires_at, updated_at FROM couple_plans WHERE couple_id = '<coupleId>'"
```

`<coupleId>` は本番の `couples.id`（人間のペア）。`me.delete` はこの行を `couples` より先に消す。

## ローカルで通した記録（2026-09-14）

`0023_couple_plans` をローカルに当てたあと、同じ文で `demo-couple` を paid → free → paid と切り替えた（`plan-switch-local.log`）:

```
--- paid
success: true
[{"couple_id":"demo-couple","plan":"paid","source":"manual","expires_at":null,"updated_at":1789368261}]
--- free
success: true
[{"couple_id":"demo-couple","plan":"free","source":"manual","expires_at":null,"updated_at":1789368263}]
--- paid
success: true
[{"couple_id":"demo-couple","plan":"paid","source":"manual","expires_at":null,"updated_at":1789368266}]
```

撮影（`stage1/`）でも `shot-couple` を同じ文で paid にし、使用量のカード・枠の行・警告が消えることを確かめた（`capture-paid.json`）。
