/* 診斷：為什麼編輯器打不開 */
const { spawn } = require('child_process');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9412;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=/tmp/sgsdbg2', '--no-first-run', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); break; } catch (e) { await sleep(200); } }
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent('http://localhost:8124/index.html')}`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let id = 0; const wait = new Map(); const msgs = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && wait.has(m.id)) { const { res } = wait.get(m.id); wait.delete(m.id); res(m.result); }
    if (m.method === 'Runtime.exceptionThrown') msgs.push('EX ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    if (m.method === 'Log.entryAdded') msgs.push('LOG ' + m.params.entry.text);
  });
  const send = (method, params) => new Promise(res => { const i = ++id; wait.set(i, { res }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) return 'THROW: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  await send('Runtime.enable'); await send('Log.enable'); await sleep(1200);

  console.log('1 按鈕在嗎：', await ev(`!!document.querySelector('#btnEditor')`));
  console.log('2 有綁 onclick：', await ev(`!!document.querySelector('#btnEditor').onclick`));
  console.log('3 點下去：', await ev(`(()=>{try{document.querySelector('#btnEditor').click();return document.querySelector('#editor').className}catch(e){return 'ERR '+e.message}})()`));
  console.log('4 技能數：', await ev(`document.querySelectorAll('.eskill').length`));
  console.log('5 載入訊息：', msgs.filter(m => /EX|LOG/.test(m)).slice(0, 6));
  ws.close(); proc.kill();
})();
