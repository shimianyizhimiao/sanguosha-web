/* 武將專屬曲：選到諸葛亮（任何版本）就換歌，其他人維持原本 BGM
   node test/bgm-theme.js [url] */
const path = require('path');
const H = require('./harness');
const URL0 = process.argv[2] || 'http://127.0.0.1:8125/index.html';
if (/127\.0\.0\.1|localhost/.test(URL0)) require('child_process').execFileSync(path.join(__dirname, 'serve.sh'), ['8125'], { stdio: 'inherit' });
const ev = H.evalOn;
let fails = 0;
const check = (c, m) => { if (!c) fails++; console.log((c ? '✅' : '❌') + ' ' + m); };

(async () => {
  await H.ensureChrome();
  const A = await H.openTab(URL0, { ready: `typeof window.__sgsUI === 'object'` });
  await H.sleep(800);

  const cfg = await ev(A, `fetch('assets/bgm/config.json').then(r => r.json()).then(c => JSON.stringify(c.generalThemes || null))`);
  check(/諸葛亮/.test(String(cfg)), `config 有武將專屬曲設定（${cfg}）`);

  // 直接開選將畫面，給三隻（含神諸葛亮）→ 點下去要換歌
  for (const who of ['神諸葛亮', '界諸葛亮', '諸葛亮']) {
    const started = await ev(A, `(() => {
      const names = ['劉備', ${JSON.stringify(who)}, '孫權'];
      const cands = names.map(n => window.SGS_GENERALS[n]).filter(Boolean);
      window.__sgsUI.net.pickNet(cands, 1, () => {});
      return cands.map(c => c.name).join(',');
    })()`);
    await H.sleep(300);
    // 真的點那張卡（點擊＝使用者手勢，播放才不会被擋）
    const clicked = await ev(A, `(() => {
      const card = [...document.querySelectorAll('#pickCards .gcard')].find(c => c.querySelector('.gname').textContent === ${JSON.stringify(who)});
      if (!card) return 'no-card';
      card.click();
      return 'ok';
    })()`);
    await H.sleep(900);
    const theme = await ev(A, `JSON.stringify(window.__bgmTheme())`);
    const t = JSON.parse(theme || 'null');
    check(clicked === 'ok' && !!t && t.name === '諸葛亮', `選【${who}】→ 換成諸葛亮專屬曲（${theme}）`);
    check(!!t && t.paused === false, `專屬曲真的在播（paused=${t && t.paused}）`);
    // 回到大廳要還原
    await ev(A, `window.__sgsUI.net.backToLobby()`);
    await H.sleep(400);
    const after = await ev(A, `JSON.stringify(window.__bgmTheme())`);
    check(after === 'null', `回大廳後專屬曲停止（${after}）`);
  }

  // 選別人（劉備）不該換
  await ev(A, `(() => { const cands = ['劉備','孫權','曹操'].map(n => window.SGS_GENERALS[n]).filter(Boolean);
    window.__sgsUI.net.pickNet(cands, 1, () => {}); return cands.length; })()`);
  await H.sleep(300);
  await ev(A, `(() => { const c = [...document.querySelectorAll('#pickCards .gcard')].find(x => x.querySelector('.gname').textContent === '劉備'); c && c.click(); })()`);
  await H.sleep(600);
  const none = await ev(A, `JSON.stringify(window.__bgmTheme())`);
  check(none === 'null', `選【劉備】不換曲（${none}）`);

  await H.closeTab(A);
  console.log(fails === 0 ? '\n全部通過' : `\n${fails} 項失敗`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('失敗：', e.message); process.exit(1); });
