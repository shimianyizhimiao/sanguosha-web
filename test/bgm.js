/* 背景音樂檢查：YouTube 播放器是否建立、是否在播放 */
const { spawn } = require('child_process');
const PORT = 9471;
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const proc = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=/tmp/sgsbgm-' + Date.now(),
      '--no-first-run', '--autoplay-policy=no-user-gesture-required', '--mute-audio',
      '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); break; } catch (e) { await sleep(200); } }
  const url = process.argv[2] || 'http://127.0.0.1:8124/index.html';
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
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
  await send('Page.enable'); await send('Runtime.enable'); await sleep(1500);

  console.log('YT API 載入：', await ev(`!!(window.YT && window.YT.Player)`));
  // 模擬使用者點擊（自動播放政策需要手勢）
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 700, y: 400, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 700, y: 400, button: 'left', clickCount: 1 });
  await sleep(6000);
  console.log('播放器狀態：', JSON.stringify(await ev(`window.__bgm && window.__bgm()`)));
  console.log('iframe 存在：', await ev(`!!document.querySelector('#bgm iframe')`));
  console.log('BGM 按鈕：', await ev(`document.querySelector('#btnBgm').className`));

  // 切換關閉
  await ev(`document.querySelector('#btnBgm').click()`);
  await sleep(1200);
  console.log('關閉後：', JSON.stringify(await ev(`window.__bgm && window.__bgm()`)));
  ws.close(); proc.kill();
})();
