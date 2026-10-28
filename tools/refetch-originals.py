#!/usr/bin/env python3
# 重抓原圖並以「頭肩」為中心裁切（白描繡像多為全身圖，臉在上方 8%~45%）
import json, os, subprocess, time, urllib.parse

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, 'assets', 'portraits')
SRC = os.path.join(OUT, 'src')
MAN = os.path.join(OUT, 'manifest.json')
os.makedirs(SRC, exist_ok=True)

NAMES = ['劉備','關羽','張飛','趙雲','馬超','黃月英','諸葛亮','曹操','司馬懿','夏侯惇',
         '張遼','許褚','郭嘉','甄姬','孫權','甘寧','呂蒙','黃蓋','周瑜','大喬','陸遜',
         '孫尚香','華佗','呂布','貂蟬','賈詡','曹丕','徐晃','張郃','龐德','荀彧','關興',
         '張苞','孫魯班']
ALT = {'甄姬': '文昭甄皇后', '孫魯班': '孫魯班', '黃月英': '黃月英'}


def curl(url, binary=False, timeout=60, tries=4):
    for k in range(tries):
        r = subprocess.run(['curl', '-sSL', '--max-time', str(timeout), '-A',
                            'sgs-portrait/1.0 (local game)', url], capture_output=True)
        if r.returncode == 0 and r.stdout:
            out = r.stdout if binary else r.stdout.decode('utf-8', 'ignore')
            if binary or out.lstrip().startswith('{'):
                return out
        time.sleep(6 * (k + 1))
    return None


def batch_originals(titles):
    q = urllib.parse.urlencode({'action': 'query', 'format': 'json', 'prop': 'pageimages',
                                'piprop': 'original', 'redirects': '1', 'titles': '|'.join(titles)})
    txt = curl('https://zh.wikipedia.org/w/api.php?' + q)
    if not txt:
        return {}
    d = json.loads(txt)
    return {p.get('title'): (p.get('original') or {}).get('source')
            for p in d.get('query', {}).get('pages', {}).values() if p.get('original')}


man = json.load(open(MAN)) if os.path.exists(MAN) else {}

# 1) 取得原圖網址
need = [n for n in NAMES if n not in man]
for i in range(0, len(need), 15):
    chunk = [ALT.get(n, n) for n in need[i:i + 15]]
    time.sleep(1.5)
    got = batch_originals(chunk)
    for n in need:
        for cand in (ALT.get(n, n), n):
            if got.get(cand):
                man[n] = got[cand]
                break
json.dump(man, open(MAN, 'w'), ensure_ascii=False, indent=1)
print('網址 %d/%d' % (len(man), len(NAMES)))

# 2) 下載原圖
for n in NAMES:
    if n not in man:
        continue
    ext = os.path.splitext(urllib.parse.urlparse(man[n]).path)[1].lower() or '.jpg'
    dst = os.path.join(SRC, n + ext)
    if os.path.exists(dst) and os.path.getsize(dst) > 8000:
        continue
    raw = curl(man[n], binary=True)
    if raw and len(raw) > 8000:
        open(dst, 'wb').write(raw)
        print('下載', n, len(raw))
    time.sleep(0.8)
print('原圖', len([f for f in os.listdir(SRC) if not f.startswith('.')]))
