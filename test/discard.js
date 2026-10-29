/* 驗證棄牌階段：手牌超上限時，閃／無懈可擊這類牌也能選 */
const { spawn } = require('child_process');
const PORT = 9488;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.p = new Map();
    ws.addEventListener('message', ev => { const m = JSON.parse(ev.data);
      if (m.id && this.p.has(m.id)) { this.p.get(m.id)(m); this.p.delete(m.id); } }); }
  send(method, params = {}) { const id = ++this.id; return new Promise((res, rej) => {
    this.p.set(id, m => m.error ? rej(new Error(m.error.message)) : res(m.result));
    this.ws.send(JSON.stringify({ id, method, params })); }); }
  async eval(e) { const r = await this.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('JS: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description)); return r.result.value; }
}
(async () => {
  const url = process.argv[2] || 'http://127.0.0.1:8125/index.html';
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=/tmp/sgsdisc' + Date.now(), '--no-first-run', '--no-default-browser-check',
    '--window-size=1440,900', '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });
  let v = null; for (let i = 0; i < 60; i++) { try { v = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; } catch (e) { await sleep(250); } }
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  const cdp = new CDP(ws);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await sleep(1200);
  await cdp.eval('window.__sgsUI.cfg.speed = 0');
  await cdp.eval(`document.querySelector('#btnStart').click()`);
  await sleep(400);
  await cdp.eval(`document.querySelectorAll('.gcard')[0].click()`);
  await sleep(1500);

  // 塞牌：讓手牌超過上限，然後直接跑棄牌階段
  await cdp.eval(`(() => {
    const g = window.__sgsUI.game, p = g.players[0];
    p.hp = 2;
    while (p.hand.length < 7) p.hand.push(g.deck.pop());
    window.__discardDone = g.discardPhase(p).then(() => 'done');
    return p.hand.length;
  })()`);
  await sleep(600);
  const state = await cdp.eval(`(() => {
    const cards = [...document.querySelectorAll('#hand .card')];
    return { total: cards.length,
             disabled: cards.filter(c => c.classList.contains('dis')).length,
             names: cards.map(c => (c.querySelector('.cname')||{}).textContent + (c.classList.contains('dis') ? '✗' : '✓')) };
  })()`);
  console.log('棄牌詢問時手牌狀態:', JSON.stringify(state));
  proc.kill(); process.exit(0);
})();
