/* 用 Chrome DevTools Protocol 驅動真實瀏覽器（Node 內建 WebSocket）
   用法：node test/cdp.js [url] [steps]
*/
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333 + Math.floor(Math.random() * 60);
const OUT = path.join(__dirname, '..', 'shots');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.waiting = new Map();
    this.events = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.waiting.has(msg.id)) {
        const { resolve, reject } = this.waiting.get(msg.id);
        this.waiting.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    });
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => {
        if (this.waiting.has(id)) { this.waiting.delete(id); reject(new Error('CDP timeout ' + method)); }
      }, 20000);
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr, awaitPromise: true, returnByValue: true, userGesture: true,
    });
    if (r.exceptionDetails) {
      throw new Error('JS: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
    }
    return r.result.value;
  }
  async shot(name) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(OUT, name + '.png');
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    return file;
  }
}

async function main() {
  const url = process.argv[2] || 'http://localhost:8124/index.html';
  const steps = parseInt(process.argv[3] || '400', 10);

  const proc = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + path.join('/tmp', 'sgschrome' + PORT),
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--window-size=1440,900', '--force-device-scale-factor=1',
    '--autoplay-policy=no-user-gesture-required', 'about:blank',
  ], { stdio: 'ignore' });

  let version = null;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      version = await r.json();
      break;
    } catch (e) { await sleep(250); }
  }
  if (!version) { console.log('無法連上 Chrome'); proc.kill(); process.exit(1); }

  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  const cdp = new CDP(ws);

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await sleep(1200);

  const problems = [];
  const collect = () => {
    for (const e of cdp.events) {
      if (e.method === 'Runtime.exceptionThrown') {
        const d = e.params.exceptionDetails;
        problems.push('EXCEPTION ' + (d.exception && d.exception.description || d.text));
      }
      if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') {
        problems.push('CONSOLE ' + e.params.entry.text);
      }
    }
    cdp.events.length = 0;
  };

  const title = await cdp.eval('document.title');
  console.log('頁面標題：', title);

  // 1. 進大廳 → 開始 → 選將（測試時 AI 不延遲）
  await cdp.eval(`window.__sgsUI.cfg.speed = 0`);
  await cdp.eval(`document.querySelector('#btnStart').click()`);
  await sleep(300);
  const pickVisible = await cdp.eval(`!document.querySelector('#pick').classList.contains('hidden')`);
  const pickCount = await cdp.eval(`document.querySelectorAll('.gcard').length`);
  console.log('選將畫面：', pickVisible, '候選', pickCount, '隻');

  // 2. 選第一隻武將 → 開局
  await cdp.eval(`document.querySelectorAll('.gcard')[0].click()`);
  await sleep(800);
  const started = await cdp.eval(`!!(window.__sgsUI && window.__sgsUI.game)`);
  const myGen = await cdp.eval(`window.__sgsUI.game ? window.__sgsUI.game.players[0].generals.map(g=>g.name).join('&') : ''`);
  console.log('對局開始：', started, '我方武將', myGen);

  // 2.5 特效層驗證：主動觸發刀光＋爆裂，檢查畫布真的有像素
  const fxCheck = await cdp.eval(`(() => {
    const FX = window.SGS_FX;
    if (!FX || !FX.ctx) return { ok: false, why: 'no fx' };
    FX.burst(500, 320, '#ff5470', 60, 420);
    FX.slash(520, 300, '#ffd9a0');
    FX.ring(500, 320, '#d9b46a', 10, 120);
    FX.text(500, 260, '-2', '#ff8a9c', 26);
    return { ok: true, w: FX.W, h: FX.H };
  })()`);
  await sleep(60);
  const fxPixels = await cdp.eval(`(() => {
    const FX = window.SGS_FX; FX.step(); FX.step();   // 無頭環境 rAF 會被節流，主動跑兩幀
    const cv = document.querySelector('#fx');
    const ctx = cv.getContext('2d');
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4 * 7) if (d[i] > 8) n++;
    return { nonTransparent: n, canvas: [cv.width, cv.height] };
  })()`);
  const shotFx = await cdp.shot('fx');
  console.log('特效層：', JSON.stringify(fxCheck), '有像素取樣：', JSON.stringify(fxPixels));

  // 3. 用真實 DOM 點擊打一張牌（驗證 UI 互動）
  let domClickOk = false;
  for (let i = 0; i < 40 && !domClickOk; i++) {
    const info = await cdp.eval(`(() => {
      const ui = window.__sgsUI; if (!ui || !ui.pending) return null;
      const r = ui.pending.req;
      if (r.kind !== 'play') return { kind: r.kind };
      const c = document.querySelectorAll('#hand .card:not(.dis)')[0];
      if (!c) return { kind: 'play', noCard: true };
      const before = ui.pending.req.cards.length;
      c.click();
      return { kind: 'play', clicked: true, before };
    })()`);
    if (info && info.clicked) { await sleep(250); domClickOk = true; }
    else await sleep(60);
  }
  console.log('手牌 DOM 點擊：', domClickOk);
  await sleep(400);
  const shot1 = await cdp.shot('table-1');

  // 4. 讓 AI 代打，把整局跑完
  let state = '';
  const t0 = Date.now();
  let answered = 0;
  while (Date.now() - t0 < 45000) {
    const done = await cdp.eval(`(() => {
      const ui = window.__sgsUI;
      if (!ui || !ui.game) return 'nogo';
      if (ui.game.over) return 'over';
      if (!ui.pending) return 'wait';
      return ui.answerWithAI().then(() => 'answered');
    })()`);
    if (done === 'over') { state = 'over'; break; }
    if (done === 'answered') answered++;
    await sleep(8);
  }
  console.log('AI 代打次數：', answered, '結果：', state || '未完賽');
  collect();
  await sleep(300);
  const finalShot = await cdp.shot('table-2');

  const summary = await cdp.eval(`(() => {
    const g = window.__sgsUI.game;
    return {
      over: g.over,
      turns: g.stats.turns,
      winner: g.winner ? g.winner.side : null,
      players: g.players.map(p => ({
        gen: p.generals.map(x => x.name).join('&'),
        id: p.identity, hp: p.hp, alive: p.alive, hand: p.hand.length,
      })),
      logs: g.logs.length,
      seats: document.querySelectorAll('.seat').length,
      handCards: document.querySelectorAll('#hand .card').length,
      resultShown: !document.querySelector('#result').classList.contains('hidden'),
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
      viewport: [window.innerWidth, window.innerHeight],
    };
  })()`);

  console.log('最終狀態：', JSON.stringify(summary, null, 1));
  console.log('問題：', problems.length ? problems.slice(0, 6) : '無');
  console.log('截圖：', shot1, finalShot);

  ws.close();
  proc.kill();
  process.exit(problems.length ? 1 : 0);
}
main().catch(e => { console.error('測試失敗', e); process.exit(2); });
