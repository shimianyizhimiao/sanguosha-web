/* 自定義武將編輯器流程測試 */
const { spawn } = require('child_process');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9411;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=/tmp/sgsed', '--no-first-run', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); break; } catch (e) { await sleep(200); } }
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent('http://localhost:8124/index.html')}`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let id = 0; const wait = new Map(); const errs = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && wait.has(m.id)) { const { res } = wait.get(m.id); wait.delete(m.id); res(m.result); }
    if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  });
  const send = (method, params) => new Promise(res => { const i = ++id; wait.set(i, { res }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;

  await send('Runtime.enable'); await sleep(1000);
  console.log('開編輯器：', await ev(`(()=>{document.querySelector('#btnEditor').click();return !document.querySelector('#editor').classList.contains('hidden')})()`));
  console.log('技能數：', await ev(`document.querySelectorAll('.eskill').length`));
  await ev(`(()=>{document.querySelector('#edName').value='測試武將';
    document.querySelectorAll('.eskill')[3].click();
    document.querySelectorAll('.eskill')[10].click();
    document.querySelector('#edSave').click(); return true;})()`);
  await sleep(300);
  console.log('存檔結果：', await ev(`JSON.stringify({
    stored: localStorage.getItem('sgs.customGenerals.v1'),
    inTable: !!window.SGS_GENERALS['測試武將'],
    customCount: Object.values(window.SGS_GENERALS).filter(g=>g.pack==='custom').length,
    lobbyBtn: [...document.querySelectorAll('#gpackOpts .opt')].map(b=>b.textContent).filter(t=>t.includes('自定義'))
  })`));
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  require('fs').writeFileSync(__dirname + '/../shots/editor.png', Buffer.from(shot.data, 'base64'));
  console.log('例外：', errs.length ? errs.slice(0, 3) : '無');
  ws.close(); proc.kill();
})();
