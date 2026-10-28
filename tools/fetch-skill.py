#!/usr/bin/env python3
"""抓 Fandom 武將頁的技能原文（解析 {{神技能|技能=…|技能描述=…}} 模板）。

用法： python3 tools/fetch-skill.py 神刘备 神陆逊 ...
"""
import json, re, subprocess, sys, urllib.parse

UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/120 Safari/537.36')


def api(params):
    q = urllib.parse.urlencode(params)
    r = subprocess.run(['curl', '-sSL', '--max-time', '60', '-A', UA,
                        'https://sanguosha.fandom.com/zh/api.php?' + q], capture_output=True)
    try:
        return json.loads(r.stdout.decode('utf-8', 'ignore'))
    except Exception:
        return {}


def plain(t):
    t = re.sub(r"<br\s*/?>", "\n", t)
    t = re.sub(r"<[^>]+>", "", t)
    t = re.sub(r"\[\[([^\]\|]+)\|([^\]]+)\]\]", r"\2", t)
    t = re.sub(r"\[\[([^\]]+)\]\]", r"\1", t)
    t = re.sub(r"'''?", "", t)
    return t.strip()


def skill_templates(wt):
    """抽出 {{神技能|技能（繁体字）= X|技能描述 = Y}} 這類模板"""
    out = []
    for m in re.finditer(r"\{\{(神技能|技能|武将技能)\s*\|([^{}]*)\}\}", wt):
        body = m.group(2)
        d = {}
        for part in re.split(r"\|(?=[^|=]*=)", body):
            if '=' in part:
                k, v = part.split('=', 1)
                d[k.strip()] = v.strip()
        name = d.get('技能（繁体字）') or d.get('技能（繁體字）') or d.get('技能') or d.get('名称') or '?'
        desc = d.get('技能描述') or d.get('描述') or ''
        if desc:
            out.append((plain(name), plain(desc)))
    return out


for name in sys.argv[1:]:
    d = api({'action': 'parse', 'page': name, 'prop': 'wikitext', 'format': 'json',
             'formatversion': '2', 'redirects': '1'})
    if 'error' in d:
        print('##', name, '→ 找不到：', d['error'].get('info'))
        continue
    wt = d['parse']['wikitext']
    title = d['parse']['title']
    # 基本資料
    hp = re.search(r'体力上限[^=]*=\s*(\d+)', wt)
    pack = re.search(r'归属武将包\s*=\s*([^\|\n]+)', wt)
    title2 = re.search(r'武将称号[^=]*=\s*([^\|\n]+)', wt)
    print('=' * 64)
    print('## %s ｜體力 %s ｜包 %s ｜稱號 %s' % (
        title, hp.group(1) if hp else '?', (pack.group(1).strip() if pack else '?'),
        (title2.group(1).strip() if title2 else '?')))
    ts = skill_templates(wt)
    if not ts:
        print('（此頁沒有可直接解析的技能模板，需人工看頁面）')
    for n, desc in ts:
        print('  【%s】%s' % (n, desc))
