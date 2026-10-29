/* 驗證新增武將包：大廳清單、選將、能否開局 */
const { spawn } = require('child_process');
const PORT = 9494;
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
    '--user-data-dir=/tmp/sgspk' + Date.now(), '--no-first-run', '--no-default-browser-check',
    '--window-size=1440,900', '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });
  let v = null; for (let i = 0; i < 60; i++) { try { v = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; } catch (e) { await sleep(250); } }
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  const cdp = new CDP(ws);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await sleep(1400);
  const packs = await cdp.eval(`[...document.querySelectorAll('#gpackOpts .opt')].map(b => b.textContent.trim())`);
  console.log('武將包按鈕：\n  ' + packs.join('\n  '));

  // 只勾風林火山
  await cdp.eval(`(() => {
    const btns = [...document.querySelectorAll('#gpackOpts .opt')];
    const on = btns.filter(b => b.classList.contains('on'));
    on.forEach(b => { if (!b.textContent.includes('風林火山')) b.click(); });
    const wf = btns.find(b => b.textContent.includes('風林火山'));
    if (wf && !wf.classList.contains('on')) wf.click();
    return (window.__sgsUI.cfg.generalPacks || []).join(',');
  })()`);
  console.log('目前武將包:', await cdp.eval(`window.__sgsUI.cfg.generalPacks.join(',')`));
  await cdp.eval('window.__sgsUI.cfg.speed = 0');
  await cdp.eval(`document.querySelector('#btnStart').click()`);
  await sleep(600);
  const cands = await cdp.eval(`[...document.querySelectorAll('.gcard .gname')].map(x => x.textContent)`);
  const marks = await cdp.eval(`document.querySelectorAll('.gcard.untested').length`);
  console.log('候選:', cands.join('、'), '｜技能未實作標記:', marks);
  await cdp.eval(`document.querySelectorAll('.gcard')[0].click()`);
  await sleep(1800);
  const gens = await cdp.eval(`window.__sgsUI.game.players.map(p=>p.generals.map(g=>g.name).join('&')+'['+p.skills.join('/')+']').join(' | ')`);
  console.log('開局武將:', gens);
  proc.kill(); process.exit(0);
})();
