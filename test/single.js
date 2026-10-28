/* 單一武將驗證：強制指定武將出場，跑 N 局並統計技能發動次數
   用法： node test/single.js 神劉備 [局數] [模式]
*/
const { root } = require('./load');
const SGS = root.SGS, SETUP = root.SGS_SETUP, CARDS = root.SGS_CARDS, GEN = root.SGS_GENERALS;

const WHO = process.argv[2] || '神劉備';
const N = parseInt(process.argv[3] || '6', 10);
const MODE = process.argv[4] || 'duel';

if (!GEN[WHO]) {
  console.log('沒有這隻武將：', WHO);
  process.exit(1);
}
const g0 = GEN[WHO];
console.log(`武將 ${WHO}｜${g0.kingdom}｜${g0.hp} 體力｜技能 ${g0.skills.join('、')}｜${MODE} × ${N} 局`);

const hits = {};
let errors = 0, done = 0, turnSum = 0, timeout = 0;

function scanLogs(logs, who) {
  for (const l of logs) {
    if (!l || !l.msg) continue;
    for (const s of g0.skills) {
      if (l.msg.includes('【' + s + '】') || l.msg.includes('「' + s + '」')) {
        hits[s] = (hits[s] || 0) + 1;
      }
    }
  }
}

(async () => {
  for (let i = 0; i < N; i++) {
    let g;
    try {
      g = SETUP.makeGame({
        mode: MODE, packs: ['std', 'ex'],
        generalPacks: ['std', 'jie', 'god', 'sp', 'famous'],
        forcedGenerals: [[GEN[WHO]], null],
      });
      await g.runGame();
      const me = g.players.find(p => p.generals.some(x => x.name === WHO));
      const total = g.deck.length + g.discardPile.length +
        g.players.reduce((a, p) => a + p.hand.length + p.judge.length +
          ['weapon', 'armor', 'horse+', 'horse-', 'treasure'].filter(s => p.equips[s]).length, 0);
      if (total !== CARDS.buildDeck(['std', 'ex']).length) {
        console.log(`[牌數異常] ${total}`);
      }
      if (!g.over) timeout++;
      else done++;
      turnSum += g.stats.turns;
      scanLogs(g.logs, WHO);
      if (i === 0 && me) {
        console.log('第 1 局樣本：', me.generals.map(x => x.name).join('&'),
          `${me.hp}/${me.maxHp}`, '橫置=' + me.chained);
        const sk = g.logs.filter(l => /龍怒|結營/.test(l.msg)).slice(0, 6).map(l => '  · ' + l.msg);
        if (sk.length) console.log(sk.join('\n'));
      }
    } catch (e) {
      errors++;
      console.log(`[錯誤] 第 ${i} 局：`, e && e.stack ? e.stack.split('\n').slice(0, 6).join('\n') : e);
      if (g) console.log('  最後：', g.logs.slice(-8).map(l => l.msg).join(' / '));
    }
  }
  console.log('───────────────');
  console.log(`完成 ${done} 局 / 未結束 ${timeout} / 錯誤 ${errors} / 平均回合 ${(turnSum / Math.max(1, N)).toFixed(1)}`);
  console.log('技能發動次數：', hits);
  process.exit(errors > 0 ? 1 : 0);
})();
