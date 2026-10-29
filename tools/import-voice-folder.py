#!/usr/bin/env python3
"""把「三國殺武將語音」資料夾（技能NN_第M句.mp3 / 陣亡.mp3 / 形象N 子夾）
   匯入成 assets/voice/<繁體武將名>/1skill{NN}_{M}.mp3 與 1dead01.mp3
   ——沿用 js/voice.js 既有的檔名規則，不用改播放器。

用法：python3 tools/import-voice-folder.py [來源夾] [--variant 形象2]
"""
import json, os, re, shutil, sys

DEFAULT_SRC = '/Volumes/失眠一隻喵/三國殺武將語音'
DST = os.path.join(os.path.dirname(__file__), '..', 'assets', 'voice')
ROSTER = '/tmp/roster.json'
NAMEMAP = '/tmp/name_map.json'

PREFIX = ('国战', '國戰', '界', '神', '魔', '谋', '謀', 'SP', '1v1', '3v3')


def norm(s):
    s = re.sub(r'\d+$', '', s)
    for p in PREFIX:
        if s.startswith(p):
            s = s[len(p):]
    return s.strip()


def main():
    src = DEFAULT_SRC
    variant = '經典形象'
    args = sys.argv[1:]
    if args and not args[0].startswith('--'):
        src = args[0]
    if '--variant' in args:
        variant = args[args.index('--variant') + 1]

    if not os.path.isdir(src):
        print('找不到資料夾：', src); return 1

    nm = json.load(open(NAMEMAP, encoding='utf-8'))['names']      # 簡 → 繁
    roster = json.load(open(ROSTER, encoding='utf-8'))
    want = {}
    for g in roster:
        want.setdefault(norm(g['name']), []).append(g['name'])

    folders = [d for d in os.listdir(src) if os.path.isdir(os.path.join(src, d))]
    hits, misses, copied, bytes_ = [], [], 0, 0
    for f in folders:
        key = norm(f)
        names = want.get(key)
        if not names:
            # 再用簡→繁對照反查
            trad = nm.get(key)
            names = want.get(norm(trad)) if trad else None
        if not names:
            misses.append(f); continue
        sub = os.path.join(src, f, variant)
        if not os.path.isdir(sub):
            subs = [x for x in os.listdir(os.path.join(src, f)) if os.path.isdir(os.path.join(src, f, x))]
            if not subs: misses.append(f); continue
            sub = os.path.join(src, f, subs[0])
        name = names[0]
        out = os.path.join(DST, name)
        os.makedirs(out, exist_ok=True)
        n = 0
        for fn in os.listdir(sub):
            m = re.match(r'技能(\d+)_第(\d+)句\.mp3$', fn)
            tgt = None
            if m:
                tgt = '1skill%d_%s.mp3' % (int(m.group(1)), m.group(2))
            elif fn in ('陣亡.mp3', '阵亡.mp3'):
                tgt = '1dead01.mp3'
            if not tgt:
                continue
            s, d = os.path.join(sub, fn), os.path.join(out, tgt)
            if os.path.exists(d) and os.path.getsize(d) == os.path.getsize(s):
                continue
            shutil.copy2(s, d)
            copied += 1; bytes_ += os.path.getsize(d); n += 1
        hits.append((name, n))

    print('語音夾 %d ｜對到武將 %d ｜略過 %d' % (len(folders), len(hits), len(misses)))
    print('複製 %d 個檔（%.1f MB）' % (copied, bytes_ / 1e6))
    empty = [h for h in hits if h[1] == 0]
    if empty:
        print('對到但沒複製到檔案：', '、'.join(x[0] for x in empty[:10]))
    return 0


if __name__ == '__main__':
    sys.exit(main())
