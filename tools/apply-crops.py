#!/usr/bin/env python3
# 套用人工挑選的裁切方案（其餘保留現有 320px 版本）
import os, subprocess

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, 'assets', 'portraits')
SRC = os.path.join(OUT, 'src')

CHOICE = {'張苞': 'B', '周瑜': 'B', '大喬': 'B', '陸遜': 'A', '華佗': 'C',
          '甄姬': 'A', '徐晃': 'B', '曹操': 'B'}
RULES = {
    'A': lambda w, h: (w * 0.5, h * 0.06, min(w, h * 0.45)),
    'B': lambda w, h: (w * 0.5, h * 0.13, min(w, h * 0.62)),
    'C': lambda w, h: (w * 0.5, (h - min(w, h)) / 2, min(w, h)),
}


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


for name, key in CHOICE.items():
    p = srcpath(name)
    if not p:
        print('NOSRC', name); continue
    w, h = dims(p)
    cx, ytop, side = RULES[key](w, h)
    side = max(60, min(side, w, h))
    x = max(0, min(w - side, cx - side / 2))
    y = max(0, min(h - side, ytop))
    tmp = '/tmp/_c2.jpg'
    subprocess.run(['sips', '-c', str(int(side)), str(int(side)),
                    '--cropOffset', str(int(y)), str(int(x)), p, '--out', tmp], capture_output=True)
    dst = os.path.join(OUT, name + '.jpg')
    subprocess.run(['sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', '86',
                    '-z', '320', '320', tmp, '--out', dst], capture_output=True)
    print('裁切', name, key)

# 沒有可用畫像的：移除檔案，前端自動用姓氏圖章代替
for name in ['龐德', '黃月英', '孫魯班']:
    p = os.path.join(OUT, name + '.jpg')
    if os.path.exists(p):
        os.remove(p)
        print('移除', name, '→ 用圖章頭像')
