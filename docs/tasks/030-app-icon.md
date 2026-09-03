# 030: アプリアイコンと favicon を差し替える

## 目的

**人間が作ったアイコン画像を、ブラウザのタブと iPhone のホーム画面に出す。**

素材は `docs/sample/icon/` に置いた。

| ファイル | 何 |
|---|---|
| `futary-icon-source.png` | 人間が生成AIで作った元画像（1254×1254。角丸・外側は白） |
| `futary-icon-square-1024.png` | **角の白を背景で埋めた正方形版**（1024×1024）。**アイコンにはこちらを使う** |

## 1. なぜ正方形版を作ったか

**元画像は角が丸く、その外側が白い。**

**iOS はホーム画面のアイコンに自分でマスクをかける。**
元画像の角丸（実測で半径 24.5%）は **iOS のマスク（約 22.4%）より丸い**ため、
**四隅に白い欠けが出る。**

**角を自分で丸めない。**四隅まで塗った正方形を渡し、**丸めるのは OS に任せる。**

## 2. 出すところは2つある

**`/`（ランディング）と `/app/*`（アプリ本体）は別のHTMLである。**

**iPhone で「ホーム画面に追加」するのはアプリ側（`/app/`）である。**
ランディングだけ直しても、**ホーム画面のアイコンは変わらない。**

| | いま | やること |
|---|---|---|
| `/`（`apps/landing/index.html`） | `<link rel="icon">` だけ | **`apple-touch-icon` を足す** |
| `/app/*`（Expo の Web エクスポート） | `app.json` の `web.favicon` だけ | **`apps/app/app/+html.tsx` を新設して足す** |

**`+html.tsx` は今このリポジトリに無い。**Expo Router の既定テンプレートが使われている。
**新設して、既定に無い `<link>` を入れる。**

## 3. 作る画像

すべて `futary-icon-square-1024.png` から縮小する。

| ファイル | サイズ | 用途 |
|---|---|---|
| `favicon.png` | 48×48 | ブラウザのタブ |
| `apple-touch-icon.png` | 180×180 | **iPhone のホーム画面** |
| `icon-192.png` | 192×192 | manifest |
| `icon-512.png` | 512×512 | manifest |

- **`apps/landing/assets/` と `apps/app/assets/` の両方に要る**
  （別のHTMLから参照されるため）
- `apps/app/assets/icon.png`（Expo のネイティブ用。1024×1024）も
  **正方形版に差し替える。**いま Web しか出していないので効かないが、
  **元と揃っていないものを残さない**
- **`apps/app/assets/android-icon-*.png` は触らない。**
  背景色が `#E6F4FE`（青系）でブランドと合っていないが、
  **Android ネイティブは出していない。**このタスクの範囲ではない

## 4. `display: standalone` にしない

manifest は置くが、**`"display": "browser"` にする。**

**`standalone` にすると、ホーム画面から開いたときに Safari の枠が消える。**
そのとき **Google ログインの遷移が別の入れ物に飛んで戻ってこないこと**がある。

**アイコンを変えたいだけである。開き方は変えない。**

`manifest.webmanifest` に入れるもの:
- `name` = `futary`、`short_name` = `futary`
- `icons` = 192 と 512
- `display` = `browser`
- `theme_color` = `#F5868D`（`primary`）、`background_color` = `#FEF6F3`（`bg`）

`<meta name="apple-mobile-web-app-title" content="futary" />` は入れてよい
（**ホーム画面に出る名前**。開き方は変えない）。
**`apple-mobile-web-app-capable` は入れない**（上の理由）。

## 5. 配信の経路を確かめる

- `scripts/build-public.mjs` は `apps/landing/assets` を丸ごとコピーしている。
  **`manifest.webmanifest` を `apps/landing/` 直下に置くなら、コピー対象に入るか確かめる**
  （入らないなら `assets/` に置くか、コピー処理を足す）
- **`_headers` の CSP を確かめる。**画像は同一オリジンだが、
  **manifest は `manifest-src` が要る場合がある。**
  **「たぶん通る」で終わらせず、`wrangler dev` に実ビルドを配信させて確かめる**
- **`/app/` の `experiments.baseUrl` があるため、`/app/*` から参照するパスは
  `/app/...` になる。**ランディングと同じ絶対パスを書くと外れる。
  **実際に配信して 200 が返ることを見る**

## 確認観点
- ブラウザのタブに出るか（`/` と `/app/` の両方）
- **iPhone で「ホーム画面に追加」したときに、このアイコンが出るか**
  （**人間の実機確認。B は iPhone Safari を触れない**）
- **四隅に白い欠けが出ていないか**
- ホーム画面から開いたとき、**Safari の枠が残っているか**（`standalone` にしていない）
- **ログインが通るか**（開き方を変えていないことの確認）

## 完了条件
- [ ] `/` と `/app/*` の両方でタブのアイコンが変わっている
- [ ] 両方に `apple-touch-icon` がある
- [ ] `manifest.webmanifest` があり、`display` が `browser`
- [ ] 画像が `futary-icon-square-1024.png` から作られている（角丸の元画像からではない）
- [ ] `wrangler dev` の実ビルドで、参照している全パスが 200 を返す
- [ ] `artifacts/030/manual-check.md` に**人間の実機確認項目**（iPhone のホーム画面）を書く

## 停止条件
- 完了: 上記をすべて満たす
- 中断: レビュー往復が3回を超えた場合、`docs/state.md` に論点を記載して A へエスカレーション

## 進捗
- [ ] 画像の書き出し（両方の `assets/`）
- [ ] `apps/landing/index.html`
- [ ] `apps/app/app/+html.tsx`（新設）
- [ ] `manifest.webmanifest`
- [ ] 実ビルドでの配信確認
- [ ] 証跡保存 → `state.md` 更新 → `worklog.md` 追記
