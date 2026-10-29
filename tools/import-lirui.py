#!/usr/bin/env python3
"""從使用者提供的《三國殺武將立繪》資料夾匯入頭像（縮圖版，260×329 → 360×360）
   用法：python3 tools/import-lirui.py "/Volumes/失眠一隻喵/三國殺武將立繪"
"""
import csv, json, os, re, subprocess, sys
from PIL import Image

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, 'assets', 'portraits')
SIZE = 360

SIMP = {
    '劉備': '刘备', '關羽': '关羽', '張飛': '张飞', '趙雲': '赵云', '馬超': '马超',
    '黃月英': '黄月英', '諸葛亮': '诸葛亮', '曹操': '曹操', '司馬懿': '司马懿',
    '夏侯惇': '夏侯惇', '張遼': '张辽', '許褚': '许褚', '郭嘉': '郭嘉', '甄姬': '甄姬',
    '孫權': '孙权', '甘寧': '甘宁', '呂蒙': '吕蒙', '黃蓋': '黄盖', '周瑜': '周瑜',
    '大喬': '大乔', '陸遜': '陆逊', '孫尚香': '孙尚香', '華佗': '华佗', '呂布': '吕布',
    '貂蟬': '貂蝉', '賈詡': '贾诩', '曹丕': '曹丕', '徐晃': '徐晃', '張郃': '张郃',
    '龐德': '庞德', '荀彧': '荀彧', '關興': '关兴', '張苞': '张苞', '孫魯班': '孙鲁班',
    '曹植': '曹植', '鄧艾': '邓艾', '姜維': '姜维', '法正': '法正', '馬謖': '马谡',
    '小喬': '小乔', '蔡文姬': '蔡文姬', '華雄': '华雄', '張角': '张角', '太史慈': '太史慈',
    '魯肅': '鲁肃', '凌統': '凌统', '孟獲': '孟获', '于吉': '于吉', '袁紹': '袁绍',
    '顏良': '颜良', '文醜': '文丑', '周泰': '周泰', '曹仁': '曹仁', '陳宮': '陈宫',
    '左慈': '左慈', '典韋': '典韦', '樂進': '乐进', '鍾會': '钟会', '劉禪': '刘禅',
}


ALIAS = {'關興': '关兴张苞', '張苞': '关兴张苞', 'SP呂布': '界吕布'}


def to_simp(our):
    if our in ALIAS:
        return ALIAS[our]
    m = re.match(r'^(界|神|SP)', our)
    prefix = m.group(1) if m else ''
    rest = our[len(prefix):].split('·')[0]
    return prefix + SIMP.get(rest, rest)


def roster():
    out = subprocess.run(['node', '-e', r"""
const {root}=require(process.env.HOME+'/sgs/test/load');
console.log(JSON.stringify(Object.keys(root.SGS_GENERALS)));
"""], capture_output=True)
    try:
        return json.loads(out.stdout.decode())
    except Exception:
        return []


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else '/Volumes/失眠一隻喵/三國殺武將立繪'
    csv_path = os.path.join(src, '武將清單.csv')
    if not os.path.exists(csv_path):
        print('找不到 武將清單.csv：', csv_path)
        return
    rows = list(csv.DictReader(open(csv_path, encoding='utf-8-sig')))
    idx = {}
    order = {'普通': 0, '稀有': 1, '史詩': 2, '傳說': 3, '限定': 4}
    for r in rows:
        name = r['武將名稱']
        key = (order.get(r['稀有度'], 9), r['全站序號'])
        cur = idx.get(name)
        if cur is None or key < cur[0]:
            idx[name] = (key, r)

    names = roster() or list(SIMP.keys())
    ok, miss = 0, []
    picks = {}       # our -> 來源檔
    for our in names:
        row = idx.get(to_simp(our))
        if not row:
            miss.append(our)
            continue
        r = row[1]
        fname = '%s__%s' % (r['資料夾'].replace('立繪/', ''), os.path.splitext(r['圖檔名'])[0] + '.jpg')
        p = os.path.join(src, '縮圖', fname)
        if not os.path.exists(p):
            miss.append(our)
            continue
        picks[our] = p
    # 先用 Vision 找臉，能抓到臉就以臉為中心裁切，抓不到才退回上方裁切
    faces = {}
    if picks:
        r = subprocess.run([os.path.join(BASE, 'tools', 'facedet')] + list(picks.values()), capture_output=True)
        try:
            for x in json.loads(r.stdout.decode()):
                faces[x['path']] = x.get('faces') or []
        except Exception:
            faces = {}

    for our, p in picks.items():
        im = Image.open(p).convert('RGB')
        w, h = im.size
        fl = faces.get(p) or []
        box = None
        if fl:
            f = sorted(fl, key=lambda z: abs((z['x'] + z['w'] / 2) - 0.5))[0]
            fh = f['h']
            cy = (1 - f['y'] - f['h'] / 2) * h
            cx = (f['x'] + f['w'] / 2) * w
            side = max(fh * h * 2.1, w * 0.62)
            left = min(max(0, cx - side / 2), max(0, w - side))
            top = min(max(0, cy - side * 0.42), max(0, h - side))
            side = min(side, w - left, h - top)
            if side > 40:
                box = (int(left), int(top), int(left + side), int(top + side))
        if box is None:
            side = min(w, h)
            left = (w - side) // 2
            top = max(0, int(h * 0.06))
            if top + side > h:
                top = h - side
            box = (left, top, left + side, top + side)
        im = im.crop(box).resize((SIZE, SIZE), Image.LANCZOS)
        im.save(os.path.join(OUT, our + '.jpg'), quality=90, optimize=True)
        ok += 1

    print('匯入 %d 張｜缺 %d：%s' % (ok, len(miss), '、'.join(miss[:20])))
    json.dump({'ok': ok, 'miss': miss}, open('/tmp/lirui.json', 'w'))


if __name__ == '__main__':
    main()
