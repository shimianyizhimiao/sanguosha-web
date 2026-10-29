/* 驗證：主頁（大廳）就有背景音樂 —— 不開局，只點一下畫面 */
const { spawn } = require('child_process');
const PORT = 9492;
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
    '--user-data-dir=/tmp/sgsbgl' + Date.now(), '--no-first-run', '--no-default-browser-check',
    '--window-size=1440,900', '--force-device-scale-factor=1',
    '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
  let v = null; for (let i = 0; i < 60; i++) { try { v = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; } catch (e) { await sleep(250); } }
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  const cdp = new CDP(ws);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await sleep(1500);
  console.log('大廳可見:', await cdp.eval(`!document.getElementById('lobby').classList.contains('hidden')`));
  console.log('大廳音樂鈕:', await cdp.eval(`(document.getElementById('btnBgmLobby')||{}).textContent`));
  // 在大廳空白處點一下（模擬使用者手勢）
  await cdp.eval(`document.getElementById('lobby').click()`);
  await sleep(4000);
  const st = await cdp.eval(`window.__bgm ? window.__bgm() : 'no player'`);
  console.log('大廳播放狀態:', JSON.stringify(st));
  const iframe = await cdp.eval(`!!document.querySelector('#bgm iframe')`);
  console.log('播放器 iframe:', iframe, '｜仍在對局畫面外:', await cdp.eval(`document.getElementById('table').classList.contains('hidden')`));
  proc.kill(); process.exit(0);
})();
