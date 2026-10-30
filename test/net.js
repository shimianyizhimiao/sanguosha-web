/* 連線對戰驗證：在同一個 Chrome 開兩個分頁（房主＋客人），真的走 WebRTC 對打
   用法：node test/net.js [url] */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(__dirname, '..', 'shots');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL0 = process.argv[2] || 'http://127.0.0.1:8125/index.html';

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const cdp = { ws, id: 0, waiting: new Map(), events: [] };
    ws.addEventListener('open', () => resolve(cdp));
    ws.addEventListener('error', (e) => reject(e));
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && cdp.waiting.has(msg.id)) {
        const { resolve: rs, reject: rj } = cdp.waiting.get(msg.id);
        cdp.waiting.delete(msg.id);
        if (msg.error) rj(new Error(JSON.stringify(msg.error))); else rs(msg.result);
      } else if (msg.method) cdp.events.push(msg);
    });
  });
}

function send(cdp, method, params) {
  const id = ++cdp.id;
  return new Promise((resolve, reject) => {
    cdp.waiting.set(id, { resolve, reject });
    cdp.ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (cdp.waiting.has(id)) { cdp.waiting.delete(id); reject(new Error('timeout ' + method)); } }, 40000);
  });
}

async function ev(cdp, expr) {
  const r = await send(cdp, 'Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error('JS: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
  return r.result.value;
}

async function shot(cdp, name) {
  const r = await send(cdp, 'Page.captureScreenshot', { format: 'png' });
  const f = path.join(OUT, name + '.png');
  fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
  return f;
}

(async () => {
  const port = await freePort();
  const userDir = fs.mkdtempSync('/tmp/sgs-net-');
  process.on('exit', () => { try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (e) {} });
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${port}`, '--remote-allow-origins=*',
    `--user-data-dir=${userDir}`, '--no-first-run', '--no-default-browser-check',
    '--window-size=1400,900', 'about:blank',
  ], { stdio: 'ignore' });

  let targets = [];
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      targets = await res.json();
      if (targets.some((t) => t.type === 'page')) break;
    } catch (e) { /* 等啟動 */ }
    await sleep(300);
  }

  const mk = async () => {
    const t = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(URL0)}`, { method: 'PUT' })).json();
    const cdp = await connect(t.webSocketDebuggerUrl);
    await send(cdp, 'Page.enable');
    await send(cdp, 'Runtime.enable');
    return cdp;
  };

  const A = await mk();   // 房主
  const B = await mk();   // 客人
  await sleep(1500);

  let fails = 0;
  const check = (ok, msg) => { if (!ok) fails++; console.log((ok ? '✅' : '❌') + ' ' + msg); };

  // PeerJS 有沒有載入
  const hasPeer = await ev(A, 'typeof window.Peer');
  check(hasPeer === 'function', `PeerJS 已載入（typeof Peer = ${hasPeer}）`);

  // 兩邊都選 3 人身份局，比較快結束
  await ev(A, `(() => { const o = document.querySelector('#modeOpts [data-mode="id3"]'); if (o) o.click(); return window.__sgsUI.net.cfg.mode; })()`);
  await ev(B, `(() => { const o = document.querySelector('#modeOpts [data-mode="id3"]'); if (o) o.click(); return window.__sgsUI.net.cfg.mode; })()`);

  // 房主開房
  await ev(A, 'window.SGS_NETPLAY.createRoom()');
  let code = null;
  for (let i = 0; i < 40; i++) {
    code = await ev(A, 'window.SGS_NET && window.SGS_NET.code');
    if (code) break;
    await sleep(400);
  }
  check(!!code, `房主建立房間（房號 ${code}）`);
  await shot(A, 'net-host-room');

  // 客人加入
  await ev(B, `window.SGS_NETPLAY.joinRoom('${code}')`);
  let joined = false;
  for (let i = 0; i < 40; i++) {
    joined = await ev(B, 'window.SGS_NETPLAY.mySeat === 1');
    if (joined) break;
    await sleep(400);
  }
  check(joined, '客人已連上並拿到座位 2');
  await shot(B, 'net-guest-wait');

  // 房主開始
  await ev(A, `document.getElementById('netStart').click()`);
  await sleep(1200);

  // 兩邊各選武將（點第一張卡）
  const pickA = await ev(A, `(() => { const c = document.querySelector('#pickCards .gcard'); if (!c) return 'no-cards'; c.click(); return 'ok'; })()`);
  const pickB = await ev(B, `(() => { const c = document.querySelector('#pickCards .gcard'); if (!c) return 'no-cards'; c.click(); return 'ok'; })()`);
  check(pickA === 'ok' && pickB === 'ok', `雙邊選將畫面出現（${pickA} / ${pickB}）`);
  await sleep(2500);

  // 兩邊是否進入牌桌
  const hostTable = await ev(A, `!!document.querySelector('#table:not(.hidden)')`);
  const guestTable = await ev(B, `!!document.querySelector('#table:not(.hidden)')`);
  check(hostTable && guestTable, `雙邊進入牌桌（房主 ${hostTable} / 客人 ${guestTable}）`);
  await shot(A, 'net-host-table');
  await shot(B, 'net-guest-table');

  // 客人畫面上有沒有「自己的手牌」
  const guestHand = await ev(B, `document.querySelectorAll('#hand .card').length`);
  check(guestHand > 0, `客人看得到自己的手牌（${guestHand} 張）`);

  // 客人看得到其他座位（含房主）
  const guestSeats = await ev(B, `document.querySelectorAll('#seats .seat').length`);
  check(guestSeats === 3, `客人看得到 3 個座位（${guestSeats}）`);

  // 房主端座位也要是 3
  const hostSeats = await ev(A, `document.querySelectorAll('#seats .seat').length`);
  check(hostSeats === 3, `房主端 3 個座位（${hostSeats}）`);

  // 兩邊都用 AI 代答，讓對局往前跑；同時記錄客人是否真的收到請求
  let asked = null;
  let guestKind = null;
  let maxHostLogs = 0;
  const drive = async (cdp) => {
    await ev(cdp, `(() => { if (window.__sgsUI.net.pending) { window.__sgsUI.net.answerWithAI(); return 1; } return 0; })()`).catch(() => {});
  };
  for (let i = 0; i < 40; i++) {
    maxHostLogs = Math.max(maxHostLogs, await ev(A, '(window.__sgs.game.logs || []).length'));
    const gs = await ev(B, `(() => { const P = window.__sgsUI.net.pending; return P ? P.req.kind : null; })()`);
    if (gs && !asked) { asked = true; guestKind = gs; await shot(B, 'net-guest-ask'); }
    await drive(A); await drive(B);
    const over = await ev(A, '!!(window.__sgs.game && window.__sgs.game.over)');
    if (over) break;
    await sleep(300);
  }
  check(asked, `客人收到房主的決策請求（種類 ${guestKind}）`);

  // 客人真的可以自己出牌（點自己的手牌 → 答案回到房主引擎）
  let guestPlayed = false;
  for (let i = 0; i < 50; i++) {
    const gs = await ev(B, `(() => { const P = window.__sgsUI.net.pending;
      if (!P || P.req.kind !== 'play') return null;
      const id = (P.req.cards && P.req.cards[0] && P.req.cards[0].id) || null;
      return id; })()`);
    if (gs) {
      const before = await ev(A, '(window.__sgs.game.logs || []).length');
      await ev(B, `window.__sgsUI.clickCard(${JSON.stringify(gs)})`);
      await sleep(1200);
      const after = await ev(A, '(window.__sgs.game.logs || []).length');
      const nowKind = await ev(B, `(() => { const P = window.__sgsUI.net.pending; return P ? P.req.kind : 'none'; })()`);
      const logTxt = await ev(A, `((window.__sgs.game.logs || []).slice(-3).map(l => l.msg).join(' | '))`);
      guestPlayed = after > before || nowKind !== 'play';
      console.log('   客人出牌後：房主日誌 +' + (after - before) + ' 行，客人下一步請求 ' + nowKind);
      console.log('   房主最後日誌：', logTxt);
      break;
    }
    const over = await ev(A, '!!(window.__sgs.game && window.__sgs.game.over)');
    if (over) break;
    await drive(A);           // 房主自己該動就動
    // 客人若在等「回應類」請求（出閃／選目標…）就先代答；只有自己的出牌階段留給我點
    const gk = await ev(B, `(() => { const P = window.__sgsUI.net.pending; return P ? P.req.kind : null; })()`);
    if (gk && gk !== 'play') await drive(B);
    await sleep(300);
  }
  check(guestPlayed, '客人在自己回合點手牌出牌，房主引擎收到並結算');

  const hostLogs = await ev(A, '(window.__sgs.game.logs || []).length');
  const guestLogs = await ev(B, 'document.querySelectorAll("#log .l").length');
  check(Math.max(hostLogs, maxHostLogs) > 8, `房主引擎持續推進（最多 ${Math.max(hostLogs, maxHostLogs)} 行日誌）`);
  check(guestLogs > 5, `客人端同步到日誌（${guestLogs} 行）`);

  const cmp = await ev(B, `(() => { const g = window.__sgsUI.net.game; return g.players.map(p => p.seat + ':' + p.hp + '/' + p.maxHp).join(','); })()`);
  const cmpA = await ev(A, `(() => { const g = window.__sgs.game; return g.players.map(p => p.seat + ':' + p.hp + '/' + p.maxHp).join(','); })()`);
  check(cmp === cmpA, `雙邊血量視圖一致（${cmp}）`);
  await shot(B, 'net-guest-final');

  const errsA = A.events.filter(e => e.method === 'Runtime.exceptionThrown' || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error'));
  if (errsA.length) {
    console.log('   房主端錯誤：');
    for (const e of errsA.slice(0, 4)) {
      const d = e.params.exceptionDetails || {};
      console.log('     ', (d.exception && d.exception.description || d.text || '').split('\n').slice(0, 3).join(' / ') ||
        (e.params.args || []).map(a => a.value || a.description).join(' ').split('\n').slice(0, 2).join(' / '));
    }
  }
  console.log(fails === 0 ? '\n全部通過' : `\n${fails} 項失敗`);
  try { chrome.kill(); } catch (e) {}
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('測試失敗：', e.message); process.exit(1); });
