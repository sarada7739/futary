# 041 段階2: iPhone では写真ライブラリに保存する（共有シート）— 実装の報告

2026-09-14 / セッションB。A の決定（#299。タスク定義 8節）に従って実装した。

## 作ったもの

- `apps/app/lib/photo-download.ts`: `downloadPhoto(ref)` の経路を分けた
  - `canShareFiles()`（`navigator.canShare({ files: [File] })`。PC・jsdom は偽）が真なら **署名付き URL を `fetch` → `Blob` → `File`（`filename`・`image/jpeg`）→ `navigator.share({ files: [file] })`**
  - 偽なら段階1のまま `<a href download>`
  - 共有シートを閉じた（`AbortError`）ときは何もしない。**それ以外の失敗（`fetch` の失敗・`NotAllowedError` 等）は `<a download>` に倒す**
  - `photo.downloadUrl` は変えていない（`filename` はそこから取る。`attachment` 付きの URL を `fetch` しても関係ない）
- `apps/api/r2-cors.json`: 実体に合わせた（`localhost:19006` を消し `https://futary-api.sarada7739.workers.dev` を足した）。A の決定 3。**apply は要らない**（実体は既に正しい。人間の `r2:cors:list` 2026-09-14）
- テスト: `apps/app/test/photo-download.test.ts`（8節の 4 点 + `canShare` 無し・`fetch` 失敗・`photo.downloadUrl` 失敗）。`post-card.test.tsx` の保存ボタンのテスト（jsdom は `canShare` 無し → `<a download>`）はそのまま緑

`pnpm --filter @futary/app test`: 396 緑。型チェック・lint 緑。

## B が決めたこと

1. **`AbortError` の判定は `error.name` だけで行う**（`instanceof Error` を挟まない）。jsdom の `DOMException` は `Error` を継承しておらず、テストで実際に判定を素通りした。Safari でも継承に頼らない方が安全
2. 共有の経路で失敗したら黙って `<a download>` に倒す（利用者には段階1と同じ画面が出る）。**段階0の観察はこれで足りる**（下記）
3. `canShareFiles()` の判定に空の `File` を 1 つ渡す（`canShare` は型と形だけを見る）

## 段階0（人間の iPhone。B は確かめられない）

**`await fetch` のあとの `navigator.share` が `NotAllowedError` にならないか。**実装は失敗時に `<a download>` へ倒すので、実機での見え方で判別できる:

| 保存を押したとき | 意味 |
|---|---|
| **共有シートが出て「画像を保存」で写真ライブラリに入る** | 通った。段階2はこれで完了 |
| 段階1と同じ「ダウンロード」の画面（"プレビュー"で開く / その他…）になる | `share` が拒まれた（`NotAllowedError`）か `fetch` が失敗した。8節の代替（表示中の 1 枚を先読みして押下で `share` だけ呼ぶ）に変える |

人間に頼むこと: 本番デプロイ後、アルバムかタイムラインのビューアで「保存」を 1 回押し、どちらの画面になったかを教えてほしい。

## やっていないこと

- 042（選んだ写真をまとめて写真ライブラリへ）は段階2の後
- 段階3（タイムラインの写真をアルバムに複製）は A が人間に要否を聞く
