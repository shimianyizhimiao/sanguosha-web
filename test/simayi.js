/* 神司馬懿：忍戒／拜印覺醒／極略／連破／完殺 機制驗證 */
const { root } = require('./load');
const SETUP = root.SGS_SETUP, GEN = root.SGS_GENERALS;
let fails = 0;
const check = (c, m) => { if (!c) fails++; console.log((c ? '✅' : '❌') + ' ' + m); };

(async () => {
  const g = SETUP.makeGame({
    mode: 'id3', packs: ['std'], generalPacks: ['std', 'god'],
    forcedGenerals: [[GEN['神司馬懿']], [GEN['曹操']], [GEN['孫權']]],
  });
  const sm = g.players[0], cc = g.players[1], sq = g.players[2];
  g.current = sm; g.phase = 'play';

  // 忍戒：受傷得忍
  await g.damage(cc, sm, 2, 'normal');
  check(g.marks(sm, '忍') === 2, `忍戒：受到 2 點傷害得 2 忍（實際 ${g.marks(sm, '忍')}）`);

  // 忍戒：棄牌階段棄牌也得忍
  await g.trigger('discardPhaseEnd', { player: sm, count: 3 });
  check(g.marks(sm, '忍') === 5, `忍戒：棄 3 張得 3 忍（實際 ${g.marks(sm, '忍')}）`);

  // 拜印：準備階段忍>3 → 減體力上限 + 獲得極略
  const maxBefore = sm.maxHp;
  await g.trigger('turnStart', { player: sm });
  check(sm.maxHp === maxBefore - 1, `拜印：體力上限 ${maxBefore} → ${sm.maxHp}`);
  check(sm.skills.includes('極略'), '拜印：獲得【極略】');
  await g.trigger('turnStart', { player: sm });
  check(sm.maxHp === maxBefore - 1, '拜印：只覺醒一次');

  // 極略：移 1 忍 → 獲得技能
  g.ask = async (p, opt) => (opt && opt.kind === 'choice' ? 3 : []);   // 選「制衡」，其他詢問回空
  sm.turnFlags = {};
  await g.SK['極略'].active(g, sm);
  check(g.marks(sm, '忍') === 4, `極略：消耗 1 忍（剩 ${g.marks(sm, '忍')}）`);
  check(sm.turnFlags.jilue === true, '極略：本回合已用過');

  // 完殺：自己的回合內別人不能出桃
  sm.skills.push('完殺');
  cc.hp = 0;
  let asked = false;
  const origAsk = g.askForCard.bind(g);
  g.askForCard = async (p, name, ctx) => { if (p === sq && name === '桃') asked = true; return null; };
  await g.dying(cc, sm);
  check(asked === false, '完殺：其他人（孫權）沒有被詢問出桃');
  g.askForCard = origAsk;

  // 連破：擊殺後有額外回合
  const g2 = SETUP.makeGame({ mode: 'duel', packs: ['std'], generalPacks: ['std', 'god'],
    forcedGenerals: [[GEN['神司馬懿']], [GEN['曹操']]] });
  const me = g2.players[0], foe = g2.players[1];
  foe.hp = 1;
  await g2.damage(me, foe, 1, 'normal');
  check(me.extraTurn === true, '連破：擊殺後標記額外回合');

  console.log(fails === 0 ? '\n全部通過' : `\n${fails} 項失敗`);
  process.exit(fails ? 1 : 0);
})();
