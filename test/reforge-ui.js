/* 重鑄按鈕（真瀏覽器）：出牌階段應該看得到【重鑄】，點下去能挑牌並回傳 {reforge:id}
   node test/reforge-ui.js [url] */
const path = require('path');
const H = require('./harness');
const URL0 = process.argv[2] || 'http://127.0.0.1:8125/index.html';
if (/127\.0\.0\.1|localhost/.test(URL0)) require('child_process').execFileSync(path.join(__dirname, 'serve.sh'), ['8125'], { stdio: 'inherit' });
const ev = H.evalOn;
let fails = 0;
const check = (c, m) => { if (!c) fails++; console.log((c ? '✅' : '❌') + ' ' + m); };

(async () => {
  await H.ensureChrome();
  const A = await H.openTab(URL0, { ready: `typeof window.SGS_NETPLAY === 'object' && !!window.__sgsUI.net` });
  // 直接用 ui 的 showAsk 灌一個出牌請求（含重鑄清單），不必等隨機牌局
  const prepared = await ev(A, `(() => {
    const G = window.SGS_GENERALS['劉備'];
    const mk = window.SGS_SETUP.makeGame({ mode:'duel', packs:['std','ex'], generalPacks:['std'], forcedGenerals:[[G],[window.SGS_GENERALS['孫權']]] });
    mk.players[0].controller = { isHuman: true };
    mk.players[1].controller = { isHuman: false };
    const chain = window.SGS_CARDS.buildDeck(['std','ex']).find(c => c.name === '鐵索連環');
    mk.players[0].hand.length = 0; mk.players[0].hand.push(chain);
    window.__resolve = null;
    window.__sgsUI.net.showAsk(mk, 0, {
      kind:'play', prompt:'出牌階段', cards: [], skills: [],
      reforge: [{ id: chain.id, name: chain.name, suit: chain.suit, rank: chain.rank }],
      canEnd: true,
    }, (v) => { window.__resolve = v; });
    return chain.id;
  })()`);
  await H.sleep(500);

  const hasBtn = await ev(A, `[...document.querySelectorAll('#actions button')].some(b => b.textContent.includes('重鑄'))`);
  check(hasBtn, '出牌階段出現【重鑄】按鈕');

  await ev(A, `[...document.querySelectorAll('#actions button')].find(b => b.textContent.includes('重鑄')).click()`);
  await H.sleep(300);
  const opts = await ev(A, `[...document.querySelectorAll('#actions button')].map(b => b.textContent)`);
  check(opts.some(t => /重鑄 .*【鐵索連環】/.test(t)), `重鑄清單列出牌（${opts.join(' / ')}）`);

  await ev(A, `[...document.querySelectorAll('#actions button')].find(b => /重鑄 .*【鐵索連環】/.test(b.textContent)).click()`);
  await H.sleep(300);
  const got = await ev(A, `JSON.stringify(window.__resolve)`);
  check(JSON.parse(got || '{}').reforge === prepared, `點下去回傳 { reforge: ${prepared} }（${got}）`);

  await H.closeTab(A);
  console.log(fails === 0 ? '\n全部通過' : `\n${fails} 項失敗`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('失敗：', e.message); process.exit(1); });
