#!/usr/bin/env python3
# 補最後幾隻：用 Commons 搜尋（三才圖會 / 繡像）抓公有領域圖
import json, os, subprocess, time, urllib.parse

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, 'assets', 'portraits')

TARGETS = {
    '陸遜': ['Lu Xun (Three Kingdoms)', '陸遜', 'Lu Xun sancai'],
    '黃月英': ['Huang Yueying', '黃月英', 'Huang Yueying sancai'],
    '張苞': ['Zhang Bao (Shu Han)', '張苞'],
    '孫魯班': ['Sun Luban', '孫魯班'],
}


def curl(url, binary=False, timeout=45):
    r = subprocess.run(['curl', '-sSL', '--max-time', str(timeout), '-A',
                        'sgs-portrait/1.0 (local game)', url], capture_output=True)
    if r.returncode != 0:
        return None
    return r.stdout if binary else r.stdout.decode('utf-8', 'ignore')


def commons_search(term):
    q = urllib.parse.urlencode({
        'action': 'query', 'format': 'json', 'list': 'search', 'srnamespace': '6',
        'srlimit': '8', 'srsearch': term + ' filetype:bitmap'})
    for k in range(3):
        txt = curl('https://commons.wikimedia.org/w/api.php?' + q)
        if txt and txt.lstrip().startswith('{'):
            try:
                return json.loads(txt).get('query', {}).get('search', [])
            except Exception:
                return []
        time.sleep(6)
    return []


def image_url(file_title):
    q = urllib.parse.urlencode({'action': 'query', 'format': 'json', 'prop': 'imageinfo',
                                'iiprop': 'url', 'iiurlwidth': '700', 'titles': file_title})
    txt = curl('https://commons.wikimedia.org/w/api.php?' + q)
    if not txt:
        return None
    try:
        d = json.loads(txt)
    except Exception:
        return None
    for p in d.get('query', {}).get('pages', {}).values():
        ii = (p.get('imageinfo') or [{}])[0]
        return ii.get('thumburl') or ii.get('url')
    return None


for name, terms in TARGETS.items():
    dst = os.path.join(OUT, name + '.jpg')
    if os.path.exists(dst) and os.path.getsize(dst) > 5000:
        continue
    got = False
    for term in terms:
        for r in commons_search(term):
            t = r['title']
            if not any(t.lower().endswith(x) for x in ('.jpg', '.jpeg', '.png')):
                continue
            url = image_url(t)
            if not url:
                continue
            raw = curl(url, binary=True, timeout=60)
            if not raw or len(raw) < 4000:
                continue
            tmp = dst + '.tmp'
            open(tmp, 'wb').write(raw)
            subprocess.run(['sips', '-s', 'format', 'jpeg', '-Z', '620', tmp, '--out', tmp], capture_output=True)
            subprocess.run(['sips', '-c', '300', '300', tmp, '--out', dst], capture_output=True)
            if os.path.exists(tmp):
                os.remove(tmp)
            if os.path.exists(dst) and os.path.getsize(dst) > 4000:
                print('OK', name, '<-', t)
                got = True
                break
            time.sleep(1)
        if got:
            break
        time.sleep(2)
    if not got:
        print('MISS', name)
