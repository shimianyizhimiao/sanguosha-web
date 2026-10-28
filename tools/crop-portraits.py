#!/usr/bin/env python3
# 依臉部位置裁切頭像：有臉→臉為中心；沒臉→取上方（白描全身圖的頭在上前段）
import json, os, subprocess, sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, 'assets', 'portraits')
SRC = os.path.join(OUT, 'src')
TOOL = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'facedet')
SIZE = 320


def dims(path):
    r = subprocess.run(['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', path],
                       capture_output=True, text=True)
    w = h = 0
    for line in r.stdout.splitlines():
        if 'pixelWidth' in line:
            w = int(line.split(':')[1])
        if 'pixelHeight' in line:
            h = int(line.split(':')[1])
    return w, h


def crop(path, x, y, w, h):
    """x,y 為左上角；sips --cropOffset 也是左上角"""
    subprocess.run(['sips', '-c', str(int(h)), str(int(w)),
                    '--cropOffset', str(int(y)), str(int(x)), path, '--out', path],
                   capture_output=True)


files = [f for f in sorted(os.listdir(SRC)) if not f.startswith('.')]
paths = [os.path.join(SRC, f) for f in files]
res = json.loads(subprocess.run([TOOL] + paths, capture_output=True).stdout.decode() or '[]')
info = {os.path.basename(r['path']): r for r in res}

for f, path in zip(files, paths):
    name = os.path.splitext(f)[0]
    w, h = dims(path)
    if w < 50 or h < 50:
        print('SKIP', name); continue
    r = info.get(f, {})
    faces = r.get('faces') or []
    if faces:
        fb = max(faces, key=lambda b: b['w'] * b['h'])
        # Vision 座標原點在左下
        fx = (fb['x'] + fb['w'] / 2) * w
        fy_top = (1 - (fb['y'] + fb['h'])) * h
        side = max(fb['w'] * w * 3.1, fb['h'] * h * 3.6, min(w, h) * 0.5)
    else:
        # 沒有臉：白描/立軸的頭大約在高度 10%~35%
        side = min(w, h * 0.55)
        fx = w * 0.5
        fy_top = h * 0.10

    side = min(side, w, h)
    x = max(0, min(w - side, fx - side / 2))
    y = max(0, min(h - side, fy_top - side * 0.16))
    crop(path, x, y, side, side)
    subprocess.run(['sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', '86',
                    '-z', str(SIZE), str(SIZE), path, '--out', os.path.join(OUT, name + '.jpg')],
                   capture_output=True)
    print(('臉' if faces else '無臉'), name, int(side))
