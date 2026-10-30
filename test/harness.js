/* 測試用瀏覽器管家：整個 repo 的測試共用「一個」Chrome
   以前每個測試都自己 spawn 一個 Chrome + 全新 profile（每個 100～200MB），
   跑幾輪就把機器吃爆。現在改成：
   - 先看 9333 埠上有沒有現成的 Chrome，有就直接用（不重開）
   - 沒有才開一個 headless，固定 profile，限制 renderer 數量
   - 測試結束只關分頁，不關瀏覽器（下次直接重用）
   - SGS_CDP_PORT 可換埠，SGS_CDP_KILL=1 才會連瀏覽器一起關 */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.env.SGS_CDP_PORT || 9333);
const PROFILE = process.env.SGS_CHROME_PROFILE ||
  path.join(os.homedir(), '.hermes', 'cache', 'scratch', 'sgs-chrome');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function version() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; }
}

async function ensureChrome() {
  const v = await version();
  if (v) return { port: PORT, spawned: false, browser: v.Browser };
  const child = spawn(CHROME, [
    `--remote-debugging-port=${PORT}`,
    '--remote-allow-origins=*',
    `--user-data-dir=${PROFILE}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--disable-extensions', '--disable-sync',
    '--disable-background-networking', '--disable-component-update',
    '--mute-audio', '--renderer-process-limit=2',
    ...(process.env.SGS_CHROME_MULTI === '1' ? [] : ['--single-process', '--no-zygote']),
    'about:blank',
  ], { stdio: 'ignore', detached: true });
  child.unref();
  // 預設：測試結束就把這隻共用 Chrome 關掉（記憶體歸零），
  // 要連續跑多個測試想重用，設 SGS_CDP_KEEP=1
  if (process.env.SGS_CDP_KEEP !== '1') {
    process.on('exit', () => {
      try { child.kill('SIGKILL'); } catch (e) {}
    });
  }
  for (let i = 0; i < 80; i++) {
    const ok = await version();
    if (ok) return { port: PORT, spawned: true, browser: ok.Browser };
    await sleep(250);
  }
  throw new Error('Chrome 起不來（' + PORT + '）');
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const cdp = { ws, id: 0, waiting: new Map(), events: [] };
    ws.addEventListener('open', () => {
      cdp.send = (method, params) => send(cdp, method, params);
      cdp.eval = (expr) => evalOn(cdp, expr);
      cdp.close = () => { try { ws.close(); } catch (e) {} };
      resolve(cdp);
    });
    ws.addEventListener('error', (e) => reject(new Error('CDP 連不上：' + (e.message || 'error'))));
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && cdp.waiting.has(m.id)) {
        const w = cdp.waiting.get(m.id);
        cdp.waiting.delete(m.id);
        if (m.error) w.reject(new Error(JSON.stringify(m.error))); else w.resolve(m.result || {});
      } else if (m.method) cdp.events.push(m);
    });
  });
}

function send(cdp, method, params) {
  const id = ++cdp.id;
  return new Promise((res, rej) => {
    cdp.waiting.set(id, { resolve: res, reject: rej });
    cdp.ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => {
      if (cdp.waiting.has(id)) { cdp.waiting.delete(id); rej(new Error('timeout ' + method)); }
    }, 40000);
  });
}

async function evalOn(cdp, expr) {
  const r = await send(cdp, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error('JS: ' + ((d.exception && d.exception.description) || d.text || 'unknown'));
  }
  return r.result.value;
}

/** 開一個新分頁並載入 url（回傳可以 ev() 的物件） */
async function openTab(url, opts) {
  const o = opts || {};
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  const cdp = await connect(t.webSocketDebuggerUrl);
  cdp.targetId = t.id;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url });
  if (o.ready) {
    for (let i = 0; i < 60; i++) {
      const ok = await cdp.eval(o.ready).catch(() => false);
      if (ok) break;
      await sleep(300);
    }
  }
  return cdp;
}

/** 關掉分頁（瀏覽器留著給下一個測試用） */
async function closeTab(cdp) {
  try { await cdp.send('Page.close'); } catch (e) {}
  try { cdp.close(); } catch (e) {}
}

async function screenshot(cdp, file) {
  const fs = require('fs');
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  return file;
}

module.exports = { PORT, PROFILE, ensureChrome, openTab, closeTab, evalOn, screenshot, connect, sleep };
