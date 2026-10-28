#!/usr/bin/env python3
# 抓公有領域三國人物畫像（中文維基百科條目首圖），存成 assets/portraits/<名>.jpg
import json, os, subprocess, sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, 'assets', 'portraits')
os.makedirs(OUT, exist_ok=True)

NAMES = ['劉備','關羽','張飛','趙雲','馬超','黃月英','諸葛亮','曹操','司馬懿','夏侯惇',
         '張遼','許褚','郭嘉','甄姬','孫權','甘寧','呂蒙','黃蓋','周瑜','大喬','陸遜',
         '孫尚香','華佗','呂布','貂蟬','賈詡','曹丕','徐晃','張郃','龐德','荀彧','關興',
         '張苞','孫魯班']

# 條目名可能有重定向差異
PAGE = {'甄姬': '文昭甄皇后', '大喬': '大喬', '黃月英': '黃月英', '孫魯班': '孫魯班'}


def curl(url, binary=False, timeout=30):
    cmd = ['curl', '-sSL', '--max-time', str(timeout), '-A',
           'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) sgs-portrait/1.0', url]
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        return None
    return r.stdout if binary else r.stdout.decode('utf-8', 'ignore')


def summary(name):
    page = PAGE.get(name, name)
    for cand in (page, name):
        url = 'https://zh.wikipedia.org/api/rest_v1/page/summary/' + cand.replace(' ', '_')
        txt = curl(url)
        if not txt:
            continue
        try:
            d = json.loads(txt)
        except Exception:
            continue
        if d.get('type') == 'disambiguation':
            continue
        img = (d.get('originalimage') or {}).get('source') or (d.get('thumbnail') or {}).get('source')
        if img:
            return img, d.get('title')
    return None, None


ok, fail = [], []
for n in NAMES:
    dst = os.path.join(OUT, n + '.jpg')
    if os.path.exists(dst) and os.path.getsize(dst) > 5000:
        ok.append(n); continue
    img, title = summary(n)
    if not img:
        fail.append((n, 'no image')); continue
    raw = curl(img, binary=True, timeout=60)
    if not raw or len(raw) < 3000:
        fail.append((n, 'download fail')); continue
    tmp = dst + '.tmp'
    open(tmp, 'wb').write(raw)
    # 統一成 300x300 正方形（居中裁切）
    r = subprocess.run(['sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', '82',
                        '-Z', '600', tmp, '--out', tmp], capture_output=True)
    r2 = subprocess.run(['sips', '-c', '300', '300', tmp, '--out', dst], capture_output=True)
    if os.path.exists(tmp):
        os.remove(tmp)
    if os.path.exists(dst) and os.path.getsize(dst) > 3000:
        ok.append(n)
    else:
        fail.append((n, 'convert fail'))

print('成功 %d / %d' % (len(ok), len(NAMES)))
if fail:
    print('失敗：', fail)
