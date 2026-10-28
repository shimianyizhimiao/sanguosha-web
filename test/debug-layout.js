/* 一次性版面除錯 */
const { spawn } = require('child_process');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9401;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=/tmp/sgsdbg', '--no-first-run', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
  let v = null;
  for (let i = 0; i < 40; i++) { try { v = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; } catch (e) { await sleep(200); } }
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent('http://localhost:8124/index.html')}`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let id = 0; const wait = new Map();
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && wait.has(m.id)) { const { res } = wait.get(m.id); wait.delete(m.id); res(m.result); }
  });
  const send = (method, params) => new Promise(res => { const i = ++id; wait.set(i, { res }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
  await send('Runtime.enable'); await sleep(1200);
  await ev(`window.__sgsUI.cfg.speed=0; document.querySelector('#btnStart').click()`);
  await sleep(300);
  await ev(`document.querySelectorAll('.gcard')[0].click()`);
  await sleep(900);
  console.log(await ev(`JSON.stringify({
    board: document.querySelector('#board').getBoundingClientRect(),
    table: document.querySelector('#table').getBoundingClientRect(),
    seats: document.querySelector('#seats').getBoundingClientRect(),
    fx: document.querySelector('#fx').getBoundingClientRect(),
    rows: getComputedStyle(document.querySelector('#table')).gridTemplateRows,
    cols: getComputedStyle(document.querySelector('#table')).gridTemplateColumns,
    fxW: window.SGS_FX.W, fxH: window.SGS_FX.H,
    boardChildren: [...document.querySelector('#board').children].map(c=>c.id+':'+JSON.stringify(c.getBoundingClientRect()))
  })`));
  ws.close(); proc.kill();
})();
