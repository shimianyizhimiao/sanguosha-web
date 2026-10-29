#!/usr/bin/env python3
"""把抓好的語音資料夾變成 語音.html（可搜尋、可試聽）＋ 說明.txt"""
import html, os, re, sys

SRC = sys.argv[1] if len(sys.argv) > 1 else '/Users/masahiro/.hermes/cache/scratch/sgsvoice/out'

heroes = []
for name in sorted(os.listdir(SRC)):
    d = os.path.join(SRC, name)
    if not os.path.isdir(d):
        continue
    looks = []
    for sub in sorted(os.listdir(d), key=lambda s: (s != '經典形象', s)):
        sd = os.path.join(d, sub)
        if not os.path.isdir(sd):
            continue
        files = sorted(f for f in os.listdir(sd) if f.endswith('.mp3'))

        def key(f):
            m = re.match(r'技能(\d+)_第(\d)句', f)
            return (1, int(m.group(1)), int(m.group(2))) if m else (0, 0, 0)
        files.sort(key=key)
        if files:
            looks.append((sub, files))
    if looks:
        heroes.append((name, looks))

total = sum(len(f) for _, ls in heroes for _, f in ls)

rows = []
for name, looks in heroes:
    blocks = []
    for sub, files in looks:
        items = ''.join(
            f'<label class="clip"><span>{html.escape(f[:-4])}</span>'
            f'<audio preload="none" controls src="{html.escape(name)}/{html.escape(sub)}/{html.escape(f)}"></audio></label>'
            for f in files)
        blocks.append(f'<div class="look"><h4>{html.escape(sub)}<i>{len(files)}</i></h4>{items}</div>')
    rows.append(f'<details class="hero" data-name="{html.escape(name)}"><summary><b>{html.escape(name)}</b>'
                f'<span>{sum(len(f) for _, f in looks)} 句 · {len(looks)} 個形象</span></summary>{"".join(blocks)}</details>')

doc = f"""<!doctype html><html lang="zh-Hant"><meta charset="utf-8">
<title>三國殺武將語音</title>
<style>
:root{{--bg:#12100e;--fg:#ece6da;--dim:#a49a8b;--gold:#d8b25c;--line:#332c24;--card:#1a1714}}
*{{box-sizing:border-box}}
body{{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,"PingFang TC",sans-serif}}
header{{position:sticky;top:0;background:#12100eec;backdrop-filter:blur(8px);border-bottom:1px solid var(--line);padding:14px 20px;z-index:9}}
h1{{margin:0 0 8px;font-size:19px;letter-spacing:.08em;color:var(--gold)}}
h1 small{{color:var(--dim);font-weight:400;letter-spacing:0;margin-left:10px;font-size:13px}}
.hint{{margin:8px 0 0;font-size:12px;color:var(--dim)}}
input{{width:100%;max-width:420px;padding:8px 12px;border-radius:8px;border:1px solid var(--line);background:#0c0b09;color:var(--fg);font-size:14px}}
main{{padding:16px 20px 60px;max-width:1100px}}
details.hero{{border:1px solid var(--line);border-radius:10px;background:var(--card);margin:0 0 8px;overflow:hidden}}
details.hero[hidden]{{display:none}}
summary{{cursor:pointer;padding:10px 14px;display:flex;justify-content:space-between;align-items:baseline;gap:12px}}
summary b{{font-size:16px;letter-spacing:.04em}}
summary span{{color:var(--dim);font-size:12px;white-space:nowrap}}
.look{{padding:4px 14px 12px}}
.look h4{{margin:8px 0 6px;font-size:13px;color:var(--gold);letter-spacing:.06em;font-weight:600}}
.look h4 i{{color:var(--dim);font-style:normal;font-weight:400;margin-left:6px;font-size:11px}}
.clip{{display:flex;align-items:center;gap:10px;padding:3px 0;border-top:1px solid #221d18}}
.clip span{{flex:0 0 118px;font-size:12.5px;color:var(--dim);font-family:ui-monospace,Menlo,monospace}}
audio{{height:30px;flex:1;min-width:0}}
</style>
<header><h1>三國殺 武將語音<small>{len(heroes)} 隻武將 · {total} 個語音檔</small></h1>
<input id="q" placeholder="搜武將名…（例：曹操、界、神）" autocomplete="off">
<p class="hint">點武將名展開 → 點 ▶ 才載入音檔（一次只播一句）。檔名就是技能編號與第幾句。</p></header>
<main id="list">{''.join(rows)}</main>
<script>
const q=document.getElementById('q'),list=[...document.querySelectorAll('details.hero')];
q.addEventListener('input',()=>{{const v=q.value.trim();list.forEach(d=>{{d.hidden=!!v&&!d.dataset.name.includes(v)}})}});
// 一次只播一個
document.addEventListener('play',e=>{{document.querySelectorAll('audio').forEach(a=>{{if(a!==e.target)a.pause()}})}},true);
</script></html>"""

open(os.path.join(SRC, '語音.html'), 'w', encoding='utf-8').write(doc)

readme = f"""三國殺 武將語音（{len(heroes)} 隻武將、{total} 個檔案）

怎麼用
  0. 「語音.html」是為了不用開 603 個資料夾：點武將名展開、點 ▶ 才載入（不點不會抓音檔，所以顯示 0:00 是正常的）。
  1. 雙擊「語音.html」，用 Safari／Chrome 開，可搜尋武將名、直接試聽（一次只播一句）。
  2. 也可以直接在 Finder 裡點資料夾聽，檔名就寫明是哪一句。

資料夾規則
  <武將>/經典形象/技能01_第1句.mp3 …　官方原始形象
  <武將>/形象2、形象3 …　　　　　　　其他形象（皮膚），編號照官方順序
  <武將>/…/陣亡.mp3　　　　　　　　　陣亡台詞

  技能01、技能02 是官方語音包裡的技能順序，不是我們自己排的；同一個技能的第 1、2、3 句就是該技能的多句台詞。
  有些技能（鎖定技：馬術、奇才、飛影…）官方本來就沒有配音，所以那些編號會缺，不是抓漏。

檔案
  語音.html　　可搜尋試聽的索引
  語音清單.csv　武將／官方代碼／語音檔數／有無語音
  說明.txt　　　本檔

來源
  音檔來自三國殺 OL 官方 CDN（web.sanguosha.com），武將→代碼對照取自官方 Wiki（wiki.biligame.com/sgsol「模板:对照表A」）。
  這是游卡版權素材，只放你自己的硬碟自用，不要拿去散布或上傳。
"""
open(os.path.join(SRC, '說明.txt'), 'w', encoding='utf-8').write(readme)
print(f'武將 {len(heroes)}、檔案 {total} → 語音.html / 說明.txt')
