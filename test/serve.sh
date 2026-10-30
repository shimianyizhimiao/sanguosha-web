#!/bin/bash
# 確保本機測試伺服器在跑（跑測試前先呼叫這個，不要每次重開一個）
PORT="${1:-8125}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if curl -s -m 2 -o /dev/null "http://127.0.0.1:${PORT}/index.html"; then
  echo "伺服器已在跑：${PORT}"
  exit 0
fi

cd "$ROOT" || exit 1
mkdir -p /tmp/sgs-logs
nohup python3 -m http.server "$PORT" --bind 127.0.0.1 >/tmp/sgs-logs/server.log 2>&1 &
disown 2>/dev/null || true

for _ in $(seq 1 20); do
  sleep 0.3
  if curl -s -m 2 -o /dev/null "http://127.0.0.1:${PORT}/index.html"; then
    echo "伺服器已啟動：${PORT}"
    exit 0
  fi
done
echo "伺服器起不來（看 /tmp/sgs-logs/server.log）" >&2
exit 1
