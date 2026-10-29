#!/usr/bin/env python3
"""把 /tmp/generals-raw.json 轉成 js/generals-packs.js
   - 依「武將包」分組：風林火山（神話再臨）、界限突破、門閥士族、魔、謀、國戰、其他
   - 名稱用 Fandom 的「武将名称(繁体)」
   - 技能名沿用已實作者；未實作的收錄官方描述並標 todo（UI 會標「未實作」）
"""
import json, os, re, subprocess

RAW = '/tmp/generals-final.json'
OUT = 'js/generals-packs.js'
KINGDOM = {'WEI': '魏', 'SHU': '蜀', 'WU': '吳', 'QUN': '群', 'JIN': '晉', 'SHEN': '神', 'Shen': '神',
           '魏': '魏', '蜀': '蜀', '吴': '吳', '吳': '吳', '群': '群', '晋': '晉', '晉': '晉', '神': '神'}


def existing():
    """已實作武將名 / 技能名：直接讀原始碼，不經過 node（避免 packs 檔未生成時互相卡住）"""
    gens, skills = set(), set()
    for f in ('js/generals.js', 'js/generals-extra.js'):
        src = open(f, encoding='utf-8').read()
        gens.update(re.findall(r"name:\s*'([^']+)'", src))
        skills.update(re.findall(r"SK\['([^']+)'\]", src))
        skills.update(re.findall(r"\[\s*'([^']+)'\s*,\s*'[魏吳蜀群晉神魔]'", src))
    return {'generals': gens, 'skills': skills}


T2S = {'国':'國','关':'關','张':'張','马':'馬','华':'華','云':'雲','赵':'趙','孙':'孫','吴':'吳','吕':'呂',
       '陆':'陸','逊':'遜','庞':'龐','贾':'賈','辽':'遼','许':'許','韦':'韋','邓':'鄧','陈':'陳','郑':'鄭',
       '韩':'韓','蒋':'蔣','费':'費','严':'嚴','罗':'羅','苏':'蘇','鲁':'魯','鲍':'鮑','齐':'齊','冯':'馮',
       '刘':'劉','杨':'楊','黄':'黃','龙':'龍','娄':'婁','钟':'鐘','阎':'閻','顾':'顧','谢':'謝','宁':'寧',
       '维':'維','获':'獲','肃':'肅','闿':'闓','统':'統','蝉':'蟬','绍':'紹','术':'術','诸':'諸','关':'關',
       '记':'記','议':'議','让':'讓','谏':'諫','谌':'諶','谧':'謐','诞':'誕','诞':'誕','领':'領','飞':'飛',
       '坚':'堅','权':'權','济':'濟','绪':'緒','荣':'榮','宪':'憲','华':'華','范':'範','严':'嚴','师':'師',
       '学':'學','举':'舉','兴':'興','义':'義','气':'氣','军':'軍','战':'戰','国':'國','斗':'鬥','阵':'陣'}


_NM = json.load(open('/tmp/name_map.json', encoding='utf-8'))
NAME_MAP = _NM['names']
T2S.update(_NM['chars'])


def to_trad(s):
    if s in NAME_MAP:
        return NAME_MAP[s]
    return ''.join(T2S.get(ch, ch) for ch in s)


def group_of(name, pack):
    p = pack or ''
    if '神話再臨' in p:
        return 'windfire'
    if '界限突破' in p:
        return 'jie'
    if '門閥' in p or '士族' in p or '王氏' in p or '吳氏' in p or '荀氏' in p or '諸葛氏' in p:
        return 'menfa'
    if name.startswith('魔') or '魔' in p:
        return 'mo'
    if '謀' in p:
        return 'mou'
    if '國戰' in p:
        return 'guozhan'
    return 'other'


