#!/usr/bin/env python3
"""匯入替換形象（形象2、形象3…）的語音，並產生 assets/voice/index.json
   命名：形象N → {N}skill{技能編號}_{句號}.mp3、陣亡 → {N}dead01.mp3
   播放器（js/voice.js）讀 index.json，只請求真的有檔案的聲音，不會一堆 404。
"""
import json, os, re, shutil, sys

SRC = sys.argv[1] if len(sys.argv) > 1 else '/Volumes/失眠一隻喵/三國殺武將語音'
ROOT = os.path.join(os.path.dirname(__file__), '..')
DST = os.path.join(ROOT, 'assets', 'voice')
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
    nm = json.load(open(NAMEMAP, encoding='utf-8'))['names']
    roster = json.load(open(ROSTER, encoding='utf-8'))
    want = {}
    for g in roster:
        want.setdefault(norm(g['name']), []).append(g['name'])

    copied = bytes_ = 0
    for f in sorted(os.listdir(SRC)):
        p = os.path.join(SRC, f)
        if not os.path.isdir(p):
            continue
        names = want.get(norm(f)) or want.get(norm(nm.get(norm(f), '\0')))
        if not names:
            continue
        out = os.path.join(DST, names[0])
        if not os.path.isdir(out):
            continue
        for sub in os.listdir(p):
            m = re.match(r'形象(\d+)$', sub)
            if not m:
                continue
            look = int(m.group(1))
            sd = os.path.join(p, sub)
            if not os.path.isdir(sd):
                continue
            for fn in os.listdir(sd):
                tgt = None
                mm = re.match(r'技能(\d+)_第(\d+)句\.mp3$', fn)
                if mm:
                    tgt = '%dskill%d_%s.mp3' % (look, int(mm.group(1)), mm.group(2))
                elif fn in ('陣亡.mp3', '阵亡.mp3'):
                    tgt = '%ddead01.mp3' % look
                if not tgt:
                    continue
                s, d = os.path.join(sd, fn), os.path.join(out, tgt)
                if os.path.exists(d) and os.path.getsize(d) == os.path.getsize(s):
                    continue
                shutil.copy2(s, d)
                copied += 1
                bytes_ += os.path.getsize(d)

    # 建索引
    index = {}
    for name in sorted(os.listdir(DST)):
        d = os.path.join(DST, name)
        if not os.path.isdir(d):
            continue
        files = sorted(f for f in os.listdir(d) if f.endswith('.mp3'))
        if files:
            index[name] = files
    with open(os.path.join(DST, 'index.json'), 'w', encoding='utf-8') as fh:
        json.dump(index, fh, ensure_ascii=False, separators=(',', ':'))

    print('複製 %d 檔（%.0f MB）｜索引武將 %d 隻' % (copied, bytes_ / 1e6, len(index)))
    looks = set()
    for v in index.values():
        for f in v:
            looks.add(f[0])
    print('形象層數：', ''.join(sorted(looks)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
