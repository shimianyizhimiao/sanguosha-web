#!/usr/bin/env python3
# 查 Fandom 上 SP / 一將成名 等武將清單頁，統計人數
import json, re, subprocess, urllib.parse

UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/120 Safari/537.36')


def api(params):
    q = urllib.parse.urlencode(params)
    r = subprocess.run(['curl', '-sSL', '--max-time', '60', '-A', UA,
                        'https://sanguosha.fandom.com/zh/api.php?' + q], capture_output=True)
    try:
        return json.loads(r.stdout.decode('utf-8', 'ignore'))
    except Exception:
        return {}


for q in ['SP武將', '一將成名', '界武將', '界限突破武將']:
    d = api({'action': 'opensearch', 'format': 'json', 'limit': '6', 'search': q})
    print(q, '→', d[1] if len(d) > 1 else '?')
