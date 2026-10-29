/* 找出遊戲中 404 的資源實際網址 */
const { spawn } = require('child_process');
const PORT = 9482;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.events = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id); }
      else if (m.method) this.events.push(m);
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, (m) => m.error ? rej(new Error(m.error.message)) : res(m.result));
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('JS: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  }
}

(async () => {
  const url = process.argv[2] || 'http://127.0.0.1:8125/index.html';
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=/tmp/sgs404' + Date.now(), '--no-first-run', '--no-default-browser-check',
    '--window-size=1440,900', '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });
  let ver = null;
  for (let i = 0; i < 60; i++) { try { ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; } catch (e) { await sleep(250); } }
  if (!ver) { console.log('無法連上 Chrome'); process.exit(1); }
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  const cdp = new CDP(ws);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');
  await sleep(1500);

  const bad = new Set();
  const check = () => {
    for (const e of cdp.events) {
      if (e.method === 'Network.responseReceived' && e.params.response.status >= 400) {
        bad.add(e.params.response.status + '  ' + e.params.response.url);
      }
      if (e.method === 'Network.loadingFailed') {
        bad.add('FAIL ' + (e.params.errorText || '') + '  ' + (e.params.requestId || ''));
      }
    }
    cdp.events.length = 0;
  };
  check();

  // 玩一局：一直選第一個武將、一直代打到結束
  await cdp.eval('window.__sgsUI.cfg.speed = 0');
  await cdp.eval(`document.querySelector('#btnStart').click()`);
  await sleep(400);
  await cdp.eval(`document.querySelectorAll('.gcard')[0].click()`);
  await sleep(1500);
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    check();
    const over = await cdp.eval(`!!(window.__sgsUI.game && window.__sgsUI.game.over)`).catch(() => true);
    if (over) break;
  }
  check();
  console.log('404／失敗資源：');
  for (const b of bad) console.log('  ' + b);
  if (!bad.size) console.log('  （沒有）');
  proc.kill();
  process.exit(0);
})();
