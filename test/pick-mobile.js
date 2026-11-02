/* 手機版選將：390×844 檢查能不能滑、卡片有沒有被切、提示有沒有固定
   node test/pick-mobile.js [url] */
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const OUT = path.join(__dirname, '..', 'shots');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const URL0 = process.argv[2] || 'http://127.0.0.1:8125/index.html';
if (/127\.0\.0\.1|localhost/.test(URL0)) require('child_process').execFileSync(path.join(__dirname, 'serve.sh'), ['8125'], { stdio: 'inherit' });
const ev = H.evalOn;

(async () => {
  await H.ensureChrome();
  const A = await H.openTab(URL0, { ready: `typeof window.SGS_NETPLAY === 'object'` });
  await A.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await H.sleep(400);
  // 直接叫出選將畫面（雙將＝5 張卡，最擠的情況）
  await ev(A, `(() => {
    const pack = window.__sgsUI.net.cfg.generalPacks;
    const pool = Object.values(window.SGS_GENERALS).filter(g => pack.includes(g.pack));
    const cands = pool.slice(0, 5);
    window.__sgsUI.net.pickNet(cands, 2, () => {});
    return cands.length;
  })()`);
  await H.sleep(600);

  const m = await ev(A, `(() => {
    const pick = document.getElementById('pick');
    const cards = [...document.querySelectorAll('#pickCards .gcard')];
    const rows = new Set(cards.map(c => Math.round(c.getBoundingClientRect().top)));
    const hint = document.getElementById('pickHint');
    const hb = hint.getBoundingClientRect();
    const overflowX = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    return JSON.stringify({
      cards: cards.length,
      perRow: cards.filter(c => Math.round(c.getBoundingClientRect().top) === Math.round(cards[0].getBoundingClientRect().top)).length,
      rows: rows.size,
      cardW: Math.round(cards[0].getBoundingClientRect().width),
      pickScrollable: pick.scrollHeight > pick.clientHeight + 4,
      canScroll: getComputedStyle(pick).overflowY,
      hintText: hint.textContent,
      hintBottom: Math.round(innerHeight - hb.bottom),
      hintVisible: hb.top < innerHeight && hb.bottom > 0,
      overflowX,
    });
  })()`);
  console.log('   手機選將量測：', m);

  // 真的滑一下，確認最下面那張卡能進來
  await A.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 200, y: 500, deltaX: 0, deltaY: 600 });
  await H.sleep(400);
  const after = await ev(A, `(() => { const c = [...document.querySelectorAll('#pickCards .gcard')].pop();
    const b = c.getBoundingClientRect(); return JSON.stringify({ lastCardTop: Math.round(b.top), lastCardVisible: b.top < innerHeight && b.bottom > 0 }); })()`);
  console.log('   滑到底後：', after);
  await H.screenshot(A, path.join(OUT, 'pick-mobile.png'));
  await H.closeTab(A);
  process.exit(0);
})().catch((e) => { console.error('失敗：', e.message); process.exit(1); });
