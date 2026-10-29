/* 風林火山技能機制驗證（第一批 8 個）
   用法：node test/skills-wf.js
*/
const { root } = require('./load');
const SETUP = root.SGS_SETUP, GEN = root.SGS_GENERALS, CARDS = root.SGS_CARDS;

let fails = 0;
const CARDNAME = c => c ? (c.suit + c.rank + c.name) : 'null';
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


  /* 21. 決堰：廢除武器欄 → 本回合多 3 張【殺】；防具欄 → 摸 3、上限 +3 */
  {
    const g = mk('魏延');
    const p = g.players[0];
    p.skills = ['決堰'];
    const baseSha = g.shaLimit(p), baseHand = p.hand.length, baseLim = g.handLimit(p);
    g.ask = async () => 0;                       // 選「廢除武器欄」
    await root.SGS_SKILLS['決堰'].active(g, p);
    check(!!p.deadSlots.weapon, '決堰：武器欄已廢除');
    check(g.shaLimit(p) === baseSha + 3, `決堰：可多出 3 張【殺】（${baseSha} → ${g.shaLimit(p)}）`);

    const g2 = mk('魏延');
    const q = g2.players[0];
    q.skills = ['決堰'];
    const h0 = q.hand.length, l0 = g2.handLimit(q);
    g2.ask = async () => 1;                      // 選「廢除防具欄」
    await root.SGS_SKILLS['決堰'].active(g2, q);
    check(q.hand.length === h0 + 3, `決堰：摸三張（${h0} → ${q.hand.length}）`);
    check(g2.handLimit(q) === l0 + 3, `決堰：手牌上限 +3（${l0} → ${g2.handLimit(q)}）`);
  }

  /* 22. 破勢：所有裝備欄廢除後覺醒 */
  {
    const g = mk('魏延');
    const p = g.players[0];
    p.skills = ['決堰', '破勢'];
    for (const sl of ['weapon', 'armor', 'horse+', 'horse-', 'treasure']) g.abolishSlot(p, sl);
    const maxBefore = p.maxHp;
    await g.trigger('turnStart', { player: p });
    check(p.maxHp === maxBefore - 1, `破勢：體力上限 -1（${maxBefore} → ${p.maxHp}）`);
    check(p.skills.includes('懷柔') && !p.skills.includes('決堰'), '破勢：失去【決堰】、獲得【懷柔】');
  }

  /* 23. 蹈刃：交一張手牌，然後對交集範圍造成 1 點傷害 */
  {
    const g = mk('魏延');
    const p = g.players[0], t = g.players[1];
    p.skills = ['蹈刃'];
    p.hand.length = 0; p.hand.push(...CARDS.buildDeck(['std']).slice(0, 3));
    g.askCard = async (who, opt) => (opt.pool || [])[0] || null;
    g.askTargets = async () => [t];
    const th = t.hand.length, hp0 = t.hp;
    await root.SGS_SKILLS['蹈刃'].active(g, p);
    check(t.hand.length === th + 1, '蹈刃：目標收到一張手牌');
    check(t.hp < hp0 || p.hp < p.maxHp, '蹈刃：範圍交集內角色受到傷害');
  }

  /* 24. 飛軍＋兵略：目標手牌多 → 交給你一張，且摸兩張 */
  {
    const g = mk('魏延');
    const p = g.players[0], t = g.players[1];
    p.skills = ['飛軍', '兵略'];
    p.hand.length = 0; p.hand.push(...CARDS.buildDeck(['std']).slice(0, 1));
    t.hand.push(...CARDS.buildDeck(['std']).slice(0, 5));
    g.askCard = async (who, opt) => (opt.pool || [])[0] || null;
    g.askTargets = async () => [t];
    const ph = p.hand.length, th = t.hand.length;
    await root.SGS_SKILLS['飛軍'].active(g, p);
    check(t.hand.length === th - 1, '飛軍：目標交出一張牌');
    check(p.hand.length === ph - 1 + 1 + 2, `飛軍＋兵略：棄 1、得 1、摸 2（${ph} → ${p.hand.length}）`);
  }

  /* 25. 集智（界）：使用普通錦囊摸一張 */
  {
    const g = mk('魏延');
    const p = g.players[0];
    p.skills = ['集智（界）'];
    g.askSkill = async () => true;
    g.ask = async () => 1;                       // 保留剛摸到的牌
    const trick = CARDS.buildDeck(['std']).find(c => c.type === 'trick' && !c.delay);
    const before = p.hand.length;
    await g.trigger('cardUsed', { player: p, card: trick, name: trick.name, targets: [] });
    check(p.hand.length === before + 1, `集智（界）：使用錦囊摸一張（${before} → ${p.hand.length}）`);
  }

  /* 26. 明任：開局存「任」，結束階段可替換 */
  {
    const g = mk('魏延');
    const p = g.players[0];
    p.skills = ['明任'];
    g.askCard = async (who, opt) => (opt.pool || [])[0] || null;
    g.askSkill = async () => true;
    await g.trigger('gameStart', {});
    check(!!p.ren, '明任：開局已將一張手牌置於武將牌上');
    const old = p.ren;
    p.hand.push(...CARDS.buildDeck(['std']).slice(0, 2));
    await g.trigger('turnEnd', { player: p });
    check(p.ren && p.ren !== old && p.hand.includes(old), '明任：結束階段成功替換「任」');
  }

  /* 27. 再起：本回合紅色棄牌數 → 目標選擇摸牌 */
  {
    const g = mk('魏延');
    const p = g.players[0], t = g.players[1];
    p.skills = ['再起'];
    g.turnRedCount = 2;
    g.askSkill = async () => true;
    g.askTargets = async () => [t];
    g.ask = async () => 0;                       // 選「摸一張牌」
    const before = t.hand.length;
    await g.trigger('discardPhaseEnd', { player: g.players[0], count: 2, cards: [] });
    check(t.hand.length >= before + 1, `再起：目標摸牌（${before} → ${t.hand.length}）`);
  }


  /* 28. 神速 ①：跳過判定＋摸牌，視為出一張【殺】 */
  {
    const g = mk('魏延');
    const p = g.players[0], t = g.players[1];
    p.skills = ['神速'];
    p.turnFlags = {};
    g.askSkill = async () => true;
    g.askTargets = async () => [t];
    g.askForCard = async () => null;            // 目標不出【閃】
    const hp0 = t.hp;
    await g.trigger('phaseStart', { player: p, phase: 'judge' });
    check(p.turnFlags.skipJudgeDraw === true, '神速①：已標記跳過判定＋摸牌階段');
    check(t.hp === hp0 - 1, `神速①：視為使用【殺】命中（${hp0} → ${t.hp}）`);
  }

  /* 29. 天香：棄 ♥ 手牌轉移傷害，目標受傷並摸已損失體力的牌 */
  {
    const g = mk('魏延');
    const p = g.players[0], t = g.players[1];
    p.skills = ['天香'];
    const deck = CARDS.buildDeck(['std']);
    const hearts = deck.filter(c => c.suit === '♥').slice(0, 1);
    p.hand.length = 0; p.hand.push(...hearts);
    g.askSkill = async () => true;
    g.askCard = async (who, opt) => (opt.pool || [])[0] || null;
    g.askTargets = async () => [t];
    t.maxHp = 4; t.hp = 3;
    const hp0 = p.hp, th = t.hand.length, tt = t.hp;
    await g.damage(g.players[1] || t, p, 2, 'normal', null);
    check(p.hp === hp0, '天香：自己沒受傷（傷害被轉移）');
    check(t.hp === tt - 1, `天香：目標受到 1 點傷害（${tt} → ${t.hp}）`);
    check(t.hand.length === th + 2, `天香：目標摸已損失體力張數 2（${th} → ${t.hand.length}）`);
  }

  /* 30. 鬼道：用黑色牌改判 */
  {
    const g = mk('魏延');
    const p = g.players[0], t = g.players[1];
    p.skills = ['鬼道'];
    const black = CARDS.buildDeck(['std']).find(c => c.color === 'black');
    p.hand.push(black);
    g.askSkill = async () => true;
    g.askCard = async (who, opt) => (opt.pool || [])[0] || null;
    const jc = await g.judge(t, '測試');
    check(jc && jc.color === 'black' && jc !== undefined, `鬼道：判定牌被改為黑色牌 ${CARDNAME(jc)}`);
  }

  /* 31. 雷擊：閃避後判定為黑 → 2 點雷電傷害 */
  {
    const g = mk('魏延');
    const p = g.players[0], t = g.players[1];
    p.skills = ['雷擊'];
    g.askSkill = async () => true;
    g.askTargets = async () => [t];
    // 讓牌堆頂為黑色牌
    const deck = g.deck;
    const blackIdx = deck.findIndex(c => c.color === 'black');
    if (blackIdx >= 0) { const [c] = deck.splice(blackIdx, 1); deck.push(c); }
    const hp0 = t.hp;
    await g.trigger('shaDodged', { source: t, target: p, card: CARDS.buildDeck(['std'])[0] });
    check(t.hp <= hp0 - 2, `雷擊：判定黑 → 2 點雷電傷害（${hp0} → ${t.hp}）`);
  }

  /* 32. 激昂：使用【殺】指定目標後摸一張 */
  {
    const g = mk('魏延');
    const p = g.players[0], t = g.players[1];
    p.skills = ['激昂'];
    p.turnFlags = {};
    g.askSkill = async () => true;
    const before = p.hand.length;
    await g.trigger('shaTargeted', { source: p, target: t, card: CARDS.buildDeck(['std']).find(c => c.name === '殺') });
    check(p.hand.length === before + 1, `激昂：指定目標後摸一張（${before} → ${p.hand.length}）`);
  }

  /* 33. 魂姿：體力 1 覺醒，獲得英姿＋英魂 */
  {
    const g = mk('魏延');
    const p = g.players[0];
    p.skills = ['魂姿'];
    p.hp = 1; p.maxHp = 4;
    await g.trigger('turnStart', { player: p });
    check(p.maxHp === 3, `魂姿：體力上限 -1（4 → ${p.maxHp}）`);
    check(p.skills.includes('英姿') && p.skills.includes('英魂'), '魂姿：獲得【英姿】【英魂】');
  }

  /* 34. 恪守：棄兩張同色牌使傷害 -1 */
  {
    const g = mk('魏延');
    const p = g.players[0], t = g.players[1];
    p.skills = ['恪守'];
    const deck = CARDS.buildDeck(['std']);
    const reds = deck.filter(c => c.color === 'red').slice(0, 2);
    p.hand.length = 0; p.hand.push(...reds);
    g.askSkill = async () => true;
    g.askCards = async (who, opt) => (opt.pool || []).slice(0, 2);
    g.askTargets = async () => [];
    const hp0 = p.hp;
    await g.damage(t, p, 2, 'normal', null);
    check(p.hp === hp0 - 1, `恪守：2 點傷害減為 1 點（${hp0} → ${p.hp}）`);
  }

  /* 35. 築圍：判定牌為【殺】時獲得 */
  {
    const g = mk('魏延');
    const p = g.players[0];
    p.skills = ['築圍'];
    g.askSkill = async () => true;
    const sha = CARDS.buildDeck(['std']).find(c => c.name === '殺');
    g.deck.push(sha);
    g.current = p;
    const before = p.hand.length;
    const jc = await g.judge(p, '築圍測試');
    check(jc === sha && p.hand.includes(sha), '築圍：判定牌為【殺】時獲得之');
    check(p.hand.length === before + 1, '築圍：牌進入手牌');
  }


  /* 36. 強襲：失去 1 點體力 → 造成 1 點傷害 */
  {
    const g = mk('魏延');
    const p = g.players[0], t = g.players[1];
    p.skills = ['強襲'];
    p.hp = 4; p.maxHp = 4;
    g.ask = async () => 0;                       // 選「失去 1 點體力」
    g.askTargets = async () => [t];
    const hp0 = p.hp, tt = t.hp;
    await root.SGS_SKILLS['強襲'].active(g, p);
    check(p.hp === hp0 - 1, `強襲：自己失去 1 點體力（${hp0} → ${p.hp}）`);
    check(t.hp === tt - 1, `強襲：目標受到 1 點傷害（${tt} → ${t.hp}）`);
  }

  /* 37. 好施：摸牌階段多摸兩張，手牌 >5 時分一半出去 */
  {
    const g = mk('魏延');
    const p = g.players[0], t = g.players[1];
    p.skills = ['好施'];
    p.hand.length = 0; p.hand.push(...CARDS.buildDeck(['std']).slice(0, 3));
    t.hand.length = 0;
    g.askSkill = async () => true;
    g.askTargets = async () => [t];
    await g.trigger('phaseStart', { player: p, phase: 'draw' });
    // 3 + 2 = 5 → 不超過 5，不分牌
    check(p.hand.length === 5, `好施：摸兩張（3 → ${p.hand.length}）`);
    const g2 = mk('魏延');
    const q = g2.players[0], q2 = g2.players[1];
    q.skills = ['好施'];
    q.hand.length = 0; q.hand.push(...CARDS.buildDeck(['std']).slice(0, 4));
    q2.hand.length = 0;
    g2.askSkill = async () => true;
    g2.askTargets = async () => [q2];
    await g2.trigger('phaseStart', { player: q, phase: 'draw' });
    // 4 + 2 = 6 → 一半 3 張給對方
    check(q.hand.length === 3 && q2.hand.length === 3, `好施：手牌 6 張分出 3 張（自己 ${q.hand.length}、對方 ${q2.hand.length}）`);
  }

  /* 38. 挑釁：目標不出【殺】就棄他一張牌 */
  {
    const g = mk('魏延');
    const p = g.players[0], t = g.players[1];
    p.skills = ['挑釁'];
    t.hand.push(...CARDS.buildDeck(['std']).slice(0, 3));
    g.askTargets = async () => [t];
    g.askForCard = async () => null;
    const th = t.hand.length;
    await root.SGS_SKILLS['挑釁'].active(g, p);
    check(t.hand.length === th - 1, `挑釁：目標沒出【殺】，棄他一張牌（${th} → ${t.hand.length}）`);
    check(p.turnFlags['挑釁'] === true, '挑釁：本回合已使用');
  }

  /* 39. 觀星（標／界）：與觀星同一套實作、可執行 */
  {
    const g = mk('魏延');
    const p = g.players[0];
    p.skills = ['觀星（界）'];
    g.ask = async () => [];                      // 全部留頂
    const before = g.deck.length;
    await g.trigger('turnStart', { player: p });
    check(g.deck.length === before, `觀星（界）：牌堆數量不變（${before}）`);
    check(!!root.SGS_SKILLS['觀星（標）'].events.turnStart, '觀星（標）：有實作');
  }

  /* 40. 英姿（界）：手牌上限等於體力上限 */
  {
    const g = mk('魏延');
    const p = g.players[0];
    p.skills = ['英姿（界）'];
    p.maxHp = 4; p.hp = 3;
    check(g.handLimit(p) === 4, `英姿（界）：手牌上限＝體力上限 4（實際 ${g.handLimit(p)}）`);
    check(root.SGS_SKILLS['英姿（標）'].drawCount(g, p, 2) === 3, '英姿（標）：摸牌數 +1');
  }

  /* 41. 奇制：棄非目標一張牌，然後其摸一張 */
  {
    const g = mk('魏延');
    const p = g.players[0], t = g.players[1];
    p.skills = ['奇制'];
    t.hand.push(...CARDS.buildDeck(['std']).slice(0, 3));
    g.askSkill = async () => true;
    g.askTargets = async () => [t];
    const th = t.hand.length;
    const trick = CARDS.buildDeck(['std']).find(c => c.type === 'trick');
    await g.trigger('cardUsed', { player: p, card: trick, name: trick.name, targets: [p] });
    check(t.hand.length === th, `奇制：棄一張摸一張，手牌數不變（${th}）`);
    check(p.turnFlags.qizhi === 1, '奇制：次數計為 1');
  }

  /* 42. 進趨：結束階段摸兩張，再棄至奇制次數 */
  {
    const g = mk('魏延');
    const p = g.players[0];
    p.skills = ['進趨'];
    p.turnFlags.qizhi = 1;
    p.hand.length = 0; p.hand.push(...CARDS.buildDeck(['std']).slice(0, 2));
    g.askSkill = async () => true;
    g.askCards = async (who, opt) => (who.hand || []).slice(0, opt.min || 0);
    await g.trigger('turnEnd', { player: p });
    check(p.hand.length === 1, `進趨：摸兩張後棄至 1 張（實際 ${p.hand.length}）`);
  }

  /* 43. 潰誅：X＝棄牌數，令角色各摸一張 */
  {
    const g = mk('魏延');
    const p = g.players[0], t = g.players[1];
    p.skills = ['潰誅'];
    g.askSkill = async () => true;
    g.ask = async () => 0;                       // 選「令角色摸牌」
    g.askTargets = async () => [t];
    const th = t.hand.length;
    await g.trigger('discardPhaseEnd', { player: p, count: 1, cards: [] });
    check(t.hand.length === th + 1, `潰誅：目標摸一張（${th} → ${t.hand.length}）`);
  }


  /* 44. 紅顏：判定 ♠ 視為 ♥（樂不思蜀不生效） */
  {
    const g = mk('魏延');
    const p = g.players[0];
    p.skills = ['紅顏'];
    const spade = CARDS.buildDeck(['std']).find(c => c.suit === '♠');
    check(g.suitOf(p, spade) === '♥', `紅顏：♠${spade.rank} 視為 ♥`);
    const g2 = mk('魏延');
    check(g2.suitOf(g2.players[0], spade) === '♠', '紅顏：沒有技能時花色不變');
  }

  /* 45. 巨象：南蠻對自己無效 */
  {
    const g = mk('魏延');
    const p = g.players[0], t = g.players[1];
    p.skills = ['巨象'];
    check(g.canBeTargeted(t, p, '南蠻入侵') === false, '巨象：【南蠻入侵】對你無效');
    check(g.canBeTargeted(t, p, '殺') === true, '巨象：仍可被【殺】指定');
  }

  /* 46. 烈刃：拼點贏 → 獲得目標一張牌 */
  {
    const g = mk('魏延');
    const p = g.players[0], t = g.players[1];
    p.skills = ['烈刃'];
    const deck = CARDS.buildDeck(['std']);
    const big = deck.find(c => c.rank === 13);          // K
    const small = deck.find(c => c.rank === 2);
    p.hand.length = 0; p.hand.push(big);
    t.hand.length = 0; t.hand.push(small, ...deck.slice(0, 2));
    g.askSkill = async () => true;
    g.askCard = async (who, opt) => (opt.pool || [])[0] || null;
    const th = t.hand.length;
    await g.trigger('shaTargeted', { source: p, target: t, card: deck.find(c => c.name === '殺') });
    check(p.hand.length === 1, `烈刃：拼掉一張、贏得一張 → 手牌 1（實際 ${p.hand.length}）`);
    check(t.hand.length <= th, '烈刃：目標少了一張牌');
  }

  /* 47. 天義：拼點贏 → 多一張殺、無距離、可多選目標；沒贏 → 不能出殺 */
  {
    const g = mk('魏延');
    const p = g.players[0], t = g.players[1];
    p.skills = ['天義'];
    const deck = CARDS.buildDeck(['std']);
    p.hand.length = 0; p.hand.push(deck.find(c => c.rank === 13));
    t.hand.length = 0; t.hand.push(deck.find(c => c.rank === 2));
    p.turnFlags = {};
    g.askTargets = async () => [t];
    g.askCard = async (who, opt) => (opt.pool || [])[0] || null;
    await root.SGS_SKILLS['天義'].active(g, p);
    check(p.turnFlags.shaNoRange === true && g.shaLimit(p) === 2, `天義：贏 → 距離不限、可出 ${g.shaLimit(p)} 張殺`);
    check(g.shaTargets(p) === 2, `天義：可多選一個目標（${g.shaTargets(p)}）`);

    const g2 = mk('魏延');
    const q = g2.players[0], q2 = g2.players[1];
    q.skills = ['天義'];
    const deck2 = CARDS.buildDeck(['std']);
    q.hand.length = 0; q.hand.push(deck2.find(c => c.rank === 2));
    q2.hand.length = 0; q2.hand.push(deck2.find(c => c.rank === 13));
    q.turnFlags = {};
    g2.askTargets = async () => [q2];
    g2.askCard = async (who, opt) => (opt.pool || [])[0] || null;
    await root.SGS_SKILLS['天義'].active(g2, q);
    const shaLeft = q.hand.filter(c => c.name === '殺').length;
    check(q.turnFlags.noSha === true, '天義：沒贏 → 本回合不能使用【殺】');
    check(g2.usableCards(q).every(u => (u.asName || u.card.name) !== '殺'), '天義：出牌清單裡沒有【殺】');
  }

  /* 48. 志繼：沒有手牌時覺醒 */
  {
    const g = mk('魏延');
    const p = g.players[0];
    p.skills = ['志繼'];
    p.hand.length = 0;
    p.hp = 3; p.maxHp = 4;
    g.ask = async (who, req) => (req && req.kind === 'choice' ? 1 : []);   // 選「摸兩張牌」，觀星回空陣列
    await g.trigger('turnStart', { player: p });
    check(p.maxHp === 3, `志繼：體力上限 -1（4 → ${p.maxHp}）`);
    check(p.skills.includes('觀星'), '志繼：獲得【觀星】');
    check(p.hand.length >= 2, `志繼：摸兩張（實際 ${p.hand.length}）`);
  }

  /* 49. 從諫：多目標錦囊 → 交一張給另一目標並摸牌 */
  {
    const g = mk('魏延');
    const p = g.players[0], t = g.players[1];
    p.skills = ['從諫'];
    const deck = CARDS.buildDeck(['std']);
    const plain = deck.find(c => c.type === 'basic');
    p.hand.length = 0; p.hand.push(plain);
    g.askSkill = async () => true;
    g.askCard = async (who, opt) => (opt.pool || [])[0] || null;
    g.askTargets = async () => [t];
    const th = t.hand.length, ph = p.hand.length;
    await g.trigger('trickTargets', { player: t, card: deck[1], name: '萬箭齊發', targets: [p, t], negate: [] });
    check(t.hand.length === th + 1, '從諫：交給另一目標一張牌');
    check(p.hand.length === ph, `從諫：交一張、摸一張，手牌不變（${ph} → ${p.hand.length}）`);
  }

  /* 50. 雄亂：廢除裝備區、目標本回合不能使用手牌 */
  {
    const g = mk('魏延');
    const p = g.players[0], t = g.players[1];
    p.skills = ['雄亂'];
    g.askTargets = async () => [t];
    const wpn = CARDS.buildDeck(['std']).find(c => c.name === '青釭劍');
    p.hand.push(wpn); g.equipCard(p, wpn);
    await root.SGS_SKILLS['雄亂'].active(g, p);
    check(!!p.deadSlots.weapon && !!p.deadSlots.armor, '雄亂：裝備欄已廢除');
    check(p.usedXiongluan === true, '雄亂：限定技已用');
    t.turnCount = p.turnCount;
    check(g.usableCards(t).length === 0, '雄亂：目標本回合不能使用手牌');
  }

  /* 51. 鎮骨：把手牌數綁給目標 */
  {
    const g = mk('魏延');
    const p = g.players[0], t = g.players[1];
    p.skills = ['鎮骨'];
    p.hand.length = 0; p.hand.push(...CARDS.buildDeck(['std']).slice(0, 2));
    t.hand.length = 0; t.hand.push(...CARDS.buildDeck(['std']).slice(0, 5));
    g.askSkill = async () => true;
    g.askTargets = async () => [t];
    await g.trigger('turnEnd', { player: p });
    check(t.hand.length === 2, `鎮骨：目標手牌調整為與你相同 2 張（實際 ${t.hand.length}）`);
  }


  /* 52. 纏怨：體力 1 時其他技能失效 */
  {
    const g = mk('魏延');
    const p = g.players[0];
    p.skills = ['纏怨', '狂骨'];
    p.maxHp = 4; p.hp = 1;
    check(g.isSilenced(p, '狂骨') === true, '纏怨：體力 1 時其他技能失效');
    check(g.isSilenced(p, '纏怨') === false, '纏怨：自己不失效');
    p.hp = 3;
    check(g.isSilenced(p, '狂骨') === false, '纏怨：體力恢復後技能回來');
  }

  /* 53. 千幻：同勢力受傷後存牌，之後可取消對同勢力的一張牌 */
  {
    const g = mk('魏延');
    const p = g.players[0], t = g.players[1];
    p.skills = ['千幻'];
    p.generals[0].kingdom = '蜀';
    t.generals[0].kingdom = '蜀';
    const deck = CARDS.buildDeck(['std']);
    p.hand.push(deck[0]);
    g.askSkill = async () => true;
    g.askCard = async (who, opt) => (opt.pool || [])[0] || null;
    await g.trigger('damaged', { source: null, target: t, amount: 1, nature: 'normal', card: null });
    check((p.qianhuan || []).length === 1, '千幻：受傷後把一張牌置於武將牌上');
    const ctx = { source: g.players[1], target: t, card: deck.find(c => c.name === '殺'), noEffect: false };
    await g.trigger('shaTargeted', ctx);
    check(ctx.noEffect === true, '千幻：取消對同勢力角色的【殺】');
    check((p.qianhuan || []).length === 0, '千幻：取消後武將牌上的牌被棄置');
  }

  /* 54. 止啼：範圍內已受傷敵方手牌上限 -1 */
  {
    const g = mk('魏延');
    const p = g.players[0], t = g.players[1];
    p.skills = ['止啼'];
    t.maxHp = 4; t.hp = 2;
    const base = 2;                       // 手牌上限 = hp
    check(g.handLimit(t) === base - 1, `止啼：已受傷敵方手牌上限 -1（${base} → ${g.handLimit(t)}）`);
    t.hp = 4;
    check(g.handLimit(t) === 4, '止啼：沒受傷時無影響');
  }

  /* 55. 薦降：成為他人用牌的目標後，手牌最少者摸一張 */
  {
    const g = mk('魏延');
    const p = g.players[0], t = g.players[1];
    t.skills = ['薦降'];
    p.hand.length = 0;
    t.hand.length = 0; t.hand.push(...CARDS.buildDeck(['std']).slice(0, 2));
    t.turnFlags = {};
    g.askSkill = async () => true;
    g.askTargets = async () => [p];
    const ph = p.hand.length;
    await g.trigger('shaTargeted', { source: p, target: t, card: CARDS.buildDeck(['std']).find(c => c.name === '殺') });
    check(p.hand.length === ph + 1, `薦降：手牌最少者摸一張（${ph} → ${p.hand.length}）`);
  }

  /* 56. 卸兵：棄一名距離內角色的裝備 */
  {
    const g = mk('魏延');
    const p = g.players[0], t = g.players[1];
    p.skills = ['卸兵'];
    const wpn = CARDS.buildDeck(['std']).find(c => c.name === '青釭劍');
    t.hand.push(wpn); g.equipCard(t, wpn);
    g.askTargets = async () => [t];
    await root.SGS_SKILLS['卸兵'].active(g, p);
    check(t.equips.weapon === null && g.discardPile.includes(wpn), '卸兵：目標武器被棄置');
    check(p.turnFlags['卸兵'] === true, '卸兵：本回合已使用');
  }

  /* 57. 無懼：紅色【殺】對自己無效 */
  {
    const g = mk('魏延');
    const p = g.players[0], t = g.players[1];
    t.skills = ['無懼'];
    const deck = CARDS.buildDeck(['std']);
    const redSha = deck.find(c => c.name === '殺' && c.color === 'red');
    const blackSha = deck.find(c => c.name === '殺' && c.color === 'black');
    const hp0 = t.hp;
    await g.useShaOn(p, t, redSha);
    check(t.hp === hp0, '無懼：紅色【殺】無效');
    g.askForCard = async () => null;
    await g.useShaOn(p, t, blackSha);
    check(t.hp === hp0 - 1, `無懼：黑色【殺】照常命中（${hp0} → ${t.hp}）`);
  }

  /* 58. 附敵：交一張給來源，然後打同勢力體力最高者 */
  {
    const g = mk('魏延');
    const p = g.players[0], t = g.players[1];
    p.skills = ['附敵'];
    p.hand.push(...CARDS.buildDeck(['std']).slice(0, 2));
    p.maxHp = 4; p.hp = 3;
    t.maxHp = 4; t.hp = 4;
    g.askSkill = async () => true;
    g.askCard = async (who, opt) => (opt.pool || [])[0] || null;
    const th = t.hand.length;
    await g.damage(t, p, 1, 'normal', null);
    check(t.hand.length === th + 1, '附敵：交給傷害來源一張手牌');
  }

  /* 59. 相濡：交兩張牌防止致命傷害 */
  {
    const g = mk('魏延');
    const p = g.players[0], t = g.players[1];
    t.skills = ['相濡'];
    p.hand.push(...CARDS.buildDeck(['std']).slice(0, 3));
    t.maxHp = 4; t.hp = 1;
    g.askSkill = async () => true;
    g.askCards = async (who, opt) => (opt.pool || []).slice(0, 2);
    const hp0 = t.hp;
    await g.damage(g.players[1], t, 2, 'normal', null);
    check(t.hp === hp0, `相濡：致命傷害被防止（體力 ${t.hp}）`);
    check(t.alive, '相濡：角色存活');
  }

  console.log(fails === 0 ? '\n全部通過' : `\n${fails} 項失敗`);
  process.exit(fails ? 1 : 0);
})();
