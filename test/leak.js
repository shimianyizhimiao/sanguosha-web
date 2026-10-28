/* 找出牌跑到哪裡去了：比對開局與結束的卡牌 id 集合 */
const { root } = require('./load');
const SETUP = root.SGS_SETUP, GEN = root.SGS_GENERALS, CARDS = root.SGS_CARDS;

const WHO = process.argv[2] || '神劉備';
const N = parseInt(process.argv[3] || '12', 10);

function snapshot(g) {
  const ids = new Map();
  const put = (c, where) => { if (c && c.id) ids.set(c.id, { name: c.name, where }); };
  g.deck.forEach(c => put(c, 'deck'));
  g.discardPile.forEach(c => put(c, 'discard'));
  for (const p of g.players) {
    p.hand.forEach(c => put(c, p.id + ':hand'));
    for (const s of ['weapon', 'armor', 'horse+', 'horse-', 'treasure']) put(p.equips[s], p.id + ':' + s);
    p.judge.forEach(c => put(c, p.id + ':judge'));
  }
  return ids;
}

(async () => {
  for (let i = 0; i < N; i++) {
    const g = SETUP.makeGame({
      mode: 'duel', packs: ['std', 'ex'],
      generalPacks: ['std', 'jie', 'god', 'sp', 'famous'],
      forcedGenerals: [[GEN[WHO]], null],
    });
    // 開局時還在牌堆+手牌裡的所有牌
    const before = new Map();
    for (const c of g.deck) before.set(c.id, c.name);
    for (const p of g.players) for (const c of p.hand) before.set(c.id, c.name);

    await g.runGame();

    const after = snapshot(g);
    const missing = [];
    for (const [id, name] of before) if (!after.has(id)) missing.push(name);
    const total = g.deck.length + g.discardPile.length + g.players.reduce((a, p) =>
      a + p.hand.length + ['weapon', 'armor', 'horse+', 'horse-', 'treasure'].filter(s => p.equips[s]).length +
      p.judge.length, 0);
    if (missing.length || total !== CARDS.buildDeck(['std', 'ex']).length) {
      console.log(`第 ${i + 1} 局：總數 ${total}（應 160）／失蹤 ${missing.length} 張：${missing.slice(0, 8).join('、')}`);
      console.log('  最後 8 條：', g.logs.slice(-8).map(l => l.msg).join(' / '));
      break;
    }
  }
  console.log('檢查完畢');
})();
