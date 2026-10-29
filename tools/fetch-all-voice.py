#!/usr/bin/env python3
"""抓三國殺 OL 全部武將語音（本機自用）
來源：OL WIKI「模板:對照表A」的 名→代碼，音檔在官方 CDN
      https://web.sanguosha.com/220/h5_2/res/runtime/pc/voice/spell/<代碼>/<key>.mp3
key：{形象組}skill{技能編號}_{第幾句} / {形象組}dead01＝陣亡
輸出：<OUT>/<武將>/<形象>/<技能NN_第N句|陣亡>.mp3 ＋ 語音清單.csv
可續跑：已存在且 >2KB 的檔案會跳過。
"""
import csv, json, os, re, subprocess, sys, threading, time, urllib.parse
from concurrent.futures import ThreadPoolExecutor

OUT = sys.argv[1] if len(sys.argv) > 1 else '/Users/masahiro/.hermes/cache/scratch/sgsvoice/out'
WORKERS = int(sys.argv[2]) if len(sys.argv) > 2 else 6
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36'
CDN = 'https://web.sanguosha.com/220/h5_2/res/runtime/pc/voice/spell/'
os.makedirs(OUT, exist_ok=True)
LOCK = threading.Lock()
stats = {'hero': 0, 'file': 0, 'none': 0, 'req': 0}
rows = []
rows_lock = threading.Lock()


def get(url, timeout=30):
    r = subprocess.run(['curl', '-s', '-A', UA, '--max-time', str(timeout), url], capture_output=True)
    with LOCK:
        stats['req'] += 1
    return r.stdout if r.returncode == 0 else b''


def fetch_audio(code, key, dest):
    raw = get(CDN + urllib.parse.quote(code) + '/' + key + '.mp3')
    if len(raw) > 2000 and (raw[:3] == b'ID3' or raw[0] == 0xFF):
        tmp = dest + '.part'
        with open(tmp, 'wb') as fh:
            fh.write(raw)
        os.replace(tmp, dest)
        with LOCK:
            stats['file'] += 1
        return True
    return False


def load_map():
    q = urllib.parse.urlencode({'action': 'parse', 'format': 'json', 'formatversion': '2',
                                'prop': 'wikitext', 'page': 'Template:对照表A'})
    raw = get('https://wiki.biligame.com/sgsol/api.php?' + q)
    wt = json.loads(raw)['parse']['wikitext']
    pairs = re.findall(r'\|\s*([^|={\n]+?)\s*=\s*([0-9]+[a-z0-9]+)\s*(?=\||\n)', wt)
    seen, out = set(), []
    for name, code in pairs:
        name = name.strip()
        if not name or code in seen:
            continue
        seen.add(code)
        out.append((name, code))
    return out


def safe(s):
    return re.sub(r'[\\/:*?"<>|]', '－', s).strip()


def scan_hero(item):
    name, code = item
    base = os.path.join(OUT, safe(name))
    got = 0
    detail = []
    gmiss = 0
    for g in range(1, 9):
        if gmiss >= 2:
            break
        sub = '經典形象' if g == 1 else f'形象{g}'
        d = os.path.join(base, sub)
        dead_dst = os.path.join(d, '陣亡.mp3')
        os.makedirs(d, exist_ok=True)
        dead_ok = os.path.exists(dead_dst) and os.path.getsize(dead_dst) > 2000
        if not dead_ok:
            if not fetch_audio(code, f'{g}dead01', dead_dst):
                # 這個形象組沒有語音 → 若資料夾是空的就刪掉
                if os.path.isdir(d) and not os.listdir(d):
                    os.rmdir(d)
                gmiss += 1
                continue
        gmiss = 0
        got += 1
        detail.append(f'{sub}:陣亡')
        misses = 0
        for s in range(1, 11):
            if misses >= 2:
                break
            hit_any = False
            for line in range(1, 7):
                dst = os.path.join(d, f'技能{s:02d}_第{line}句.mp3')
                if os.path.exists(dst) and os.path.getsize(dst) > 2000:
                    hit_any = True
                    got += 1
                    continue
                if fetch_audio(code, f'{g}skill{s}_{line}', dst):
                    hit_any = True
                    got += 1
                    detail.append(f'{sub}:技能{s}第{line}句')
                else:
                    if line == 1:
                        break          # 這個技能沒有第 1 句 → 沒這技能
                    break              # 句子中斷
            if not hit_any:
                misses += 1
            else:
                misses = 0
    with rows_lock:
        rows.append([name, code, got, '有' if got else '無'])
    with LOCK:
        stats['hero'] += 1
        if not got:
            stats['none'] += 1
    return name, code, got


def main():
    tasks = load_map()
    lim = int(os.environ.get('LIMIT', '0'))
    if lim:
        tasks = tasks[:lim]
    print(f'對照表 {len(tasks)} 個武將/形象代碼', flush=True)
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = [ex.submit(scan_hero, t) for t in tasks]
        for n, f in enumerate(futs, 1):
            if n % 10 == 0 or n == len(tasks):
                el = time.time() - t0
                rate = n / el
                print(f'{n}/{len(tasks)} 武將={stats["hero"]} 無語音={stats["none"]} '
                      f'檔案={stats["file"]} 請求={stats["req"]} {el:.0f}s '
                      f'剩約{(len(tasks)-n)/max(rate,1e-9)/60:.0f}分', flush=True)
    with open(os.path.join(OUT, '語音清單.csv'), 'w', newline='', encoding='utf-8-sig') as fh:
        w = csv.writer(fh)
        w.writerow(['武將', '官方代碼', '語音檔數', '有無語音'])
        for r in sorted(rows):
            w.writerow(r)
    print(f'完成：{stats["hero"]} 個代碼、{stats["file"]} 個語音檔、{stats["none"]} 個沒語音 '
          f'耗時 {(time.time()-t0)/60:.1f} 分 → {OUT}', flush=True)


if __name__ == '__main__':
    main()
