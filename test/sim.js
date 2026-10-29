/* 大量 AI 對戰模擬，用來驗證引擎不會爆、不會卡、牌不會無中生有 */
const { root } = require('./load');
const SGS = root.SGS, SETUP = root.SGS_SETUP, CARDS = root.SGS_CARDS;

const args = process.argv.slice(2);
const MODE = args[0] || 'id5';
const N = parseInt(args[1] || '20', 10);
const PACKS = (args[2] || 'std').split(',');
const GPACKS = (args[3] || 'std').split(',');

function countCards(g) {
  let n = g.deck.length + g.discardPile.length;
  for (const p of g.players) {
    n += p.hand.length + p.judge.length + (p.stars ? p.stars.length : 0) + (p.buqu ? p.buqu.length : 0) + (p.ren ? 1 : 0) + (p.qianhuan ? p.qianhuan.length : 0) + (p.kongsheng ? p.kongsheng.length : 0) + (p.rong ? p.rong.length : 0);
    for (const s of ['weapon', 'armor', 'horse+', 'horse-', 'treasure']) if (p.equips[s]) n++;
  }
  return n;
}

(async () => {
  const expected = CARDS.buildDeck(PACKS).length;
  const results = [];
  let errors = 0, leaks = 0, timeouts = 0;
  const t0 = Date.now();

  for (let i = 0; i < N; i++) {
    let g;
    try {
      g = SETUP.makeGame({ mode: MODE, packs: PACKS, generalPacks: GPACKS });
      const total0 = countCards(g);
      await g.runGame();
      const total1 = countCards(g);
      if (total0 !== total1 || total1 !== expected) {
        leaks++;
        console.log(`[卡牌數量異常] 開局 ${total0} / 結束 ${total1} / 應為 ${expected}`);
      }
      if (!g.over) timeouts++;
      const w = g.winner;
      results.push({
        turns: g.stats.turns,
        winner: w ? w.side : 'none',
        ids: g.players.map(p => p.identity).join(','),
        gens: g.players.map(p => p.generals.map(x => x.name).join('&')).join(' | '),
      });
    } catch (e) {
      errors++;
      console.log(`[錯誤] 第 ${i} 局：${e && e.stack ? e.stack.split('\n').slice(0, 6).join('\n') : e}`);
      if (g) {
        console.log('  狀態：', g.players.map(p => `${p.generals.map(x => x.name).join('&')}(${p.hp}/${p.maxHp}${p.alive ? '' : ' 死'})`).join(' '));
        console.log('  最後紀錄：', g.logs.slice(-6).map(l => l.msg).join(' / '));
      }
    }
  }

  const bySide = {};
  for (const r of results) bySide[r.winner] = (bySide[r.winner] || 0) + 1;
  const avgTurns = results.reduce((a, b) => a + b.turns, 0) / Math.max(1, results.length);

  console.log('───────────────');
  console.log(`模式 ${MODE} · 牌包 ${PACKS.join('+')} · ${N} 局 · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`完成 ${results.length} 局 / 錯誤 ${errors} / 卡牌異常 ${leaks} / 未結束 ${timeouts}`);
  console.log(`平均回合 ${avgTurns.toFixed(1)}`);
  console.log('勝方分布：', bySide);
  if (process.env.VERBOSE) console.log(results.slice(0, 5));
  process.exit(errors > 0 ? 1 : 0);
})();
