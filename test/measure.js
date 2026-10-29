/* 量各層容器寬度，找出誰把版面撐寬 */
const { spawn } = require('child_process');
const PORT = 9484;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = [];
    ws.addEventListener('message', ev => { const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id); } else if (m.method) this.events.push(m); }); }
  send(method, params = {}) { const id = ++this.id; return new Promise((res, rej) => {
    this.pending.set(id, m => m.error ? rej(new Error(m.error.message)) : res(m.result));
    this.ws.send(JSON.stringify({ id, method, params })); }); }
  async eval(e) { const r = await this.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('JS: ' + r.exceptionDetails.exception.description); return r.result.value; }
}
(async () => {
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=/tmp/sgsm2' + Date.now(), '--window-size=390,844', '--force-device-scale-factor=1',
    '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
  let v = null; for (let i = 0; i < 60; i++) { try { v = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; } catch (e) { await sleep(250); } }
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent('http://127.0.0.1:8125/index.html')}`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  const cdp = new CDP(ws);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(1000);
  await cdp.eval('window.__sgsUI.cfg.speed = 0');
  await cdp.eval(`document.querySelector('#btnStart').click()`);
  await sleep(400);
  await cdp.eval(`document.querySelectorAll('.gcard')[0].click()`);
  await sleep(2000);
  const out = await cdp.eval(`(() => {
    const ids = ['table','board','bottom','topbar','hand','actions','seats','myequips'];
    const r = { vw: innerWidth, doc: document.documentElement.scrollWidth, body: document.body.scrollWidth };
    for (const id of ids) {
      const el = document.getElementById(id);
      if (!el) { r[id] = null; continue; }
      const b = el.getBoundingClientRect();
      r[id] = { w: Math.round(b.width), x: Math.round(b.x), sw: el.scrollWidth, css: getComputedStyle(el).width + '/' + getComputedStyle(el).paddingLeft + '/' + getComputedStyle(el).boxSizing };
    }
    return r;
  })()`);
  console.log(JSON.stringify(out, null, 1));
  proc.kill(); process.exit(0);
})();
