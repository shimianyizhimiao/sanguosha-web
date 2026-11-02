#!/usr/bin/env python3
"""每次部署前跑一次：把 index.html 的 ?v=... 換成現在的版本號。
瀏覽器（尤其手機）會死抱舊的 js/css，改完不換號碼，使用者永遠看到舊版。"""
import re, sys, time, pathlib
p = pathlib.Path(__file__).resolve().parents[1] / 'index.html'
ver = sys.argv[1] if len(sys.argv) > 1 else time.strftime('%Y%m%d%H%M')
s = p.read_text(encoding='utf-8')
s2, n = re.subn(r'(\?v=)[0-9A-Za-z.\-]+', r'\g<1>' + ver, s)
s2, m = re.subn(r'(netbuild">build )[0-9A-Za-z.\-]+', r'\g<1>' + ver, s2)
p.write_text(s2, encoding='utf-8')
print(f'{p.name}: {n} 個檔案標記 {ver}，build 標籤 {m} 處')
