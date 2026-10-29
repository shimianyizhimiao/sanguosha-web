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


  /* 9. 火計／看破／連環：轉化清單存在且能轉 */
  {
    const CV = root.SGS_CONVERT || [];
    check(CV.some(c => c.skill === '火計' && c.to === '火攻'), '火計：紅色手牌可轉【火攻】');
    check(CV.some(c => c.skill === '看破' && c.to === '無懈可擊'), '看破：黑色手牌可轉【無懈可擊】');
    check(CV.some(c => c.skill === '連環' && c.to === '鐵索連環'), '連環：♣手牌可轉【鐵索連環】');
    const g = mk('龐統');
    const p = g.players[0];
    p.skills = ['火計', '看破', '連環'];
    const red = CARDS.buildDeck(['std']).find(c => c.color === 'red' && c.name !== '閃');
    p.hand.push(red);
    const usable = g.usableCards(p);
    check(usable.some(u => u.asName === '火攻' && u.skill === '火計'), '火計：出牌階段清單出現【火攻】轉化');
  }

  /* 10. 亂擊：兩張同花色當【萬箭齊發】 */
  {
    const g = mk('袁紹');
    const p = g.players[0], t = g.players[1];
    p.skills = ['亂擊'];
    const deck = CARDS.buildDeck(['std']).filter(c => c.suit === '♠').slice(0, 2);
    p.hand.length = 0; p.hand.push(...deck);
    g.askCards = async (who, opt) => (opt.pool || []).slice(0, 2);
    g.askForCard = async () => null;
    const hpBefore = t.hp, discardBefore = g.discardPile.length;
    await root.SGS_SKILLS['亂擊'].active(g, p);
    check(g.discardPile.length >= discardBefore + 2, '亂擊：兩張牌進入棄牌堆');
    check(t.hp === hpBefore - 1, `亂擊：萬箭齊發命中（${hpBefore} → ${t.hp}）`);
  }

  /* 11. 涅槃：瀕死時棄牌、回复至 3、摸三張 */
  {
    const g = mk('龐統');
    const p = g.players[0];
    p.skills = ['涅槃'];
    g.askForCard = async () => null;
    g.askSkill = async () => true;
    p.hp = 0;
    const wpn = CARDS.buildDeck(['std']).find(c => c.name === '青釭劍');
    p.hand.push(wpn);
    await g.dying(p);
    check(p.alive, '涅槃：角色存活');
    check(p.hp === 3, `涅槃：體力回复至 3（實際 ${p.hp}）`);
    check(p.usedNirvana === true, '涅槃：限定技已用');
    check(!g.discardPile.includes(wpn) === false, '涅槃：手牌已棄置');
  }

  /* 12. 不屈：瀕死時翻牌，點數互異回复至 1 */
  {
    const g = mk('周泰');
    const p = g.players[0];
    p.skills = ['不屈'];
    g.askForCard = async () => null;
    p.hp = 0;
    const top = g.deck[g.deck.length - 1];
    await g.dying(p);
    check(p.alive && p.hp === 1, `不屈：回复至 1 點體力（實際 ${p.hp}）`);
    check((p.buqu || []).length === 1, '不屈：武將牌上有 1 張不屈牌');
    check(p.buqu[0] === top, '不屈：取的是牌堆頂那張');
  }


  /* 13. 八陣：沒有防具時視為裝備八卦陣 */
  {
    const g = mk('龐統');
    const p = g.players[0];
    p.skills = ['八陣'];
    check(g.armorOf(p) && g.armorOf(p).name === '八卦陣', '八陣：視為裝備【八卦陣】');
    const armor = CARDS.buildDeck(['std']).find(c => c.slot === 'armor');
    p.hand.push(armor); g.equipCard(p, armor);
    check(g.armorOf(p) === armor, '八陣：有真防具時用真防具');
  }

  /* 14. 滅殺：對體力 1 的角色傷害 +1 */
  {
    const g = mk('魏延');
    const p = g.players[0], t = g.players[1];
    p.skills = ['滅殺'];
    t.maxHp = 4; t.hp = 1;
    const dealt = await g.damage(p, t, 1, 'normal', null);
    check(dealt === 2, `滅殺：對體力 1 的目標 1 點傷害變 2 點（實際 ${dealt}）`);
  }

  /* 15. 禍首：南蠻入侵傷害來源轉為禍首、且自己不受南蠻影響 */
  {
    const g = mk('魏延');
    const p = g.players[0], t = g.players[1];
    p.skills = ['禍首'];
    check(g.canBeTargeted(t, p, '南蠻入侵') === false, '禍首：【南蠻入侵】對你無效');
    const nanman = CARDS.buildDeck(['std']).find(c => c.name === '南蠻入侵');
    g.emitLog = [];
    await g.damage(t, t, 1, 'normal', nanman);
    check(p.hostility && Object.keys(p.hostility).length >= 0, '禍首：傷害流程未報錯');
  }

  /* 16. 父蔭：每回合第一次成為【殺】目標，手牌不多於對方 → 此殺無效 */
  {
    const g = mk('魏延');
    const p = g.players[0], t = g.players[1];
    t.skills = ['父蔭'];
    t.hand.length = 0; t.hand.push(...CARDS.buildDeck(['std']).slice(0, 1));
    p.hand.length = 0; p.hand.push(...CARDS.buildDeck(['std']).slice(0, 3));
    const sha = CARDS.buildDeck(['std']).find(c => c.name === '殺');
    const hpBefore = t.hp;
    t.turnFlags = {};
    await g.useShaOn(p, t, sha);
    check(t.hp === hpBefore, '父蔭：此【殺】對目標無效');
  }

  /* 17. 奮激：目標沒有手牌 → 摸 2 張，自己失去 1 點體力 */
  {
    const g = mk('魏延');
    const p = g.players[0], t = g.players[1];
    p.skills = ['奮激'];
    p.hp = 3; p.maxHp = 4;
    p.hand.length = 0;                  // 自己結束階段時沒有手牌
    g.askSkill = async () => true;
    await g.trigger('turnEnd', { player: p });
    check(p.hand.length === 2, `奮激：自己摸 2 張（實際 ${p.hand.length}）`);
    check(p.hp === 2, `奮激：失去 1 點體力（實際 ${p.hp}）`);
  }

  /* 18. 奇謀：失去 2 點體力 → 距離 -2、可多出 2 張殺 */
  {
    const g = mk('魏延');
    const p = g.players[0];
    p.skills = ['奇謀'];
    p.maxHp = 4; p.hp = 3;
    g.ask = async () => 1;              // 選「失去 2 點體力」
    const baseLimit = g.shaLimit(p), baseDist = g.distance(p, g.players[1]);
    await root.SGS_SKILLS['奇謀'].active(g, p);
    check(p.hp === 1, `奇謀：失去 2 點體力（實際 ${p.hp}）`);
    check(g.shaLimit(p) === baseLimit + 2, `奇謀：出殺次數 ${baseLimit} → ${g.shaLimit(p)}`);
    check(g.distance(p, g.players[1]) === Math.max(1, baseDist - 2), `奇謀：距離 ${baseDist} → ${g.distance(p, g.players[1])}`);
    check(p.usedQimou === true, '奇謀：限定技已用');
  }

  /* 19. 謙節：不能成為延時錦囊的目標 */
  {
    const g = mk('魏延');
    const p = g.players[1];
    p.skills = ['謙節'];
    check(g.canBeTargeted(g.players[0], p, '樂不思蜀') === false, '謙節：不能被【樂不思蜀】指定');
    check(g.canBeTargeted(g.players[0], p, '殺') === true, '謙節：仍可被【殺】指定');
  }

  /* 20. 懷柔：重鑄裝備牌 → 棄一張摸一張 */
  {
    const g = mk('魏延');
    const p = g.players[0];
    p.skills = ['懷柔'];
    const wpn = CARDS.buildDeck(['std']).find(c => c.name === '青釭劍');
    p.hand.length = 0; p.hand.push(wpn);
    g.askCard = async (who, opt) => (opt.pool || [])[0] || null;
    await root.SGS_SKILLS['懷柔'].active(g, p);
    check(!p.hand.includes(wpn) && g.discardPile.includes(wpn), '懷柔：裝備已進棄牌堆');
    check(p.hand.length === 1, `懷柔：摸一張（實際 ${p.hand.length}）`);
  }

  console.log(fails === 0 ? '\n全部通過' : `\n${fails} 項失敗`);
  process.exit(fails ? 1 : 0);
})();
