#!/usr/bin/env bash
# 040 段階0: 計測の実行。引数に URL を並べる。各 URL × 2 UA × 3 回。結果は JSONL で標準出力へ
UA1='futary-link-preview/1 (+https://futary-api.sarada7739.workers.dev)'
UA2='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
for url in "$@"; do
  for ua in "$UA1" "$UA2"; do
    for i in 1 2 3; do
      r=$(curl -s -m 30 -G 'http://127.0.0.1:8799/' --data-urlencode "url=$url" --data-urlencode "ua=$ua")
      printf '{"run":%d,%s\n' "$i" "${r#\{}"
    done
  done
done
