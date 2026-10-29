/* 找出卡牌遺失的對局：印出參戰武將與最後日誌 */
const { root } = require('./load');
const SETUP = root.SGS_SETUP;
const MODE = process.argv[2] || 'id5';
const N = parseInt(process.argv[3] || '60', 10);
const PACKS = (process.argv[4] || 'std,ex').split(',');
const GPACKS = (process.argv[5] || 'std,jie,god,sp,famous').split(',');

const allIds = g => {
  const out = [];
  for (const p of g.players) {
    out.push(...p.hand.map(c => c.id));
    for (const k of Object.keys(p.equips)) if (p.equips[k]) out.push(p.equips[k].id);
    out.push(...p.judge.map(c => c.id));
    out.push(...(p.stars||[]).map(c => c.id));
    out.push(...(p.buqu||[]).map(c => c.id));   // 不屈牌扣在武將牌上
    if (p.ren) out.push(p.ren.id);              // 明任的「任」也在武將牌上
  }
  out.push(...g.deck.map(c => c.id));
  out.push(...g.discardPile.map(c => c.id));
  return out;
};

(async () => {
  let bad = 0, stalls = 0;
  for (let i = 0; i < N; i++) {
    const g = SETUP.makeGame({ mode: MODE, packs: PACKS, generalPacks: GPACKS });
    const startIds = allIds(g).sort();
    await g.runGame();
    const endIds = allIds(g).sort();
    if (startIds.length !== endIds.length || startIds.join() !== endIds.join()) {
      bad++;
      const missing = startIds.filter(id => !endIds.includes(id));
      const dup = endIds.filter((id, k) => endIds.indexOf(id) !== k);
      console.log(`\n=== 第 ${i + 1} 局 卡牌異常｜起始 ${startIds.length} → 結束 ${endIds.length}`);
      console.log('武將：', g.players.map(p => `${p.generals.map(x => x.name).join('&')}（${p.identity}）`).join(' / '));
      console.log('遺失：', missing.map(id => { const c = g.startSnap && g.startSnap[id]; return id; }), '重複：', dup);
      console.log('最後日誌：');
      for (const l of g.logs.slice(-14)) console.log('   ·', (l.text || l.msg || JSON.stringify(l)));
      if (bad >= 3) break;
    }
    if (!g.over) { stalls++; }
  }
  console.log(`\n完成 ${N} 局｜卡牌異常 ${bad}｜未結束 ${stalls}`);
})();
