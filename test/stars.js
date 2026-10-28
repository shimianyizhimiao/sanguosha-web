/* 七星／狂風／大霧 機制驗證 */
const { root } = require('./load');
const SETUP = root.SGS_SETUP, GEN = root.SGS_GENERALS;
let fails = 0;
const check = (c, m) => { if (!c) fails++; console.log((c ? '✅' : '❌') + ' ' + m); };

(async () => {
  const g = SETUP.makeGame({
    mode: 'id3', packs: ['std'], generalPacks: ['std', 'god'],
    forcedGenerals: [[GEN['神諸葛亮']], [GEN['曹操']], [GEN['孫權']]],
  });
  const zg = g.players[0], cc = g.players[1], sq = g.players[2];
  g.current = zg;

  // 七星：開局 7 星
  zg.stars = g.drawFromDeck(7);
  check(zg.stars.length === 7, `七星：武將牌上 7 枚星（實際 ${zg.stars.length}）`);

  // 狂風：移 1 星 → 曹操受火焰傷害 +1
  g.askSkill = async () => true;
  // 狂風選曹操、大霧選孫權
  g.askTargets = async (p2, opt) => (/狂風/.test(opt.prompt) ? [cc] : [sq]);
  zg.turnCount = 3;
  await g.trigger('turnEnd', { player: zg });
  check(zg.stars.length === 5, `狂風＋大霧各移去 1 枚星（剩 ${zg.stars.length}）`);
  check(cc.qingFengBy === zg, '狂風：曹操被標記');
  const hp0 = cc.hp;
  await g.damage(sq, cc, 1, 'fire');
  check(hp0 - cc.hp === 2, `狂風：火焰傷害 1 → 2（${hp0} → ${cc.hp}）`);

  check(sq.daWBy === zg, '大霧：孫權被保護');
  const hp1 = sq.hp;
  const r1 = await g.damage(cc, sq, 1, 'normal');
  check(sq.hp === hp1, `大霧：普通傷害被防止（${hp1} → ${sq.hp}）`);
  const hp2 = sq.hp;
  await g.damage(cc, sq, 1, 'thunder');
  check(hp2 - sq.hp === 1, `大霧：雷電傷害照常（${hp2} → ${sq.hp}）`);

  // 下個回合開始清除
  g.askSkill = async () => true;
  await g.trigger('turnStart', { player: zg });
  check(cc.qingFengBy === null && sq.daWBy === null, '諸葛亮下回合開始時狂風／大霧失效');

  console.log(fails === 0 ? '\n全部通過' : `\n${fails} 項失敗`);
  process.exit(fails ? 1 : 0);
})();
