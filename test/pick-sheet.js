/* 驗證：選將階段點「技能詳情」會開彈窗、且不會被選中 */
const { spawn } = require('child_process');
const PORT = 9490;
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
    '--user-data-dir=/tmp/sgspick3' + Date.now(), '--no-first-run', '--no-default-browser-check',
    '--window-size=1440,900', '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });
  let v = null; for (let i = 0; i < 60; i++) { try { v = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; } catch (e) { await sleep(250); } }
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  const cdp = new CDP(ws);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await sleep(1200);
  await cdp.eval(`document.querySelector('#btnStart').click()`);
  await sleep(500);
  const before = await cdp.eval(`document.querySelectorAll('.gcard.sel').length`);
  await cdp.eval(`document.querySelectorAll('.gcard .gmore')[0].click()`);
  await sleep(400);
  const state = await cdp.eval(`(() => ({
    sel: document.querySelectorAll('.gcard.sel').length,
    sheetOpen: !document.getElementById('sheet').classList.contains('hidden'),
    title: document.getElementById('sheetTitle').textContent,
    skills: [...document.querySelectorAll('#sheetBody .sk-name')].map(x => x.textContent),
    descLen: [...document.querySelectorAll('#sheetBody .sk-desc')].map(x => x.textContent.length),
  }))()`);
  console.log('點詳情前已選:', before, '→', JSON.stringify(state));
  // 關掉彈窗後再點卡片本體，應正常選將
  await cdp.eval(`document.getElementById('sheet').classList.add('hidden')`);
  await cdp.eval(`document.querySelectorAll('.gcard')[0].click()`);
  await sleep(300);
  console.log('再點卡片本體後已選:', await cdp.eval(`document.querySelectorAll('.gcard.sel').length`));
  proc.kill(); process.exit(0);
})();
