const { spawn } = require('child_process');
const PORT = 9422;
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const proc = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=/tmp/sgspick2',
      '--no-first-run', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); break; } catch (e) { await sleep(200); } }
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent('http://127.0.0.1:8125/index.html')}`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let id = 0; const wait = new Map();
  ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && wait.has(m.id)) { const { res } = wait.get(m.id); wait.delete(m.id); res(m.result); } });
  const send = (method, params) => new Promise(res => { const i = ++id; wait.set(i, { res }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const ev = async e => {
    const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) return 'ERR ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description);
    return r.result.value;
  };
  await send('Page.enable'); await send('Runtime.enable'); await sleep(1300);
  console.log('切雙將：', await ev("document.querySelector('.opt[data-double=\"1\"]').click(); 'ok'"));
  await sleep(200);
  console.log('開始：', await ev("document.querySelector('#btnStart').click(); 'ok'"));
  await sleep(1500);
  console.log('候選卡數：', await ev("document.querySelectorAll('.gcard').length"));
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  require('fs').writeFileSync(process.env.HOME + '/sgs/shots/pick.png', Buffer.from(shot.data, 'base64'));
  await ev("document.querySelectorAll('.gcard')[0].click()");
  await sleep(400);
  await ev("document.querySelectorAll('.gcard')[1].click()");
  await sleep(1500);
  console.log('進入對局：', await ev("!document.querySelector('#table').classList.contains('hidden')"));
  const shot2 = await send('Page.captureScreenshot', { format: 'png' });
  require('fs').writeFileSync(process.env.HOME + '/sgs/shots/dual.png', Buffer.from(shot2.data, 'base64'));
  ws.close(); proc.kill();
})();
