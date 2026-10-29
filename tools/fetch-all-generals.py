#!/usr/bin/env python3
"""批次抓 Fandom 每隻武將頁：所屬武將包、勢力、體力、所有版本的技能名＋描述。
可續跑（已抓過的跳過），每抓完一隻就寫檔。

用法：python3 tools/fetch-all-generals.py [起始索引] [結束索引]
"""
import json, os, re, subprocess, sys, time, urllib.parse

UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/120 Safari/537.36')
OUT = '/tmp/generals-raw.json'
LIST = '/tmp/heroes.wiki'


def api(params):
    q = urllib.parse.urlencode(params)
    r = subprocess.run(['curl', '-sSL', '--max-time', '45', '-A', UA,
                        'https://sanguosha.fandom.com/zh/api.php?' + q], capture_output=True)
    try:
        return json.loads(r.stdout.decode('utf-8', 'ignore'))
    except Exception:
        return {}


def names():
    """只取武將總表表格內的名字（表格外的連結是遊戲、勢力統計等雜項）"""
    wt = open(LIST, encoding='utf-8').read()
    i = wt.find('{| class="wikitable"')
    j = wt.find('\n|}', i)
    table = wt[i:j if j > i else len(wt)]
    out, seen = [], set()
    for line in table.split('\n'):
        if not line.startswith('|'):
            continue
        for part in line.split('||'):
            part = part.strip().lstrip('|').strip()
            m = re.match(r'\[\[([^\]\|#]+)', part)
            name = m.group(1).strip() if m else part.split('|')[0].strip()
            name = re.sub(r"[\]\[\]'\s]", '', name)
            if not name or len(name) > 12:
                continue
            if any(x in name for x in ('style', 'width', 'colspan', '势力', '编号', '背景')):
                continue
            if name not in seen:
                seen.add(name)
                out.append(name)
    return out


def parse_page(wt):
    pack = ''
    m = re.search(r'武将包\s*\(繁体\)\s*=\s*([^\|\n]+)', wt) or re.search(r'武将包\s*=\s*([^\|\n]+)', wt)
    if m:
        pack = m.group(1).strip()
    hp = ''
    m = re.search(r'体力\s*\(?[^=\n]*\)?\s*=\s*(\d+)', wt) or re.search(r'体力值?\s*=\s*(\d+)', wt)
    if m:
        hp = m.group(1)
    kingdom = ''
    m = re.search(r'势力\s*=\s*([^\|\n]+)', wt)
    if m:
        kingdom = m.group(1).strip()

    skills = []
    # 每組 {{X技能|技能（繁体字） = 名|技能描述 = 說明}}
    for m in re.finditer(r'\{\{[^{}]*技能\s*\(?繁?体?字?\)?\s*=\s*([^|}\n]+)\|([^{}]*)\}\}', wt):
        name = re.sub(r'[\[\]{}]', '', m.group(1)).strip()
        body = m.group(2)
        dm = re.search(r'技能描述\s*=\s*(.+)', body, re.S)
        desc = dm.group(1) if dm else ''
        desc = re.sub(r'<[^>]+>', '', desc)
        desc = re.sub(r'\[\[([^\]\|]+)\|([^\]]+)\]\]', r'\2', desc)
        desc = re.sub(r'\[\[([^\]]+)\]\]', r'\1', desc)
        desc = re.sub(r"'''?", '', desc).strip().strip('|').strip()
        if name and not any(s['name'] == name for s in skills):
            skills.append({'name': name, 'desc': desc})
    return {'pack': pack, 'hp': hp, 'kingdom': kingdom, 'skills': skills}


def main():
    start = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    end = int(sys.argv[2]) if len(sys.argv) > 2 else 10 ** 9
    all_names = names()
    data = {}
    if os.path.exists(OUT):
        data = json.load(open(OUT, encoding='utf-8'))
    todo = [n for n in all_names[start:end] if n not in data]
    print('總武將', len(all_names), '｜待抓', len(todo), flush=True)
    for i, n in enumerate(todo):
        d = api({'action': 'parse', 'format': 'json', 'formatversion': '2',
                 'prop': 'wikitext', 'page': n, 'redirects': '1'})
        if 'parse' not in d:
            data[n] = {'error': d.get('error', {}).get('code', 'no page')}
        else:
            rec = parse_page(d['parse']['wikitext'])
            rec['title'] = d['parse'].get('title', n)
            data[n] = rec
        if (i + 1) % 10 == 0:
            json.dump(data, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False)
            print('  ...%d/%d（最新：%s）' % (i + 1, len(todo), n), flush=True)
        time.sleep(0.6)
    json.dump(data, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False)
    ok = sum(1 for v in data.values() if 'error' not in v)
    print('完成：成功 %d／總 %d' % (ok, len(data)), flush=True)


if __name__ == '__main__':
    main()
