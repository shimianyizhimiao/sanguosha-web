const { spawn } = require('child_process');
const PORT = 9431;
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const proc = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=/tmp/sgsvar',
      '--no-first-run', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); break; } catch (e) { await sleep(200); } }
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent('http://127.0.0.1:8124/index.html')}`, { method: 'PUT' })).json();
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
  // 只留界將包，逼出界字輩
  console.log('包選項：', await ev(`JSON.stringify([...document.querySelectorAll('#gpackOpts .opt')].map(b=>b.textContent))`));
  await ev(`(()=>{const btns=[...document.querySelectorAll('#gpackOpts .opt')];
     btns.forEach(b=>{const on=b.classList.contains('on'); const isJie=b.textContent.includes('界');
       if(on!==isJie) b.click();}); return true;})()`);
  await ev("document.querySelector('#btnStart').click()");
  await sleep(1200);
  console.log('界將總數：', await ev(`Object.values(window.SGS_GENERALS).filter(g=>g.pack==='jie').length`));
  console.log(await ev(`JSON.stringify([...document.querySelectorAll('.gcard')].map(c=>({
    name: c.querySelector('.gname').textContent,
    src: c.querySelector('.gport img').getAttribute('src'),
    loaded: c.querySelector('.gport img').naturalWidth > 0
  })))`));
  ws.close(); proc.kill();
})();
