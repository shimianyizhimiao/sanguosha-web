#!/usr/bin/env python3
# 為指定武將產生 3 種裁切候選，並輸出對照頁（人工挑選用）
import json, os, subprocess, sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, 'assets', 'portraits')
SRC = os.path.join(OUT, 'src')
CAND = os.path.join(BASE, 'shots', 'cand')
os.makedirs(CAND, exist_ok=True)

FIX = ['黃月英', '張苞', '孫魯班', '龐德', '周瑜', '大喬', '陸遜', '華佗', '甄姬', '徐晃', '曹操']


def dims(path):
    r = subprocess.run(['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', path],
                       capture_output=True, text=True)
    w = h = 0
    for line in r.stdout.splitlines():
        if 'pixelWidth' in line: w = int(line.split(':')[1])
        if 'pixelHeight' in line: h = int(line.split(':')[1])
    return w, h


def srcpath(name):
    for f in os.listdir(SRC):
        if os.path.splitext(f)[0] == name:
            return os.path.join(SRC, f)
    return None


RULES = {
    'A': lambda w, h: (w * 0.5, h * 0.06, min(w, h * 0.45)),
    'B': lambda w, h: (w * 0.5, h * 0.13, min(w, h * 0.62)),
    'C': lambda w, h: (w * 0.5, (h - min(w, h)) / 2, min(w, h)),
}

made = {}
for n in FIX:
    p = srcpath(n)
    if not p:
        made[n] = []
        continue
    w, h = dims(p)
    made[n] = []
    for key, rule in RULES.items():
        cx, ytop, side = rule(w, h)
        side = max(60, min(side, w, h))
        x = max(0, min(w - side, cx - side / 2))
        y = max(0, min(h - side, ytop))
        dst = os.path.join(CAND, '%s-%s.jpg' % (n, key))
        subprocess.run(['sips', '-c', str(int(side)), str(int(side)),
                        '--cropOffset', str(int(y)), str(int(x)), p, '--out', '/tmp/_c.jpg'],
                       capture_output=True)
        subprocess.run(['sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', '86',
                        '-z', '320', '320', '/tmp/_c.jpg', '--out', dst], capture_output=True)
        made[n].append(key)

# 產生對照頁
html = ['<!DOCTYPE html><html><head><meta charset="utf-8"><style>',
        'body{background:#0b0e14;color:#e8dcc0;font-family:"PingFang TC",sans-serif;margin:14px}',
        'h1{font-size:15px;color:#d9b46a}',
        '.row{display:flex;gap:8px;margin-bottom:10px;align-items:center}',
        '.nm{width:64px;font-size:13px}',
        '.cell{width:150px;text-align:center;font-size:11px;color:#9aa7bb}',
        '.cell img{width:150px;height:150px;object-fit:cover;border-radius:6px;border:1px solid #2a3040;display:block}',
        '</style></head><body><h1>裁切候選（選最像「有臉」的那一張）</h1>']
for n, keys in made.items():
    html.append('<div class="row"><div class="nm">%s</div>' % n)
    for k in keys:
        html.append('<div class="cell"><img src="cand/%s-%s.jpg"><div>%s</div></div>' % (n, k, k))
    html.append('</div>')
html.append('</body></html>')
open(os.path.join(BASE, 'shots', 'cand.html'), 'w', encoding='utf-8').write('\n'.join(html))
print('buttons:', {k: len(v) for k, v in made.items()})
