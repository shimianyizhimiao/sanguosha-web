/* 找出「未結束」的對局，印出最後狀態與日誌，方便診斷卡住原因 */
const { root } = require('./load');
const SETUP = root.SGS_SETUP;

const MODE = process.argv[2] || 'id5';
const PACKS = (process.argv[3] || 'std,ex').split(',');
const GP = (process.argv[4] || 'god').split(',');
const N = parseInt(process.argv[5] || '40', 10);

(async () => {
  for (let i = 0; i < N; i++) {
    const g = SETUP.makeGame({ mode: MODE, packs: PACKS, generalPacks: GP });
    await g.runGame();
    if (g.over) continue;
    console.log(`=== 第 ${i + 1} 局未結束（回合 ${g.stats.turns}）`);
    for (const p of g.players) {
      console.log(`  ${p.nickname} ${p.generals.map(x => x.name).join('&')} ${p.hp}/${p.maxHp} ` +
        `${p.alive ? '' : '死亡'} 手牌${p.hand.length} 橫置=${p.chained} 標記=${JSON.stringify(p.marks)}`);
    }
    console.log('  最後 25 條：');
    for (const l of g.logs.slice(-25)) console.log('   ·', l.msg);
    break;
  }
})();
