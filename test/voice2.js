/* 驗證新匯入的語音：檔案可取得、播放器能播 */
const { spawn } = require('child_process');
const PORT = 9496;
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
    '--user-data-dir=/tmp/sgsv' + Date.now(), '--no-first-run', '--no-default-browser-check',
    '--window-size=1440,900', 'about:blank', '--autoplay-policy=no-user-gesture-required'], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; } catch (e) { await sleep(250); } }
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  const cdp = new CDP(ws);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await sleep(1500);

  const cases = [['劉備', '仁德', ['仁德', '激將']], ['界劉備', '仁德', ['仁德', '激將']],
                 ['張飛', '咆哮', ['咆哮']], ['郭嘉', '遺計', ['天妒', '遺計']]];
  for (const [n, sk, list] of cases) {
    const r = await cdp.eval(`(async () => {
      const idx = ${JSON.stringify(list)}.indexOf(${JSON.stringify(sk)});
      const u = 'assets/voice/${n}/1skill' + (idx + 1) + '_1.mp3';
      const st = await fetch(u, { method: 'HEAD' }).then(r => r.status).catch(() => -1);
      const played = window.SGS_VOICE.playSkill(${JSON.stringify(n)}, ${JSON.stringify(sk)}, ${JSON.stringify(list)});
      return { u, st, played };
    })()`);
    console.log(`${n}・${sk} → ${r.st} ${r.played ? '已播' : '未播'}`);
    await cdp.eval('new Promise(r=>setTimeout(r,700))');
  }
  await sleep(700);
  const dead = await cdp.eval(`(async () => window.SGS_VOICE.play('劉備','dead'))()`);
  console.log('劉備 陣亡語音:', dead ? '已播' : '未播');
  proc.kill(); process.exit(0);
})();
