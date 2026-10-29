/* 實戰驗證：真的對局中會不會播出語音（監聽 assets/voice 的網路請求） */
const { spawn } = require('child_process');
const PORT = 9497;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.p = new Map(); this.ev = [];
    ws.addEventListener('message', ev => { const m = JSON.parse(ev.data);
      if (m.id && this.p.has(m.id)) { this.p.get(m.id)(m); this.p.delete(m.id); }
      else if (m.method) this.ev.push(m); }); }
  send(method, params = {}) { const id = ++this.id; return new Promise((res, rej) => {
    this.p.set(id, m => m.error ? rej(new Error(m.error.message)) : res(m.result));
    this.ws.send(JSON.stringify({ id, method, params })); }); }
  async eval(e) { const r = await this.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('JS: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description)); return r.result.value; }
}
(async () => {
  const url = process.argv[2] || 'http://127.0.0.1:8125/index.html';
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=/tmp/sgsv3' + Date.now(), '--no-first-run', '--no-default-browser-check',
    '--window-size=1440,900', 'about:blank', '--autoplay-policy=no-user-gesture-required'], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; } catch (e) { await sleep(250); } }
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  const cdp = new CDP(ws);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  await sleep(1400);

  // 全 AI、最快速度、標將+界將（有語音的武將多）
  await cdp.eval(`(() => {
    const btns=[...document.querySelectorAll('#gpackOpts .opt')];
    const keep = ['標將', '界將', '神將'];
    btns.forEach(b=>{ if(!keep.some(k=>b.textContent.includes(k))) b.click(); });
    window.__sgsUI.cfg.speed = 0;
    return window.__sgsUI.cfg.generalPacks.join(',');
  })()`);
  await cdp.eval(`document.querySelector('#btnStart').click()`);
  await sleep(700);
  // 玩家選將 → 之後全 AI 打
  await cdp.eval(`document.querySelectorAll('.gcard')[0].click()`);
  await cdp.eval(`(() => {
    const g = window.__sgsUI.game;
    if (g && window.SGS_AI) g.players[0].controller = new window.SGS_AI.AIController(null, 0);
    return !!g;
  })()`);
  // 自動代打：一直點畫面上可用的按鈕（結束回合／確認／出牌），讓對局真的跑起來
  await cdp.eval(`(() => {
    window.__auto = setInterval(() => {
      const vis = q => [...document.querySelectorAll(q)].filter(b => b.offsetParent !== null && !b.disabled);
      const pick = (arr) => { if (arr.length) arr[0].click(); return arr.length; };
      if (pick(vis('#actions button'))) return;
      if (pick(vis('#prompt button'))) return;
      const cards = vis('#hand .card');
      if (cards.length) { cards[0].click(); return; }
      const any = vis('button').filter(b => !/音樂|BGM|日誌|音效|速度|技能/.test(b.textContent));
      if (any.length) any[0].click();
    }, 200);
    return true;
  })()`);
  await sleep(28000);
  const voice = cdp.ev.filter(m => m.method === 'Network.requestWillBeSent' && /assets\/voice\//.test(m.params.request.url));
  const states = cdp.ev.filter(m => m.method === 'Network.loadingFinished');
  const ok = cdp.ev.filter(m => m.method === 'Network.responseReceived' && /assets\/voice\//.test(m.params.response.url) && m.params.response.status === 200);
  const gens = await cdp.eval(`window.__sgsUI.game ? window.__sgsUI.game.players.map(p=>p.generals.map(g=>g.name).join('&')).join(' | ') : '無'`);
  console.log('對局武將:', gens);
  const st = await cdp.eval(`({turn: window.__sgsUI.game ? window.__sgsUI.game.turn : -1,
    logs: document.querySelectorAll('#log .l').length,
    over: !document.querySelector('#result').classList.contains('hidden')})`);
  console.log('狀態:', JSON.stringify(st));
  const logs = await cdp.eval(`[...document.querySelectorAll('#log .l.skill')].map(x=>x.textContent).slice(0,6)`);
  console.log('技能日誌樣本：', JSON.stringify(logs));
  console.log('語音請求', voice.length, '｜200 成功', ok.length);
  console.log('樣本:', [...new Set(voice.map(v => decodeURIComponent(v.params.request.url.split('/voice/')[1])))].slice(0, 6).join('、'));
  proc.kill(); process.exit(0);
})();
