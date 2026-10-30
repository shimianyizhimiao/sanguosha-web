#!/bin/bash
# 收工：關掉測試用的共用 Chrome，把暫存 profile 清掉（不影響你自己的 Chrome）
pkill -f "user-data-dir=.*sgs-chrome" 2>/dev/null
sleep 1
rm -rf /tmp/sgs-net-* /tmp/sgs-probe* /tmp/sgs-live 2>/dev/null
echo "測試用 Chrome 已關閉"
