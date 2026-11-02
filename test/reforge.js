/* 【鐵索連環】重鑄：出牌階段可以棄掉它摸一張牌
   用法： node test/reforge.js
*/
const { root } = require('./load');
const SETUP = root.SGS_SETUP, GEN = root.SGS_GENERALS, CARDS = root.SGS_CARDS;

let fails = 0;
const check = (cond, msg) => { if (!cond) fails++; console.log((cond ? '✅' : '❌') + ' ' + msg); };

(async () => {
  const g = SETUP.makeGame({
    mode: 'duel', packs: ['std', 'ex'], generalPacks: ['std'],
    forcedGenerals: [[GEN['劉備']], [GEN['孫權']]],
  });
  const me = g.players[0], foe = g.players[1];
  g.current = me; g.phase = 'play';

  // 把【鐵索連環】塞進手牌（含 ex 牌堆才有）
  const deck = CARDS.buildDeck(['std', 'ex']);
  const chain = deck.filter(c => c.name === '鐵索連環');
  check(chain.length > 0, `牌堆有【鐵索連環】（${chain.length} 張）`);
  check(chain.every(c => c.reforge), '【鐵索連環】的牌物件帶 reforge 旗標');
  me.hand.length = 0;
  me.hand.push(chain[0]);

  // 1. 引擎要知道它可以重鑄
  const list = g.reforgeableCards(me);
  check(list.length === 1 && list[0] === chain[0], 'reforgeableCards() 找得到【鐵索連環】');

  // 2. 出牌階段的詢問要帶 reforge 清單
  const seen = [];
  const origAsk = g.ask.bind(g);
  g.ask = async (who, req) => {
    seen.push(req);
    if (req.kind === 'play') {
      if (!me.__didReforge && req.reforge && req.reforge.length) { me.__didReforge = true; return { reforge: req.reforge[0].id }; }
      return { end: true };
    }
    if (!req.kind === 'play') return origAsk(who, req);
    return null;
  };

  const handBefore = me.hand.length;
  const discardBefore = g.discardPile.length;
  await g.playPhase(me);

  const playAsk = seen.find(r => r.kind === 'play');
  check(!!playAsk && Array.isArray(playAsk.reforge) && playAsk.reforge.length === 1, '出牌詢問帶了 1 張可重鑄的牌');
  check(!!playAsk && playAsk.reforge[0].name === '鐵索連環', '重鑄清單裡是【鐵索連環】');

  check(me.hand.length === handBefore, `重鑄後手牌數不變（棄 1 摸 1）：${handBefore} → ${me.hand.length}`);
  check(g.discardPile.length === discardBefore + 1, `棄牌堆 +1：${discardBefore} → ${g.discardPile.length}`);
  check(g.discardPile[g.discardPile.length - 1].name === '鐵索連環', '棄掉的是【鐵索連環】');
  check(!me.hand.includes(chain[0]), '【鐵索連環】已離開手牌');
  check((g.logs || []).some(l => /重鑄/.test(l.msg)), '日誌有「重鑄」字樣');

  // 3. 重鑄過就從清單消失
  check(g.reforgeableCards(me).length === 0, '重鑄後清單裡沒有它了');

  // 4. 空手牌時不會硬要重鑄（不會卡住出牌階段）
  me.hand.length = 0;
  g.ask = async (who, req) => (req.kind === 'play' ? { end: true } : null);
  let threw = false;
  try { await g.playPhase(me); } catch (e) { threw = true; console.log('   拋錯：', e.message); }
  check(!threw, '沒有可重鑄的牌時出牌階段正常結束');

  console.log(fails === 0 ? '\n全部通過' : `\n${fails} 項失敗`);
  process.exit(fails === 0 ? 0 : 1);
})();