def main():
    raw = json.load(open(RAW, encoding='utf-8'))
    ex = existing()
    have_gen = set(ex['generals'])
    have_sk = set(ex['skills'])

    entries, todos = [], {}
    skipped = 0
    for key, rec in raw.items():
        if not rec.get('skills'):
            skipped += 1
            continue
        name = (rec.get('trad') or '').strip()
        if not name or not any('\u4e00' <= c <= '\u9fff' for c in name):
            name = to_trad(key)
        name = to_trad(name)
        # 魔／界／神 頁面的「武将名称(繁体)」常常只寫本名，補回前綴
        for pre in ('魔', '界', '神', 'SP', '君'):
            if key.startswith(pre) and not name.startswith(pre):
                name = pre + name
                break
        if not name or name in have_gen:
            skipped += 1
            continue
        if any(c in name for c in '、，,/'):
            skipped += 1
            continue
        kd = KINGDOM.get(rec.get('kingdom', ''), '群')
        if rec.get('grp') == 'mo' and name.startswith('魔'):
            kd = '魔'
        hp = int(rec.get('hp') or 4)
        grp = rec.get('grp') or group_of(name, rec.get('pack', ''))
        sk = []
        for s in rec['skills']:
            nm = re.sub(r'<[^>]*>', '', s['name'])
            nm = nm.replace("'", '').replace('「', '').replace('」', '').strip()
            nm = re.sub(r'\s+', '', nm)
            if '、' in nm:
                continue
            nm = to_trad(nm)
            if nm not in sk:
                sk.append(nm)
            if nm not in have_sk:
                todos.setdefault(nm, s.get('desc', ''))
        if not sk:
            skipped += 1
            continue
        entries.append({'name': name, 'kingdom': kd, 'hp': hp, 'skills': sk,
                        'pack': grp, 'src': rec.get('pack', '')})

    lines = ['/* 自動生成：python3 tools/build-packs.py（來源 Fandom 武將頁） */', '(function (root) {',
             '  const G = root.SGS_GENERALS, SK = root.SGS_SKILLS;', '',
             '  /* 尚未實作效果的技能：保留官方描述，遊戲內標「未實作」，不會假裝能發動 */',
             '  const TODO_SKILLS = {']
    for nm, desc in sorted(todos.items()):
        d = re.sub(r'\s+', ' ', re.sub(r'<[^>]*>', '', desc)).strip()
        lines.append('    %s: %s,' % (json.dumps(nm, ensure_ascii=False), json.dumps(d[:400], ensure_ascii=False)))
    lines.append('  };')
    lines.append('  for (const k in TODO_SKILLS) {')
    lines.append("    if (!SK[k]) SK[k] = { type: 'passive', todo: true, desc: TODO_SKILLS[k] };")
    lines.append('  }')
    lines.append('')
    lines.append('  const PACKS = [')
    for e in entries:
        lines.append('    [%s, %s, %d, [%s], %s],' %
                     (json.dumps(e['name'], ensure_ascii=False), json.dumps(e['kingdom'], ensure_ascii=False),
                      e['hp'], ', '.join(json.dumps(x, ensure_ascii=False) for x in e['skills']),
                      json.dumps(e['pack'], ensure_ascii=False)))
    lines.append('  ];')
    lines.append('''  for (const [name, kingdom, hp, skills, pack] of PACKS) {
    if (G[name]) continue;
    G[name] = { name, kingdom, hp, gender: 'male', pack, skills };
  }
  root.SGS_PACK_NAMES = Object.assign({
    windfire: '神話再臨（風林火山）', jie: '界限突破', menfa: '門閥士族',
    mo: '魔', mou: '謀', guozhan: '國戰', other: '其他',
  }, root.SGS_PACK_NAMES || {});
})(typeof window !== 'undefined' ? window : globalThis);
''')
    open(OUT, 'w', encoding='utf-8').write('\n'.join(lines))

    from collections import Counter
    c = Counter(e['pack'] for e in entries)
    print('寫入', OUT, '｜武將', len(entries), '｜未實作技能', len(todos), '｜略過', skipped)
    for k, v in c.most_common():
        print('  ', k, v)


if __name__ == '__main__':
    main()
