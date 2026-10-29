/* 手機視窗（390×844）檢查：能不能選將、看得到手牌與按鈕 */
const { spawn } = require('child_process');
const PORT = 9455;
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const proc = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=/tmp/sgsm-' + Date.now(), '--no-first-run',
      '--window-size=390,844', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); break; } catch (e) { await sleep(200); } }
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(process.argv[2] || 'https://shimianyizhimiao.github.io/sanguosha-web/index.html')}`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let id = 0; const wait = new Map();
  ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && wait.has(m.id)) { const { res } = wait.get(m.id); wait.delete(m.id); res(m.result); } });
  const send = (method, params) => new Promise(res => { const i = ++id; wait.set(i, { res }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const ev = async e => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result.value;

  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await sleep(1500);

  const info = await ev(`(() => {
    const q = s => document.querySelector(s);
    const box = e => e ? e.getBoundingClientRect() : null;
    const hand = box(q('#hand'));
    return {
      vw: innerWidth, vh: innerHeight,
      bodyScrollW: document.body.scrollWidth,
      hasOverflowX: document.body.scrollWidth > innerWidth + 2,
      hand: hand && {x: Math.round(hand.x), w: Math.round(hand.width), h: Math.round(hand.height)},
      buttons: [...document.querySelectorAll('button')].slice(0, 4).map(b => ({t: b.textContent.trim().slice(0,6), w: Math.round(b.getBoundingClientRect().width)})),
    };
  })()`);
  console.log('版面：', JSON.stringify(info));
  let shot = await send('Page.captureScreenshot', { format: 'png' });
  require('fs').writeFileSync('/Users/masahiro/sgs/shots/mobile-lobby.png', Buffer.from(shot.data, 'base64'));

  // 進對局：開始 → 選將 → 等 AI 打完幾手
  await ev(`document.querySelector('#btnStart').click()`);
  await sleep(600);
  await ev(`document.querySelectorAll('.gcard')[0].click()`);
  await sleep(2500);
  const table = await ev(`(() => {
    const b = s => { const e = document.querySelector(s); if(!e) return null; const r = e.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}; };
    return { seats: document.querySelectorAll('.seat').length, hand: b('#hand'), handCards: document.querySelectorAll('#hand .card').length,
             board: b('#board'), log: b('#log'), overflowX: document.body.scrollWidth > innerWidth + 2,
             cardW: (() => { const c = document.querySelector('#hand .card'); return c ? Math.round(c.getBoundingClientRect().width) : 0; })() };
  })()`);
  console.log('對局版面：', JSON.stringify(table));
  shot = await send('Page.captureScreenshot', { format: 'png' });
  require('fs').writeFileSync('/Users/masahiro/sgs/shots/mobile-table.png', Buffer.from(shot.data, 'base64'));
  console.log('截圖 shots/mobile-table.png');
  ws.close(); proc.kill();
})();
