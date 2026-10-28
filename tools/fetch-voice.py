#!/usr/bin/env python3
"""抓官方語音（本機自用，不進公開版本）

來源：三國殺 OL 的語音 CDN，路徑規則取自 OL WIKI「模板:音频」
      https://web.sanguosha.com/220/h5_2/res/runtime/pc/voice/spell/<武將代碼>/<key>.mp3

用法：
    python3 tools/fetch-voice.py            # 抓全部我方武將
    python3 tools/fetch-voice.py 曹操 劉備   # 只抓指定
"""
import json, os, re, subprocess, sys, time, urllib.parse

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, 'assets', 'voice')
os.makedirs(OUT, exist_ok=True)

UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36'
CDN = 'https://web.sanguosha.com/220/h5_2/res/runtime/pc/voice/spell/'

# 我方武將（繁體本名）→ 官方頁面用的簡體名
SIMP = {
    '劉備': '刘备', '關羽': '关羽', '張飛': '张飞', '趙雲': '赵云', '馬超': '马超',
    '黃月英': '黄月英', '諸葛亮': '诸葛亮', '曹操': '曹操', '司馬懿': '司马懿',
    '夏侯惇': '夏侯惇', '張遼': '张辽', '許褚': '许褚', '郭嘉': '郭嘉', '甄姬': '甄姬',
    '孫權': '孙权', '甘寧': '甘宁', '呂蒙': '吕蒙', '黃蓋': '黄盖', '周瑜': '周瑜',
    '大喬': '大乔', '陸遜': '陆逊', '孫尚香': '孙尚香', '華佗': '华佗', '呂布': '吕布',
    '貂蟬': '貂蝉', '賈詡': '贾诩', '曹丕': '曹丕', '徐晃': '徐晃', '張郃': '张郃',
    '龐德': '庞德', '荀彧': '荀彧', '孫魯班': '孙鲁班',
    # 一將成名是「關興&張苞」合體武將，語音共用一個資料夾
    '關興': '关兴张苞', '張苞': '关兴张苞',
}

# 每個武將嘗試的語音 key：陣亡 + 每個技能 1~3 句
# 命名規則：{形象組}skill{技能編號}_{句號}，形象組 1=經典、2=另一形象（界／新）
KEYS = ['1dead01', '2dead01'] + [
    '%dskill%d_%d' % (g, s, n)
    for g in (1, 2) for s in (1, 2, 3, 4) for n in (1, 2, 3, 4)
]


def curl(url, binary=False, timeout=40):
    r = subprocess.run(['curl', '-sSL', '--max-time', str(timeout), '-A', UA, url], capture_output=True)
    if r.returncode != 0:
        return None, 0
    return (r.stdout if binary else r.stdout.decode('utf-8', 'ignore')), len(r.stdout)


def load_map():
    """從 OL WIKI 的 模板:对照表A 取得 名→資料夾代碼"""
    q = urllib.parse.urlencode({'action': 'parse', 'format': 'json', 'formatversion': '2',
                                'prop': 'wikitext', 'page': 'Template:对照表A'})
    txt, _ = curl('https://wiki.biligame.com/sgsol/api.php?' + q)
    if not txt:
        print('無法取得對照表，改用內建表')
        return {}
    try:
        wt = json.loads(txt)['parse']['wikitext']
    except Exception:
        return {}
    m = {}
    for name, code in re.findall(r'\|\s*([^\|=\n]+?)=(\d+[a-z]+)\s*\n', wt):
        m[name.strip()] = code.strip()
    return m


def to_table_name(our):
    """繁中武將名 → OL WIKI 對照表用的名字（界/神/SP 前綴保留）"""
    m = re.match(r'^(界|神|SP)', our)
    prefix = m.group(1) if m else ''
    rest = our[len(prefix):].split('·')[0]
    return prefix + SIMP.get(rest, rest)


def main():
    want = sys.argv[1:] or list(SIMP.keys())
    fmap = load_map()
    print('對照表筆數：', len(fmap))
    total = 0
    for our in want:
        simp = to_table_name(our)
        code = fmap.get(simp) or fmap.get(SIMP.get(our, our)) or fmap.get(our)
        if not code:
            print('  ✗ %s（對照表查不到）' % our)
            continue
        d = os.path.join(OUT, our)
        os.makedirs(d, exist_ok=True)
        # 先試陣亡語音，沒有就代表官方沒有這隻的語音，直接跳過（省時間）
        if not (os.path.exists(os.path.join(d, '1dead01.mp3')) or os.path.exists(os.path.join(d, '2dead01.mp3'))):
            raw, n = curl(CDN + code + '/1dead01.mp3', binary=True)
            if not (raw and n > 2000):
                print('  ✗ %s（%s）：官方無語音' % (our, code))
                continue
            open(os.path.join(d, '1dead01.mp3'), 'wb').write(raw)
        got = 0
        for key in KEYS:
            dst = os.path.join(d, key + '.mp3')
            if os.path.exists(dst) and os.path.getsize(dst) > 2000:
                got += 1
                continue
            raw, n = curl(CDN + code + '/' + key + '.mp3', binary=True)
            if raw and n > 2000 and raw[:3] == b'ID3' or (raw and n > 2000 and raw[0] == 0xFF):
                open(dst, 'wb').write(raw)
                got += 1
            time.sleep(0.15)
        print('  %s %s（%s）：%d 個語音' % ('✓' if got else '✗', our, code, got))
        total += got
    print('共 %d 個檔案 → %s' % (total, OUT))


if __name__ == '__main__':
    main()
