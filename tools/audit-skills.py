#!/usr/bin/env python3
"""比對我方武將技能名稱與 Fandom 官方頁面是否一致。
   用法：python3 tools/audit-skills.py [jie|sp|famous|all]
"""
import json, re, subprocess, sys, time, urllib.parse

UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/120 Safari/537.36')
SIMP = {'劉備':'刘备','關羽':'关羽','張飛':'张飞','趙雲':'赵云','馬超':'马超','黃月英':'黄月英',
        '諸葛亮':'诸葛亮','曹操':'曹操','司馬懿':'司马懿','夏侯惇':'夏侯惇','張遼':'张辽','許褚':'许褚',
        '郭嘉':'郭嘉','甄姬':'甄姬','孫權':'孙权','甘寧':'甘宁','呂蒙':'吕蒙','黃蓋':'黄盖','周瑜':'周瑜',
        '大喬':'大乔','陸遜':'陆逊','孫尚香':'孙尚香','華佗':'华佗','呂布':'吕布','貂蟬':'貂蝉',
        '賈詡':'贾诩','曹丕':'曹丕','徐晃':'徐晃','張郃':'张郃','龐德':'庞德','荀彧':'荀彧',
        '關興':'关兴','張苞':'张苞','孫魯班':'孙鲁班'}


def simp(name):
    m = re.match(r'^(界|神|SP)', name)
    pre = m.group(1) if m else ''
    rest = name[len(pre):].split('·')[0]
    return pre + SIMP.get(rest, rest)


def wikitext(title):
    q = urllib.parse.urlencode({'action': 'parse', 'format': 'json', 'formatversion': '2',
                               'prop': 'wikitext', 'page': title})
    r = subprocess.run(['curl', '-sSL', '--max-time', '45', '-A', UA,
                        'https://sanguosha.fandom.com/zh/api.php?' + q], capture_output=True)
    try:
        d = json.loads(r.stdout.decode('utf-8', 'ignore'))
        return d.get('parse', {}).get('wikitext', '')
    except Exception:
        return ''


def all_skills(wt):
    """一頁裡所有版本出現過的技能名"""
    names = []
    for m in re.finditer(r'技能（繁体字）\s*=\s*([^\|\n}]+)', wt):
        v = re.sub(r'[\[\]{}]', '', m.group(1)).strip()
        if v and v not in names:
            names.append(v)
    for m in re.finditer(r'\{\{(?:神技能|技能|武将技能)\s*\|([^{}]*)\}\}', wt):
        for part in re.split(r'\|(?=[^|=]*=)', m.group(1)):
            if '=' in part:
                k, v = part.split('=', 1)
                if k.strip().replace(' ', '') in ('技能', '技能名', '技能（繁体字）'):
                    v = re.sub(r'[\[\]{}]', '', v).strip()
                    if v and v not in names:
                        names.append(v)
    return names


def jie_skills(wt):
    """界限突破區塊裡的技能名"""
    i = wt.find('身份平台2=界限突破')
    if i < 0:
        return []
    j = wt.find('身份平台3=', i)
    seg = wt[i:j if j > 0 else i + 6000]
    names = []
    for m in re.finditer(r'技能（繁体字）\s*=\s*([^\|\n}]+)', seg):
        v = re.sub(r'[\[\]{}]', '', m.group(1)).strip()
        if v and v not in names:
            names.append(v)
    return names


def main():
    which = sys.argv[1] if len(sys.argv) > 1 else 'all'
    out = subprocess.run(['node', '-e', r"""
const {root}=require(process.env.HOME+'/sgs/test/load');
const G=root.SGS_GENERALS;
console.log(JSON.stringify(Object.fromEntries(Object.entries(G).map(([n,g])=>[n,{pack:g.pack,hp:g.hp,skills:g.skills}]))));
"""], capture_output=True)
    roster = json.loads(out.stdout.decode())
    targets = [(n, v) for n, v in roster.items() if which == 'all' or v['pack'] == which]
    bad = 0
    for name, info in targets:
        title = simp(name)
        if info['pack'] == 'jie':
            title = title[1:]          # 界將沒有獨立頁面，技能在原名頁面的界限突破區塊
        wt = wikitext(title)
        if not wt:
            print('%-14s 頁面抓不到（%s）' % (name, title))
            continue
        ours = [s.split('·')[0] for s in info['skills']]
        allsk = all_skills(wt)
        if info['pack'] == 'jie':
            off = jie_skills(wt)
            if not off:
                # 抓不到界限突破區塊：用「全頁技能 − 標準版技能」推算
                std_name = name[1:]
                std = roster.get(std_name, {}).get('skills') or []
                std = [x.split('·')[0] for x in std]
                off = [x for x in allsk if x not in std]
        else:
            off = allsk
        if not off:
            print('%-14s 官方頁解析不到技能（%s），需人工看' % (name, title))
            continue
        missing = [s for s in off if s not in ours]
        extra = [s for s in ours if s not in off]
        if missing or extra:
            bad += 1
            print('%-14s 我方 %s ｜官方 %s ｜缺 %s ｜多 %s'
                  % (name, '/'.join(ours), '/'.join(off), ','.join(missing) or '-', ','.join(extra) or '-'))
        time.sleep(0.4)
    print('\n比對 %d 隻，名稱不一致 %d 隻' % (len(targets), bad))


if __name__ == '__main__':
    main()
