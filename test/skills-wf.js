/* 風林火山技能機制驗證（第一批 8 個）
   用法：node test/skills-wf.js
*/
const { root } = require('./load');
const SETUP = root.SGS_SETUP, GEN = root.SGS_GENERALS, CARDS = root.SGS_CARDS;

let fails = 0;
const check = (cond, msg) => { if (!cond) fails++; console.log((cond ? '✅' : '❌') + ' ' + msg); };

function mk(a, b) {
  const g = SETUP.makeGame({
    mode: 'duel', packs: ['std'], generalPacks: ['std', 'windfire'],
    forcedGenerals: [[GEN[a]], [GEN[b] || GEN['孫權']]],
  });
  g.current = g.players[0]; g.phase = 'play';
  g.players.forEach(p => { p.turnFlags = p.turnFlags || {}; });
  return g;
}

(async () => {
  /* 1. 血裔：手牌上限 +2 × 其他群勢力數 */
  {
    const g = mk('袁紹', '賈詡');           // 賈詡是群
    const [yuan, jia] = g.players;
    yuan.skills = ['血裔'];
    jia.generals[0].kingdom = '群';
    const base = yuan.hp;
    check(g.handLimit(yuan) === base + 2, `血裔：手牌上限 ${g.handLimit(yuan)}（基礎 ${base} +2）`);
    jia.alive = false;
    check(g.handLimit(yuan) === base, '血裔：群勢力角色死亡後加成消失');
  }

  /* 2. 據守：結束階段摸 3 張並翻面 */
  {
    const g = mk('曹仁');
    const p = g.players[0];
    p.skills = ['據守'];
    g.askSkill = async () => true;
    const before = p.hand.length;
    await g.trigger('turnEnd', { player: p });
    check(p.hand.length === before + 3, `據守：摸 3 張（${before} → ${p.hand.length}）`);
    check(p.flipped === true, '據守：武將牌已翻面');
  }

  /* 3. 狂骨：對距離 1 的目標造成傷害後回复 1 點 */
  {
    const g = mk('魏延');
    const p = g.players[0], t = g.players[1];
    p.skills = ['狂骨'];
    p.maxHp = 4; p.hp = 2;
    await g.damage(p, t, 1, 'normal', null);
    check(p.hp === 3, `狂骨：造成傷害後回复體力（2 → ${p.hp}）`);
  }

  /* 4. 破虜：造成 2 點傷害摸 2 張 */
  {
    const g = mk('孫堅');
    const p = g.players[0], t = g.players[1];
    p.skills = ['破虜'];
    g.askSkill = async () => true;
    const before = p.hand.length;
    await g.damage(p, t, 2, 'normal', null);
    check(p.hand.length === before + 2, `破虜：傷害 2 摸 2 張（${before} → ${p.hand.length}）`);
  }

  /* 5. 烈弓：目標手牌不多於攻擊範圍 → 不能出閃 */
  {
    const g = mk('黃忠');
    const p = g.players[0], t = g.players[1];
    p.skills = ['烈弓'];
    p.hp = 4;
    t.hand.length = 0;
    const sha = CARDS.buildDeck(['std']).find(c => c.name === '殺');
    const ctx = { source: p, target: t, card: sha, noShan: false };
    await g.trigger('shaTargeted', ctx);
    check(ctx.noShan === true, '烈弓：目標手牌少於攻擊範圍 → 此【殺】不能閃');
    t.hand.length = 0;
    t.hand.push(...CARDS.buildDeck(['std']).slice(0, 2));   // 2 張：介於攻擊範圍 1 與體力 4 之間
    const ctx2 = { source: p, target: t, card: sha, noShan: false };
    await g.trigger('shaTargeted', ctx2);
    check(ctx2.noShan === false, '烈弓：手牌 2、體力 4、範圍 1 → 可以閃');
    t.hand.push(...CARDS.buildDeck(['std']).slice(0, 6));   // 8 張 ≥ 體力 4
    const ctx3 = { source: p, target: t, card: sha, noShan: false };
    await g.trigger('shaTargeted', ctx3);
    check(ctx3.noShan === true, '烈弓：手牌 8 ≥ 體力 4 → 不能閃');
  }

  /* 6. 直諫：把裝備置入隊友裝備區，自己摸 1 張 */
  {
    const g = mk('張昭&張紘');
    const p = g.players[0], t = g.players[1];
    p.skills = ['直諫'];
    const wpn = CARDS.buildDeck(['std']).find(c => c.name === '青釭劍');
    p.hand.push(wpn);
    g.askCard = async (who, opt) => ((opt.pool || []).includes(wpn) ? wpn : (opt.pool || [])[0] || null);
    g.askTargets = async () => [t];
    const before = p.hand.length;   // 含武器
    await root.SGS_SKILLS['直諫'].active(g, p);
    check(t.equips.weapon === wpn, '直諫：裝備進入目標的武器欄');
    check(p.hand.length === before, `直諫：自己摸 1 張（${before} → ${p.hand.length}）`);
    check(p.turnFlags['直諫'] === true, '直諫：本回合已使用標記');
    check(root.SGS_SKILLS['直諫'].canUse(g, p) === false, '直諫：同回合不能再用');
  }

  /* 7. 固政：其他角色棄牌階段，一張還他、其餘歸你 */
  {
    const g = mk('張昭&張紘');
    const p = g.players[0], t = g.players[1];
    p.skills = ['固政'];
    g.askSkill = async () => true;
    const cards = CARDS.buildDeck(['std']).slice(0, 3);
    g.discardPile.push(...cards);
    const th = t.hand.length, ph = p.hand.length;
    g.askCard = async (who, opt) => (opt.pool || [])[0] || null;
    await g.trigger('discardPhaseEnd', { player: t, count: 3, cards });
    check(t.hand.length === th + 1, '固政：目標獲得 1 張');
    check(p.hand.length === ph + 2, '固政：自己獲得其餘 2 張');
  }

  /* 8. 英魂：已受傷時令目標摸 X 張再棄 1 張 */
  {
    const g = mk('孫堅');
    const p = g.players[0], t = g.players[1];
    p.skills = ['英魂'];
    p.maxHp = 4; p.hp = 2;                       // 失去 2 點
    g.askSkill = async () => true;
    g.askTargets = async () => [t];
    g.ask = async () => 0;                       // 選「摸 X 再棄一」
    g.askCards = async () => (t.hand.length ? [t.hand[0]] : []);
    const before = t.hand.length;
    await g.trigger('turnStart', { player: p });
    check(t.hand.length === before + 2 - 1, `英魂：摸 2 棄 1（${before} → ${t.hand.length}）`);
  }

  console.log(fails === 0 ? '\n全部通過' : `\n${fails} 項失敗`);
  process.exit(fails ? 1 : 0);
})();
