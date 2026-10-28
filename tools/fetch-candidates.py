#!/usr/bin/env python3
"""從 Wikimedia Commons 找武將頭像候選，套用墨金風格後排成一張對照表。
   用法：python3 tools/fetch-candidates.py
   產出：/tmp/cand-sheet.png（每列一位武將，每欄一個候選）
"""
import json, os, subprocess, urllib.parse
from PIL import Image, ImageDraw, ImageFont

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = '/tmp/cand'
os.makedirs(OUT, exist_ok=True)
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36'

WANT = {
    '周瑜': ['Zhou Yu', '周瑜'],
    '馬超': ['Ma Chao', '馬超'],
    '陸遜': ['Lu Xun general', '陸遜'],
    '徐晃': ['Xu Huang', '徐晃'],
    '張遼': ['Zhang Liao', '張遼'],
    '龐德': ['Pang De', '龐德'],
}


def api(params):
    url = 'https://commons.wikimedia.org/w/api.php?' + urllib.parse.urlencode(params)
    r = subprocess.run(['curl', '-sSL', '--max-time', '40', '-A', UA, url], capture_output=True)
    try:
        return json.loads(r.stdout.decode())
    except Exception:
        return {}


def search(term, limit=6):
    d = api({'action': 'query', 'format': 'json', 'formatversion': '2',
             'generator': 'search', 'gsrsearch': term, 'gsrnamespace': '6',
             'gsrlimit': str(limit), 'prop': 'imageinfo', 'iiprop': 'url|mime',
             'iiurlwidth': '700'})
    out = []
    for pg in d.get('query', {}).get('pages', []):
        ii = (pg.get('imageinfo') or [{}])[0]
        if ii.get('mime') not in ('image/jpeg', 'image/png'):
            continue
        u = ii.get('thumburl') or ii.get('url')
        if u:
            out.append((pg.get('title', ''), u))
    return out


def main():
    rows = []
    for name, terms in WANT.items():
        got = []
        for t in terms:
            for title, url in search(t):
                if any(g[0] == title for g in got):
                    continue
                got.append((title, url))
                if len(got) >= 4:
                    break
            if len(got) >= 4:
                break
        files = []
        for i, (title, url) in enumerate(got):
            dst = os.path.join(OUT, '%s-%d.jpg' % (name, i))
            subprocess.run(['curl', '-sSL', '--max-time', '60', '-A', UA, url, '-o', dst])
            if os.path.exists(dst) and os.path.getsize(dst) > 4000:
                files.append((dst, title))
        rows.append((name, files))
        print(name, len(files), [t for _, t in files])

    # 排成對照表（原始圖，先看內容再決定要不要套風格）
    cell = 200
    cols = max(len(f) for _, f in rows)
    sheet = Image.new('RGB', (cols * cell, len(rows) * cell), (12, 14, 18))
    dr = ImageDraw.Draw(sheet)
    for r, (name, files) in enumerate(rows):
        for c, (p, title) in enumerate(files):
            try:
                im = Image.open(p).convert('RGB')
                w, h = im.size
                s = min(w, h)
                im = im.crop(((w - s) // 2, 0, (w - s) // 2 + s, s)).resize((cell - 8, cell - 8))
                sheet.paste(im, (c * cell + 4, r * cell + 4))
            except Exception:
                pass
        dr.text((4, r * cell + 4), name, fill=(255, 230, 160))
    sheet.save('/tmp/cand-sheet.png')
    json.dump({n: [p for p, _ in f] for n, f in rows}, open('/tmp/cand.json', 'w'))
    print('對照表 /tmp/cand-sheet.png')


if __name__ == '__main__':
    main()
