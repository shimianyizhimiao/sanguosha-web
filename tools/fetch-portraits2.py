#!/usr/bin/env python3
# 批次抓公有領域三國人物畫像（中文維基 pageimages，一次 50 個標題）
import json, os, subprocess, time, urllib.parse

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, 'assets', 'portraits')
os.makedirs(OUT, exist_ok=True)

NAMES = ['劉備','關羽','張飛','趙雲','馬超','黃月英','諸葛亮','曹操','司馬懿','夏侯惇',
         '張遼','許褚','郭嘉','甄姬','孫權','甘寧','呂蒙','黃蓋','周瑜','大喬','陸遜',
         '孫尚香','華佗','呂布','貂蟬','賈詡','曹丕','徐晃','張郃','龐德','荀彧','關興',
         '張苞','孫魯班']

ALT = {'甄姬': ['甄姬', '文昭甄皇后', '甄夫人'],
       '大喬': ['大喬', '大乔 (三國)'],
       '黃月英': ['黃月英', '黄月英'],
       '貂蟬': ['貂蟬', '貂蝉'],
       '孫魯班': ['孫魯班', '孙鲁班']}


def curl(url, binary=False, timeout=40):
    r = subprocess.run(['curl', '-sSL', '--max-time', str(timeout), '-A',
                        'sgs-portrait/1.0 (local game asset fetch)', url], capture_output=True)
    if r.returncode != 0:
        return None
    return r.stdout if binary else r.stdout.decode('utf-8', 'ignore')


def batch_images(titles, tries=4):
    q = urllib.parse.urlencode({
        'action': 'query', 'format': 'json', 'prop': 'pageimages',
        'piprop': 'thumbnail|original', 'pithumbsize': '700',
        'redirects': '1', 'titles': '|'.join(titles)})
    txt = None
    for k in range(tries):
        txt = curl('https://zh.wikipedia.org/w/api.php?' + q)
        if txt and txt.lstrip().startswith('{'):
            break
        time.sleep(8 * (k + 1))     # 429 就退避
        txt = None
    if not txt:
        return {}
    try:
        d = json.loads(txt)
    except Exception:
        return {}
    pages = d.get('query', {}).get('pages', {})
    norm = {}
    for r in d.get('query', {}).get('redirects', []) + d.get('query', {}).get('normalized', []):
        norm[r['to']] = r['from']
    out = {}
    for pid, p in pages.items():
        title = p.get('title')
        src = (p.get('original') or {}).get('source') or (p.get('thumbnail') or {}).get('source')
        if not src:
            continue
        out[title] = src
        if title in norm:
            out.setdefault(norm[title], src)
    return out


want = [n for n in NAMES if not (os.path.exists(os.path.join(OUT, n + '.jpg')) and
                                os.path.getsize(os.path.join(OUT, n + '.jpg')) > 5000)]
print('待抓：', want)
imgs = {}
for i in range(0, len(want), 20):
    chunk = []
    for n in want[i:i + 20]:
        chunk.extend(ALT.get(n, [n]))
    time.sleep(0.6)
    imgs.update(batch_images(chunk))

ok, fail = [], []
for n in want:
    dst = os.path.join(OUT, n + '.jpg')
    src = None
    for cand in ALT.get(n, [n]):
        if cand in imgs:
            src = imgs[cand]; break
    if not src:
        # 用「名 (三國)」再試
        time.sleep(0.4)
        m = batch_images([n + ' (三國)', n + ' (三国)'])
        for k, v in m.items():
            src = v; break
    if not src:
        fail.append(n); continue
    raw = curl(src, binary=True, timeout=60)
    if not raw or len(raw) < 3000:
        fail.append(n); continue
    tmp = dst + '.tmp'
    open(tmp, 'wb').write(raw)
    subprocess.run(['sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', '82',
                    '-Z', '620', tmp, '--out', tmp], capture_output=True)
    subprocess.run(['sips', '-c', '300', '300', tmp, '--out', dst], capture_output=True)
    if os.path.exists(tmp):
        os.remove(tmp)
    (ok if os.path.exists(dst) and os.path.getsize(dst) > 3000 else fail).append(n)

print('補到 %d 隻，仍缺：%s' % (len(ok), fail))
