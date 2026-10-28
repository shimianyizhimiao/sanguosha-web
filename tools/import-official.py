#!/usr/bin/env python3
"""把「你自己的」武將圖匯入遊戲。

用法：
    python3 tools/import-official.py <圖片資料夾>

規則：
  * 檔名含武將本名即可（例：關羽.jpg、guan_yu_01.png、界關羽.png 都可以）。
  * 檔名帶「界／神／SP」前綴者，會存成「該版本專用圖」；
    沒有專用圖的版本自動沿用本名的圖。
  * 會自動找臉並裁成 320×320，輸出到 assets/portraits/。
"""
import os, re, shutil, subprocess, sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, 'assets', 'portraits')
VAR = os.path.join(OUT, 'variants')
SRC_TOOL = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'facedet')

NAMES = ['劉備','關羽','張飛','趙雲','馬超','黃月英','諸葛亮','曹操','司馬懿','夏侯惇',
         '張遼','許褚','郭嘉','甄姬','孫權','甘寧','呂蒙','黃蓋','周瑜','大喬','陸遜',
         '孫尚香','華佗','呂布','貂蟬','賈詡','曹丕','徐晃','張郃','龐德','荀彧','關興',
         '張苞','孫魯班']
ALIAS = {'甄姬': ['甄姬', '甄氏', '文昭甄皇后'], '大喬': ['大喬', '大乔'],
         '黃月英': ['黃月英', '黄月英'], '貂蟬': ['貂蟬', '貂蝉'],
         '孫魯班': ['孫魯班', '孙鲁班']}

os.makedirs(OUT, exist_ok=True)
os.makedirs(VAR, exist_ok=True)


def dims(path):
    r = subprocess.run(['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', path],
                       capture_output=True, text=True)
    w = h = 0
    for line in r.stdout.splitlines():
        if 'pixelWidth' in line: w = int(line.split(':')[1])
        if 'pixelHeight' in line: h = int(line.split(':')[1])
    return w, h


def faces(paths):
    if not os.path.exists(SRC_TOOL):
        return {}
    r = subprocess.run([SRC_TOOL] + paths, capture_output=True)
    try:
        import json
        return {os.path.basename(d['path']): d for d in json.loads(r.stdout.decode() or '[]')}
    except Exception:
        return {}


def match(filename):
    """回傳 (本名, 版本前綴或 None)"""
    stem = os.path.splitext(os.path.basename(filename))[0]
    prefix = None
    m = re.match(r'^(界|神|SP|sp|Sp)[\s_\-]*', stem)
    if m:
        prefix = m.group(1).upper() if m.group(1).lower() == 'sp' else m.group(1)
        stem2 = stem[m.end():]
    else:
        stem2 = stem
    for name in NAMES:
        for cand in ALIAS.get(name, [name]):
            if name in stem2 or cand in stem2 or cand in stem:
                return name, prefix
    return None, None


def convert(src, dst):
    w, h = dims(src)
    if w < 40 or h < 40:
        return False
    info = faces([src]).get(os.path.basename(src), {})
    fl = info.get('faces') or []
    if fl:
        fb = max(fl, key=lambda b: b['w'] * b['h'])
        fx = (fb['x'] + fb['w'] / 2) * w
        fy = (1 - (fb['y'] + fb['h'])) * h
        side = max(fb['w'] * w * 2.9, fb['h'] * h * 3.4, min(w, h) * 0.45)
        y = fy - side * 0.18
    else:
        side = min(w, h * 0.55)
        fx, y = w / 2, h * 0.10
    side = max(40, min(side, w, h))
    x = max(0, min(w - side, fx - side / 2))
    y = max(0, min(h - side, y))
    subprocess.run(['sips', '-c', str(int(side)), str(int(side)),
                    '--cropOffset', str(int(y)), str(int(x)), src, '--out', '/tmp/_imp.jpg'],
                   capture_output=True)
    subprocess.run(['sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', '88',
                    '-z', '360', '360', '/tmp/_imp.jpg', '--out', dst], capture_output=True)
    return os.path.exists(dst) and os.path.getsize(dst) > 3000


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return
    folder = os.path.expanduser(sys.argv[1])
    if not os.path.isdir(folder):
        print('找不到資料夾：', folder)
        return
    ok, skipped = [], []
    for f in sorted(os.listdir(folder)):
        if f.startswith('.') or not f.lower().endswith(('.jpg', '.jpeg', '.png', '.webp', '.bmp')):
            continue
        name, prefix = match(f)
        if not name:
            skipped.append(f)
            continue
        dst_dir = VAR if prefix in ('界', '神', 'SP') else OUT
        dst = os.path.join(dst_dir, (prefix or '') + name + '.jpg')
        if convert(os.path.join(folder, f), dst):
            ok.append('%s → %s' % (f, os.path.relpath(dst, BASE)))
        else:
            skipped.append(f)
    print('匯入 %d 張：' % len(ok))
    for line in ok:
        print('  ', line)
    if skipped:
        print('略過 %d 個（檔名對不到武將或轉檔失敗）：' % len(skipped))
        for s in skipped[:20]:
            print('  ', s)


if __name__ == '__main__':
    main()
