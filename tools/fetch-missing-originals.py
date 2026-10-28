#!/usr/bin/env python3
# 用 Commons 搜尋補齊原圖（逐個查，慢速）
import json, os, subprocess, time, urllib.parse

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, 'assets', 'portraits')
SRC = os.path.join(OUT, 'src')
MANPATH = os.path.join(OUT, 'manifest.json')
man = json.load(open(MANPATH))
NAMES = ['劉備','關羽','張飛','趙雲','馬超','黃月英','諸葛亮','曹操','司馬懿','夏侯惇',
         '張遼','許褚','郭嘉','甄姬','孫權','甘寧','呂蒙','黃蓋','周瑜','大喬','陸遜',
         '孫尚香','華佗','呂布','貂蟬','賈詡','曹丕','徐晃','張郃','龐德','荀彧','關興',
         '張苞','孫魯班']


def curl(url, binary=False, timeout=60):
    r = subprocess.run(['curl', '-sSL', '--max-time', str(timeout), '-A',
                        'sgs-portrait/1.0 (local game)', url], capture_output=True)
    if r.returncode != 0:
        return None
    return r.stdout if binary else r.stdout.decode('utf-8', 'ignore')


def api(params, host='commons.wikimedia.org'):
    q = urllib.parse.urlencode(params)
    for k in range(4):
        txt = curl('https://%s/w/api.php?%s' % (host, q))
        if txt and txt.lstrip().startswith('{'):
            try:
                return json.loads(txt)
            except Exception:
                pass
        time.sleep(7 * (k + 1))
    return {}


def find(name):
    for term in (name + ' 三國', name + ' Three Kingdoms', name):
        d = api({'action': 'query', 'format': 'json', 'list': 'search', 'srnamespace': '6',
                 'srlimit': '6', 'srsearch': term + ' filetype:bitmap'})
        for r in d.get('query', {}).get('search', []):
            t = r['title']
            if not t.lower().endswith(('.jpg', '.jpeg', '.png')):
                continue
            d2 = api({'action': 'query', 'format': 'json', 'prop': 'imageinfo',
                      'iiprop': 'url', 'iiurlwidth': '1400', 'titles': t})
            for p in d2.get('query', {}).get('pages', {}).values():
                ii = (p.get('imageinfo') or [{}])[0]
                url = ii.get('thumburl') or ii.get('url')
                if url:
                    return url, t
        time.sleep(3)
    return None, None


for n in NAMES:
    if n in man:
        continue
    url, title = find(n)
    if not url:
        print('MISS', n)
        continue
    man[n] = url
    ext = os.path.splitext(urllib.parse.urlparse(url).path)[1].lower() or '.jpg'
    raw = curl(url, binary=True)
    if raw and len(raw) > 8000:
        open(os.path.join(SRC, n + ext), 'wb').write(raw)
        print('OK', n, '<-', title)
    else:
        print('DLFAIL', n)
    json.dump(man, open(MANPATH, 'w'), ensure_ascii=False, indent=1)
    time.sleep(2)

print('原圖總數', len([f for f in os.listdir(SRC) if not f.startswith('.')]))
