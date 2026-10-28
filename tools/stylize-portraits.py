#!/usr/bin/env python3
"""把公有領域人物畫像統一改成「墨金」卡牌頭像，並替沒有圖的武將生成勢力圖章。
   輸出：assets/portraits/<本名>.jpg（360×360）；原圖保留在 assets/portraits/src/
"""
import json, os, random, sys
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = os.path.join(BASE, 'assets', 'portraits')
SRC = os.path.join(P, 'src')
SIZE = 360

INK = (10, 12, 17)
GOLD = (232, 211, 160)
GOLD_DIM = (150, 122, 72)

KINGDOM = {
    'wei': ((38, 62, 110), '魏'),
    'shu': ((40, 92, 66), '蜀'),
    'wu': ((116, 44, 48), '吳'),
    'qun': ((92, 72, 46), '群'),
    'god': ((110, 58, 74), '神'),
}
# 這些來源圖是山水／器物／殘缺，機器裁不出頭像，直接改用勢力圖章
NO_FACE = {'張遼', '陸遜', '龐德', '周瑜', '徐晃', '馬超'}

FONT_PATH = '/System/Library/Fonts/PingFang.ttc'
if not os.path.exists(FONT_PATH):
    FONT_PATH = '/System/Library/Fonts/Hiragino Sans GB.ttc'


def font(size):
    try:
        return ImageFont.truetype(FONT_PATH, size)
    except Exception:
        return ImageFont.load_default()


