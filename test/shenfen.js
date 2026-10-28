/* 神憤 + 七星/狂風/大霧 機制驗證 */
const { root } = require('./load');
const SETUP = root.SGS_SETUP, GEN = root.SGS_GENERALS, CARDS = root.SGS_CARDS;
let fails = 0;
const check = (c, m) => { if (!c) fails++; console.log((c ? '✅' : '❌') + ' ' + m); };

const countCards = g => {
  let n = 0;
  for (const p of g.players) {
    n += p.hand.length;
    for (const k of Object.keys(p.equips)) if (p.equips[k]) n++;
    n += p.judge.length + (p.stars ? p.stars.length : 0);
  }
  return n + g.deck.length + g.discardPile.length;
};

(async () => {
  // 神憤：3 人身份局，塞 6 個暴怒
  const g = SETUP.makeGame({
    mode: 'id3', packs: ['std'], generalPacks: ['std', 'god'],
    forcedGenerals: [[GEN['神呂布']], [GEN['曹操']], [GEN['孫權']]],
  });
  const lv = g.players[0];
  g.current = lv; g.phase = 'play';
  lv.marks['暴怒'] = 6;
  const markBefore = g.marks(lv, '暴怒');
  const before = countCards(g);
  // 用牌堆裡的牌給對手裝備（不另外造牌，才驗得準守恆）
  const w = g.deck.pop();
  w.name = '青釭劍'; w.type = 'equip'; w.slot = 'weapon'; w.range = 2;
  g.players[1].hand.push(w); g.equipCard(g.players[1], w);
  const hps = g.players.map(p => p.hp);
  await g.SK['神憤'].active(g, lv);
  const after = countCards(g);
  check(g.players[1].hp === hps[1] - 1, `神憤對曹操造成 1 點傷害（${hps[1]} → ${g.players[1].hp}）`);
  check(g.players[1].equips.weapon === null, '神憤令曹操棄掉武器');
  check(g.players[1].hand.length <= 4, `神憤令曹操手牌降到 4 張以內（現 ${g.players[1].hand.length}）`);
  check(lv.flipped === true, '神憤後神呂布翻面');
  // 神憤扣 6 個，但狂暴會因造成傷害再補回來（每名受傷角色 +1）
  const dmgTargets = g.others(lv).filter(q => q.hp < hps[g.players.indexOf(q)]).length;
  check(g.marks(lv, '暴怒') === markBefore - 6 + dmgTargets,
    `神憤扣 6 個暴怒、狂暴補 ${dmgTargets} 個（${markBefore} → ${g.marks(lv, '暴怒')}）`);
  check(before === after, `牌數守恆（${before} → ${after}）`);

  // 無謀：使用普通錦囊時消耗暴怒
  const g2 = SETUP.makeGame({ mode: 'duel', packs: ['std'], generalPacks: ['std', 'god'], forcedGenerals: [[GEN['神呂布']], [GEN['曹操']]] });
  const lv2 = g2.players[0];
  lv2.marks['暴怒'] = 1;
  await g2.trigger('cardUsed', { player: lv2, card: { name: '順手牽羊', type: 'trick' }, targets: [] });
  check(lv2.marks['暴怒'] === 0, '無謀：普通錦囊消耗 1 個暴怒');
  await g2.trigger('cardUsed', { player: lv2, card: { name: '順手牽羊', type: 'trick' }, targets: [] });
  check(lv2.hp === lv2.maxHp - 1, `無謀：沒有暴怒時失去 1 點體力（${lv2.hp}/${lv2.maxHp}）`);
  await g2.trigger('cardUsed', { player: lv2, card: { name: '樂不思蜀', type: 'trick' }, targets: [] });
  check(lv2.hp === lv2.maxHp - 1, '無謀：延時錦囊不觸發');

  console.log(fails === 0 ? '\n全部通過' : `\n${fails} 項失敗`);
  process.exit(fails ? 1 : 0);
})();
