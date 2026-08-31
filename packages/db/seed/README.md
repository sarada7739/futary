# デモペアのシード

`docs/tasks/014-guest-demo.md` の実装。`demo.ts` がデータを組み立て、
`run.ts` がローカル（`pnpm --filter @futary/db seed:local`）または
本番（`pnpm --filter @futary/db seed:remote`。016で使う）のD1・R2へ投入する。

## 画像の出自

`assets/` に置いた画像はすべて `docs/sample/` の原本から、
長辺1600px・JPEG品質0.8（`architecture.md` 6節と同じ規則）で一度だけ圧縮したもの。
原本の出自と権利については `docs/sample/README.md` を参照する
（すべてAI生成。実在の人物・実在の著作物ではない）。

| ファイル | 原本 |
|---|---|
| `avatar-woman.jpg` | `docs/sample/プロフィール画像/woman1.jpg` |
| `avatar-man.jpg` | `docs/sample/プロフィール画像/man1.jpg` |
| `meetup-1.jpg` | `docs/sample/風景/2wHbOTDy.jpg`（桜並木を歩く男女） |
| `meetup-2.jpg` | `docs/sample/風景/RcmUGlPg.jpg`（夕暮れの海辺に立つ男女） |
| `meetup-3.jpg` | `docs/sample/風景/dCm9y8so.jpg`（湖と桟橋、朝もや。人物なし） |
| `meetup-4.jpg` | `docs/sample/風景/nzcsgTL1.jpg`（紅葉のベンチに座る男女） |

**`docs/sample/風景/` の6枚中2枚は使わない。**`eHaCqEMx.jpg`
（架空のブランド看板が写り込む。`docs/sample/README.md` で既に除外指定）に加え、
**`Y5dn1UKP.jpg`（カフェのテラス席）も使わない。**実在しそうな店名の看板
「Café de lumière」と営業時間が明瞭に写り込んでおり、実在の店舗・商標かを
確認できていない。`eHaCqEMx.jpg` と同じ理由で公開物（デモは016で公開前提）
には使わない（security-auditor指摘。014実装時に発見）。**残り4枚だけを使う**ため、
写真付き投稿はタスク定義の目安「5〜8件」ではなく4件になる。

## 冪等性

`run.ts` は投入の前に **DEMO_COUPLE_ID が実際に `is_demo=1` を指していることを
確認してから**（`is_demo=0`の行や既存の別ペアを指していれば中断する。
security-auditor指摘）、そのIDに属する行を外部キーの順に全て削除して作り直す。
何度実行しても結果は同じになる
（`docs/tasks/014-guest-demo.md`「シードは何度でも実行できること」）。

## 決定的である理由

日付は乱数を使わず、実行時点の「今日」からの相対オフセットだけで組み立てる
（`packages/date` の関数のみを使う。`new Date(...)` を直接書かない）。
同じ日に実行すれば同じ結果になる。会った日（`meetup`）の間隔も固定（6日おき）
のため、同じ日に重複する経路が無い。
