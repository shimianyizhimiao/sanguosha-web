#!/usr/bin/env python3
# 抓 Fandom 三國殺武將列表的 wikitext，解析「武將總表」裡的武將名與所屬包
import json, re, subprocess, urllib.parse, os

UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/120 Safari/537.36')
TITLE = '三国杀武将列表'


def api(params):
    q = urllib.parse.urlencode(params)
    r = subprocess.run(['curl', '-sSL', '--max-time', '60', '-A', UA,
                        'https://sanguosha.fandom.com/zh/api.php?' + q], capture_output=True)
    try:
        return json.loads(r.stdout.decode('utf-8', 'ignore'))
    except Exception:
        return {}


d = api({'action': 'parse', 'page': TITLE, 'prop': 'wikitext', 'format': 'json', 'formatversion': '2'})
if 'error' in d:
    print('API 錯誤：', d['error'])
    raise SystemExit(1)
wt = d['parse']['wikitext']
open('/tmp/heroes.wiki', 'w', encoding='utf-8').write(wt)
print('wikitext 字數：', len(wt))

# 找「武將總表」段落
i = wt.find('武將總表')
if i < 0:
    i = wt.find('武将总表')
print('總表位置：', i)
seg = wt[i:i + 60000] if i >= 0 else wt

# 表格列：抓每列第一個出現的 [[武將]] 連結
rows = re.findall(r'\n\|[^\n]*', seg)
names = []
for line in rows:
    links = re.findall(r'\[\[([^\]\|#]+)(?:\|[^\]]*)?\]\]', line)
    if not links:
        continue
    nm = links[0].strip()
    if 1 <= len(nm) <= 5 and not any(k in nm for k in ['三國', '武将', '分类', '文件', 'File', 'Category']):
        names.append(nm)

seen = []
for n in names:
    if n not in seen:
        seen.append(n)
print('抓到名字數：', len(seen))
print('、'.join(seen[:80]))
open('/tmp/hero_names.json', 'w', encoding='utf-8').write(json.dumps(seen, ensure_ascii=False))
