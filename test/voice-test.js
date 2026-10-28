const { spawn } = require('child_process');
const PORT = 9441;
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const proc = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=/tmp/sgsvoice',
      '--no-first-run', '--autoplay-policy=no-user-gesture-required',
      '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
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
  await send('Page.enable'); await send('Runtime.enable'); await sleep(1200);

  console.log('模組載入：', await ev(`!!window.SGS_VOICE`));
  console.log('抓檔測試：', await ev(`(async () => {
    const r = await fetch('assets/voice/曹操/1dead01.mp3');
    const b = await r.blob();
    return JSON.stringify({ status: r.status, type: r.headers.get('content-type'), bytes: b.size });
  })()`));
  console.log('解碼測試：', await ev(`(async () => {
    const a = new Audio('assets/voice/曹操/1skill1_1.mp3');
    await new Promise((res, rej) => { a.onloadedmetadata = res; a.onerror = () => rej(new Error('load fail')); setTimeout(res, 3000); });
    return JSON.stringify({ duration: a.duration, readyState: a.readyState });
  })().catch(e => 'ERR ' + e.message)`));
  console.log('play() 呼叫：', await ev(`window.SGS_VOICE.play('曹操','dead')`));
  console.log('缺檔（不該報錯）：', await ev(`window.SGS_VOICE.play('沒有這隻','dead')`));
  console.log('界曹操→退回本名：', await ev(`JSON.stringify(window.SGS_VOICE.candidates('界曹操','1dead01'))`));
  ws.close(); proc.kill();
})();