def center_crop(im, size):
    w, h = im.size
    s = min(w, h)
    im = im.crop(((w - s) // 2, max(0, (h - s) // 3), (w - s) // 2 + s, max(0, (h - s) // 3) + s))
    return im.resize((size, size), Image.LANCZOS)


def vignette(size, strength=0.9):
    m = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(m)
    steps = 48
    for i in range(steps):
        r = size * 0.8 * (i + 1) / steps
        v = int(255 * (1 - strength * (1 - i / steps) ** 2))
        d.ellipse([size / 2 - r, size / 2 - r, size / 2 + r, size / 2 + r], fill=v)
    return m


FACES = {}
try:
    FACES = json.load(open('/tmp/faces.json', encoding='utf-8'))
except Exception:
    FACES = {}


def crop_face(im, size, face):
    """以偵測到的臉為中心，擴大到頭肩範圍（Vision 座標原點在左下）"""
    w, h = im.size
    fh = face['h']
    top_n = 1 - face['y'] - face['h']          # 轉成左上原點
    cx = (face['x'] + face['w'] / 2) * w
    cy = (top_n + face['h'] / 2) * h
    side = max(h * fh * 2.0, w * 0.5)
    left = min(max(0, cx - side / 2), max(0, w - side))
    top = min(max(0, cy - side * 0.45), max(0, h - side))
    left, top = int(left), int(top)
    side = int(min(side, w - left, h - top))
    if side < 40:
        return None
    return im.crop((left, top, left + side, top + side)).resize((size, size), Image.LANCZOS)


def crop_head(im, size):
    """線描古畫多為全身：優先取上方 62% 的頭肩區域，並裁成正方形"""
    w, h = im.size
    side = min(w, int(h * 0.62))
    top = max(0, int(h * 0.10))
    left = (w - side) // 2
    return im.crop((left, top, left + side, top + side)).resize((size, size), Image.LANCZOS)


def stylize(src_path, dst_path, face=None):
    im = Image.open(src_path).convert('RGB')
    cropped = crop_face(im, SIZE, face) if face else None
    im = cropped if cropped is not None else crop_head(im, SIZE)
    g = ImageOps.autocontrast(im.convert('L'), cutoff=1)
    g = ImageOps.invert(g)                       # 墨線變亮、紙底變黑
    g = ImageEnhance.Contrast(g).enhance(1.35)
    g = g.filter(ImageFilter.MedianFilter(3))
    # 亮部（人物線條）上金，暗部留黑
    lut = []
    for i in range(256):
        t = (i / 255) ** 1.5
        col = (int(12 + 236 * t), int(14 + 206 * t), int(20 + 150 * t))
        lut.append(col)
    ink = g.convert('RGB')
    ink.putdata([lut[v] for v in g.get_flattened_data()] if hasattr(g, 'get_flattened_data') else [lut[v] for v in g.getdata()])
    # 柔光疊加，做出發亮的墨線
    glow = ink.filter(ImageFilter.GaussianBlur(6)).point(lambda v: int(v * 0.55))
    base = Image.new('RGB', (SIZE, SIZE), INK)
    base = Image.blend(base, glow, 0.5)
    out = Image.blend(base, ink, 0.82) if False else Image.composite(ink, base, g.point(lambda v: min(255, int(v * 1.25))))
    # 邊緣壓黑
    dark = Image.new('RGB', (SIZE, SIZE), INK)
    out = Image.composite(out, dark, vignette(SIZE))
    dr = ImageDraw.Draw(out)
    dr.rectangle([3, 3, SIZE - 4, SIZE - 4], outline=GOLD_DIM, width=2)
    for (x, y, dx, dy) in ((10, 10, 1, 1), (SIZE - 11, 10, -1, 1), (10, SIZE - 11, 1, -1), (SIZE - 11, SIZE - 11, -1, -1)):
        dr.line([(x, y), (x + 22 * dx, y)], fill=GOLD, width=2)
        dr.line([(x, y), (x, y + 22 * dy)], fill=GOLD, width=2)
    out.save(dst_path, quality=92, optimize=True)
    return True


def emblem(name, kingdom, dst_path):
    col, ch = KINGDOM.get(kingdom, ((70, 60, 50), '群'))
    im = Image.new('RGB', (SIZE, SIZE), INK)
    dr = ImageDraw.Draw(im)
    for y in range(SIZE):
        t = y / SIZE
        c = tuple(int(INK[i] + (col[i] - INK[i]) * (0.62 * (1 - t) ** 1.2 + 0.10)) for i in range(3))
        dr.line([(0, y), (SIZE, y)], fill=c)
    # 斜向筆觸
    for k in range(3):
        dr.line([(0, SIZE * (0.30 + k * 0.06)), (SIZE, SIZE * (0.12 + k * 0.06))], fill=(255, 255, 255, 20), width=2)
    dr.ellipse([SIZE / 2 - 132, SIZE / 2 - 132, SIZE / 2 + 132, SIZE / 2 + 132], outline=GOLD_DIM, width=2)
    dr.ellipse([SIZE / 2 - 118, SIZE / 2 - 118, SIZE / 2 + 118, SIZE / 2 + 118], outline=(70, 58, 34), width=1)
    f_big = font(140)
    ch_name = name[-1] if len(name) > 1 else name
    try:
        bb = dr.textbbox((0, 0), ch_name, font=f_big)
        dr.text(((SIZE - (bb[2] - bb[0])) / 2 - bb[0], (SIZE - (bb[3] - bb[1])) / 2 - bb[1] - 14), ch_name, font=f_big, fill=GOLD)
    except Exception:
        pass
    f_small = font(30)
    try:
        bb2 = dr.textbbox((0, 0), ch, font=f_small)
        dr.text(((SIZE - (bb2[2] - bb2[0])) / 2 - bb2[0], SIZE - 58), ch, font=f_small, fill=(214, 186, 132))
    except Exception:
        pass
    dr.rectangle([3, 3, SIZE - 4, SIZE - 4], outline=GOLD_DIM, width=2)
    for (x, y, dx, dy) in ((10, 10, 1, 1), (SIZE - 11, 10, -1, 1), (10, SIZE - 11, 1, -1), (SIZE - 11, SIZE - 11, -1, -1)):
        dr.line([(x, y), (x + 22 * dx, y)], fill=GOLD, width=2)
        dr.line([(x, y), (x, y + 22 * dy)], fill=GOLD, width=2)
    im.save(dst_path, quality=92, optimize=True)


def main():
    data = json.load(open('/tmp/gen-base.json', encoding='utf-8'))
    made_photo = made_emblem = 0
    for name, meta in data.items():
        dst = os.path.join(P, name + '.jpg')
        src = os.path.join(SRC, name + '.jpg')
        if name in NO_FACE:
            emblem(name, meta.get('kingdom'), dst)
            made_emblem += 1
        elif os.path.exists(src) and os.path.getsize(src) > 5000:
            faces = FACES.get(name) or []
            face = None
            if faces:
                # 多張臉時取最靠近中央的
                face = sorted(faces, key=lambda f: abs((f['x'] + f['w'] / 2) - 0.5))[0]
            stylize(src, dst, face)
            made_photo += 1
        else:
            emblem(name, meta.get('kingdom'), dst)
            made_emblem += 1
    print('畫像重繪 %d 張｜勢力圖章 %d 張｜共 %d' % (made_photo, made_emblem, made_photo + made_emblem))


if __name__ == '__main__':
    main()
