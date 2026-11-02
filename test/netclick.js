/* 用「真的點按鈕」的方式驗連線（可帶 SGS_CHROME_HEADED=1 開真視窗）
   node test/netclick.js [url] */
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const OUT = path.join(__dirname, '..', 'shots');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const URL0 = process.argv[2] || 'http://127.0.0.1:8125/index.html';
const sleep = H.sleep;
if (/127\.0\.0\.1|localhost/.test(URL0)) {
  require('child_process').execFileSync(path.join(__dirname, 'serve.sh'), ['8125'], { stdio: 'inherit' });
}
const ev = H.evalOn;
const READY = `typeof window.SGS_NETPLAY === 'object' && typeof window.Peer === 'function'`;
const status = `(document.getElementById('netStatus') || {}).textContent || ''`;
const panelText = `((document.getElementById('netPanel') || {}).innerText || '').replace(/\\n+/g, ' / ')`;

(async () => {
  const info = await H.ensureChrome();
  console.log('   瀏覽器：' + (info.spawned ? '新開' : '重用') + (process.env.SGS_CHROME_HEADED === '1' ? '（有視窗）' : '（headless）'));
  const A = await H.openTab(URL0, { ready: READY });
  const B = await H.openTab(URL0, { ready: READY });
  let fails = 0;
  const check = (ok, msg) => { if (!ok) fails++; console.log((ok ? '✅' : '❌') + ' ' + msg); };

  // A：真的點「建立房間」
  await ev(A, `document.getElementById('btnNetHost').click()`);
  let code = null;
  for (let i = 0; i < 40; i++) {
    code = await ev(A, `(document.querySelector('#netPanel .net-code') || {}).textContent || null`);
    if (code) break;
    await sleep(400);
  }
  const stA = await ev(A, status);
  check(!!code, `房主按鈕開房成功，房號 ${code}（狀態列：${stA}）`);

  if (code) {
    // B：真的把房號打進輸入框再點「加入房間」
    await ev(B, `(() => { const i = document.getElementById('netCode'); i.value = ${JSON.stringify(code)}; i.dispatchEvent(new Event('input')); return i.value; })()`);
    await ev(B, `document.getElementById('btnNetJoin').click()`);
    let joined = false;
    for (let i = 0; i < 40; i++) {
      const t = await ev(B, panelText);
      if (/已連上房間|你是座位/.test(t)) { joined = true; break; }
      await sleep(400);
    }
    const stB = await ev(B, status);
    check(joined, `客人輸入房號後連上（狀態列：${stB}）`);

    // 房主端看得到有人加入
    const listTxt = await ev(A, `(document.getElementById('netList') || {}).innerText || ''`);
    check(/座位 2/.test(listTxt), `房主看到客人進房（列表：${listTxt.replace(/\n+/g, ' / ')}）`);
    const stA2 = await ev(A, status);
    console.log('   房主狀態列：' + stA2);
  }

  // 開始遊戲 → 兩邊候選武將不能重複
  if (code) {
    await ev(A, `document.getElementById('netStart').click()`);
    await H.sleep(1500);
    const namesA = await ev(A, `[...document.querySelectorAll('#pickCards .gname')].map(e => e.textContent)`);
    const namesB = await ev(B, `[...document.querySelectorAll('#pickCards .gname')].map(e => e.textContent)`);
    const dup = namesA.filter((n) => namesB.includes(n));
    check(namesA.length > 0 && namesB.length > 0, `兩邊都出現選將（房主 ${namesA.join('/')} ｜ 客人 ${namesB.join('/')}）`);
    check(dup.length === 0, `兩邊候選武將沒有重複${dup.length ? '（重複：' + dup.join('、') + '）' : ''}`);
    await H.screenshot(B, path.join(OUT, 'netclick-pick-guest.png'));
  }

  // 自我測試按鈕
  await ev(A, `document.getElementById('btnNetTest').click()`);
  let tr = '';
  for (let i = 0; i < 40; i++) {
    tr = await ev(A, status);
    if (/✅|❌/.test(tr)) break;
    await sleep(400);
  }
  check(/✅/.test(tr), `「連線測試」按鈕回報：${tr}`);

  await H.screenshot(B, path.join(OUT, 'netclick-guest.png'));
  await H.screenshot(A, path.join(OUT, 'netclick-host.png'));
  await H.closeTab(A); await H.closeTab(B);
  console.log(fails === 0 ? '\n全部通過' : `\n${fails} 項失敗`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('測試失敗：', e.message); process.exit(1); });
