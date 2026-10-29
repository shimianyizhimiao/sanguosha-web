/* 驗證：真人回合時，技能按鈕有沒有出現在操作列（並截圖） */
const { spawn } = require('child_process');
const fs = require('fs');
const PORT = 9480;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.events = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id); }
      else if (m.method) this.events.push(m);
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, (m) => m.error ? rej(new Error(m.error.message)) : res(m.result));
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('JS: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  }
}

(async () => {
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=/tmp/sgsbar' + Date.now(), '--no-first-run', '--no-default-browser-check',
    '--window-size=1440,900', '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });
  let ver = null;
  for (let i = 0; i < 60; i++) { try { ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; } catch (e) { await sleep(250); } }
  if (!ver) { console.log('無法連上 Chrome'); proc.exit ? 0 : proc.kill(); process.exit(1); }
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent('http://127.0.0.1:8125/index.html')}`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  const cdp = new CDP(ws);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await sleep(1200);

  await cdp.eval('window.__sgsUI.cfg.speed = 0');
  // 挑一隻有主動技的武將
  await cdp.eval(`document.querySelector('#btnStart').click()`);
  await sleep(400);
  const names = await cdp.eval(`[...document.querySelectorAll('.gcard')].map(x => x.textContent.trim().slice(0,12))`);
  console.log('候選：', names.join(' ｜ '));
  const want = ['孫權', '黃蓋', '華佗', '周瑜', '貂蟬', '大喬', '甘寧', '呂蒙', '甄姬', '諸葛亮'];
  let idx = 0;
  for (let i = 0; i < names.length; i++) { if (want.some(w => names[i].includes(w))) { idx = i; break; } }
  await cdp.eval(`document.querySelectorAll('.gcard')[${idx}].click()`);
  await sleep(2500);
  const myGen = await cdp.eval(`window.__sgsUI.game.players[0].generals.map(g=>g.name).join('&')`);
  const mySkills = await cdp.eval(`window.__sgsUI.game.players[0].skills.join('/')`);
  console.log('我方武將：', myGen, '｜技能：', mySkills);

  // 等到自己的出牌階段（最多 40 秒）
  let btns = [];
  for (let i = 0; i < 80; i++) {
    btns = await cdp.eval(`[...document.querySelectorAll('#actions button, .pickbar button, #promptBox button')].map(b=>b.textContent.trim())`);
    if (btns.some(b => b.includes('【'))) break;
    await sleep(500);
  }
  console.log('操作列按鈕：', JSON.stringify(btns));
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('/Users/masahiro/sgs/shots/skillbar.png', Buffer.from(shot.data, 'base64'));
  console.log('截圖： shots/skillbar.png');
  proc.kill();
  process.exit(0);
})();
