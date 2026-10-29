/* 檢查雙將：大廳設雙將 → 選兩隻 → 印出玩家技能與座位顯示 */
const { spawn } = require('child_process');
const PORT = 9486;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.p = new Map(); this.events = [];
    ws.addEventListener('message', ev => { const m = JSON.parse(ev.data);
      if (m.id && this.p.has(m.id)) { this.p.get(m.id)(m); this.p.delete(m.id); } else if (m.method) this.events.push(m); }); }
  send(method, params = {}) { const id = ++this.id; return new Promise((res, rej) => {
    this.p.set(id, m => m.error ? rej(new Error(m.error.message)) : res(m.result));
    this.ws.send(JSON.stringify({ id, method, params })); }); }
  async eval(e) { const r = await this.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('JS: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description)); return r.result.value; }
}
(async () => {
  const url = process.argv[2] || 'http://127.0.0.1:8125/index.html';
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=/tmp/sgsd' + Date.now(), '--no-first-run', '--no-default-browser-check',
    '--window-size=1440,900', '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });
  let v = null; for (let i = 0; i < 60; i++) { try { v = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; } catch (e) { await sleep(250); } }
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  const cdp = new CDP(ws);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await sleep(1200);
  await cdp.eval('window.__sgsUI.cfg.speed = 0');
  // 選雙將
  await cdp.eval(`document.querySelectorAll('#genOpts .opt')[1].click()`);
  console.log('cfg.double =', await cdp.eval('window.__sgsUI.cfg.double'));
  await cdp.eval(`document.querySelector('#btnStart').click()`);
  await sleep(500);
  console.log('候選數', await cdp.eval(`document.querySelectorAll('.gcard').length`));
  await cdp.eval(`document.querySelectorAll('.gcard')[0].click()`);
  await sleep(200);
  await cdp.eval(`document.querySelectorAll('.gcard')[1].click()`);
  await sleep(2000);
  const info = await cdp.eval(`(() => {
    const p = window.__sgsUI.game.players[0];
    const seat = document.querySelector('.seat.me');
    return { gens: p.generals.map(g=>g.name), skills: p.skills, hp: p.hp,
             plate: seat ? seat.innerText.replace(/\\n/g,'|') : null,
             portraits: seat ? seat.querySelectorAll('img').length : 0 };
  })()`);
  console.log(JSON.stringify(info, null, 1));
  // 點自己的武將卡 → 技能彈窗
  await cdp.eval(`document.querySelector('.seat.me').click()`);
  await sleep(400);
  const sheet = await cdp.eval(`(() => { const s = document.getElementById('sheet');
    return { open: s && !s.classList.contains('hidden'),
             title: (document.getElementById('sheetTitle')||{}).textContent,
             skills: [...document.querySelectorAll('#sheetBody .sk-name')].map(x=>x.textContent) }; })()`);
  console.log('技能彈窗:', JSON.stringify(sheet));
  const fs = require('fs');
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('/Users/masahiro/sgs/shots/dual-sheet.png', Buffer.from(shot.data, 'base64'));
  await cdp.eval(`document.getElementById('sheet').classList.add('hidden')`);
  const shot2 = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('/Users/masahiro/sgs/shots/dual-table.png', Buffer.from(shot2.data, 'base64'));
  proc.kill(); process.exit(0);
})();
