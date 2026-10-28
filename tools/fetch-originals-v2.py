#!/usr/bin/env python3
# 只採用「維基百科條目首圖」作為畫像來源，慢速分批避免 429
import json, os, subprocess, time, urllib.parse, shutil

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, 'assets', 'portraits')
SRC = os.path.join(OUT, 'src')
MANPATH = os.path.join(OUT, 'manifest.json')

NAMES = ['劉備','關羽','張飛','趙雲','馬超','黃月英','諸葛亮','曹操','司馬懿','夏侯惇',
         '張遼','許褚','郭嘉','甄姬','孫權','甘寧','呂蒙','黃蓋','周瑜','大喬','陸遜',
         '孫尚香','華佗','呂布','貂蟬','賈詡','曹丕','徐晃','張郃','龐德','荀彧','關興',
         '張苞','孫魯班']

# 條目標題（首圖來源）
PAGE = {'甄姬': '文昭甄皇后',
        '陸遜': '陸遜',
        '黃月英': '黃月英',
        '大喬': '大喬',
        '孫魯班': '孫魯班'}

# 明確可用的公有領域檔案（Commons 檔名），優先於首圖
FORCE = {'陸遜': 'File:LuXun.jpg'}

shutil.rmtree(SRC, ignore_errors=True)
os.makedirs(SRC, exist_ok=True)


def curl(url, binary=False, timeout=70):
    r = subprocess.run(['curl', '-sSL', '--max-time', str(timeout), '-A',
                        'sgs-portrait/1.0 (personal offline game; contact: local)', url],
                       capture_output=True)
    if r.returncode != 0:
        return None
    return r.stdout if binary else r.stdout.decode('utf-8', 'ignore')


def api(host, params, tries=6, wait=12):
    q = urllib.parse.urlencode(params)
    for k in range(tries):
        txt = curl('https://%s/w/api.php?%s' % (host, q))
        if txt and txt.lstrip().startswith('{'):
            try:
                return json.loads(txt)
            except Exception:
                pass
        time.sleep(wait * (k + 1))
    return {}


def pageimages(titles):
    d = api('zh.wikipedia.org', {'action': 'query', 'format': 'json', 'prop': 'pageimages',
                                 'piprop': 'original', 'redirects': '1', 'titles': '|'.join(titles)})
    out = {}
    for p in d.get('query', {}).get('pages', {}).values():
        src = (p.get('original') or {}).get('source')
        if src and p.get('title'):
            out[p['title']] = src
    # 處理重定向
    for r in d.get('query', {}).get('redirects', []):
        if r['to'] in out:
            out[r['from']] = out[r['to']]
    return out


def file_url(title):
    d = api('commons.wikimedia.org', {'action': 'query', 'format': 'json', 'prop': 'imageinfo',
                                     'iiprop': 'url', 'iiurlwidth': '1400', 'titles': title})
    for p in d.get('query', {}).get('pages', {}).values():
        ii = (p.get('imageinfo') or [{}])[0]
        return ii.get('thumburl') or ii.get('url')
    return None


man = {}
urls = {}
done = []
for n in NAMES:
    if n in FORCE:
        u = file_url(FORCE[n])
        if u:
            urls[n] = u
            done.append(n)
    time.sleep(0.4)

todo = [n for n in NAMES if n not in urls]
for i in range(0, len(todo), 4):
    chunk = [PAGE.get(n, n) for n in todo[i:i + 4]]
    time.sleep(20)
    got = pageimages(chunk)
    for n in todo[i:i + 4]:
        src = got.get(PAGE.get(n, n)) or got.get(n)
        if src:
            urls[n] = src
    print('批次 %d/%d 累計 %d' % (min(i + 4, len(todo)), len(todo), len(urls)))

for n, u in urls.items():
    ext = os.path.splitext(urllib.parse.urlparse(u).path)[1].lower()
    if ext not in ('.jpg', '.jpeg', '.png'):
        ext = '.jpg'
    dst = os.path.join(SRC, n + ext)
    raw = curl(u, binary=True)
    if raw and len(raw) > 8000:
        open(dst, 'wb').write(raw)
        man[n] = u
    time.sleep(1)
json.dump(man, open(MANPATH, 'w'), ensure_ascii=False, indent=1)

missing = [n for n in NAMES if n not in man]
print('原圖 %d 張；缺 %s' % (len(man), missing))
