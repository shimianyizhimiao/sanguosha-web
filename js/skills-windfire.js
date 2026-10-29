/* 三國殺 · 風林火山（神話再臨）技能實作
   由 tools/build-packs.py 產生的 js/generals-packs.js 只放「名字＋官方描述」，
   這裡逐隻補上真正會動的效果；同名技能在這檔覆蓋 packs 檔的 todo 佔位。
   載入順序：generals.js → generals-extra.js → generals-packs.js → skills-*.js
*/
(function (root) {
  'use strict';

  const SK = root.SGS_SKILLS;
  const C = root.SGS_CARDS;
  if (!SK || !C) return;

  const SUITS = { '♠': '黑桃', '♥': '紅桃', '♣': '梅花', '♦': '方塊' };
  const isSha = c => !!c && (c.name === '殺' || c.asName === '殺');
  const rank = c => C.RANK ? C.RANK[c.rank] || c.rank : c.rank;
  const equipSlots = ['weapon', 'armor', 'horse+', 'horse-', 'treasure'];
  const equipCount = p => equipSlots.filter(s => p.equips[s]).length;

  /* ── 血裔（袁紹·主公技）──────────────────────────────────────────
     鎖定技：你的手牌上限 +X（X＝其他群勢力角色數×2） */
  SK['血裔'] = {
    type: 'lord',
    desc: '主公技，鎖定技，你的手牌上限+X（X為其他群勢力角色數×2）。',
    limitFor(g, owner, p) {
      if (owner !== p) return 0;
      const n = g.alive().filter(q => q !== p && q.generals.some(x => x.kingdom === '群')).length;
      return n * 2;
    },
  };

  /* ── 據守（曹仁）──────────────────────────────────────────────
     結束階段開始時，你可以摸三張牌，然後將武將牌翻面 */
  SK['據守'] = {
    type: 'trigger',
    desc: '結束階段開始時，你可以摸三張牌，然後將武將牌翻面。',
    events: {
      async turnEnd(g, ctx, p) {
        if (ctx.player !== p) return;
        // AI 手牌已經很多時不要再翻面（否則整局在「摸三張→跳過回合」間打轉）
        const isAI = p.controller && typeof p.controller.decide === 'function';
        if (isAI && p.hand.length >= 5) return;
        const yes = await g.askSkill(p, '據守');
        if (!yes) return;
        g.drawCards(p, 3);
        p.flipped = true;
        g.log(`${g.nameOf(p)} 發動【據守】，摸三張牌並將武將牌翻面`, 'skill');
        g.update();
      },
    },
  };

  /* ── 狂骨（魏延）──────────────────────────────────────────────
     鎖定技：當你對距離 1 以內的角色造成 1 點傷害後，你回复 1 點體力 */
  SK['狂骨'] = {
    type: 'locked',
    desc: '鎖定技，當你對距離1以內的角色造成傷害後，你回复1點體力。',
    events: {
      async damaged(g, ctx, p) {
        if (ctx.source !== p || ctx.target === p) return;
        if (g.seatDistance(p, ctx.target) > 1) return;
        if (p.hp >= p.maxHp) return;
        await g.heal(p, 1, '狂骨');
        g.log(`${g.nameOf(p)} 發動【狂骨】，回复 1 點體力`, 'skill');
      },
    },
  };

  /* ── 破虜（孫堅）──────────────────────────────────────────────
     當你造成 1 點傷害後，你可以摸 X 張牌（X＝傷害值） */
  SK['破虜'] = {
    type: 'trigger',
    desc: '當你造成傷害後，你可以摸X張牌（X為傷害值）。',
    events: {
      async damaged(g, ctx, p) {
        if (ctx.source !== p || ctx.target === p) return;
        const n = ctx.amount || 1;
        const yes = await g.askSkill(p, '破虜');
        if (!yes) return;
        g.drawCards(p, n);
        g.log(`${g.nameOf(p)} 發動【破虜】，摸 ${n} 張牌`, 'skill');
      },
    },
  };

  /* ── 烈弓（黃忠）──────────────────────────────────────────────
     當你使用【殺】指定目標後，若目標手牌數 ≥ 你的體力值 或 ≤ 你的攻擊範圍，
     則此【殺】不可被【閃】響應 */
  SK['烈弓'] = {
    type: 'trigger',
    desc: '當你使用【殺】指定目標後，若目標手牌數不小於你的體力值或不大於你的攻擊範圍，則此【殺】不可被【閃】響應。',
    events: {
      async shaTargeted(g, ctx, p) {
        if (ctx.source !== p || !isSha(ctx.card)) return;
        const t = ctx.target;
        if (!t || !t.alive) return;
        const range = g.attackRange(p);
        const cond = t.hand.length >= Math.max(0, p.hp) || t.hand.length <= range;
        if (!cond) return;
        ctx.noShan = true;
        g.log(`【烈弓】生效：${g.nameOf(t)} 不能使用【閃】`, 'skill');
      },
    },
  };

  /* ── 直諫（張昭＆張紘）────────────────────────────────────────
     出牌階段限一次，你可以將一張裝備牌置入一名角色的裝備區，然後摸一張牌 */
  SK['直諫'] = {
    type: 'active',
    desc: '出牌階段限一次，你可以將一張裝備牌置入一名角色的裝備區，然後摸一張牌。',
    canUse(g, p) {
      if (p.turnFlags && p.turnFlags['直諫']) return false;
      return p.hand.some(c => !!c.slot);
    },
    async active(g, p) {
      if (p.turnFlags && p.turnFlags['直諫']) return;
      const eq = p.hand.filter(c => !!c.slot);
      if (!eq.length) return;
      const c = await g.askCard(p, { prompt: '【直諫】選擇一張裝備牌', pool: eq });
      if (!c) return;
      const t = await g.askTargets(p, {
        prompt: `【直諫】將 ${C.cardText(c)} 置入一名角色的裝備區（可選自己）`,
        min: 1, max: 1, filter: q => q.alive && !(q.deadSlots && q.deadSlots[c.slot]),
      });
      if (!t || !t.length) return;
      const tgt = t[0];
      p.turnFlags['直諫'] = true;
      const i = p.hand.indexOf(c);
      if (i >= 0) p.hand.splice(i, 1);
      tgt.hand.push(c);            // 借 equipCard 的完整流程（替換舊裝備、記錄、通知 UI）
      g.equipCard(tgt, c);
      g.drawCards(p, 1);
      g.log(`${g.nameOf(p)} 發動【直諫】，令 ${g.nameOf(tgt)} 裝備 ${C.cardText(c)} 並摸一張牌`, 'skill');
      g.update();
    },
  };

  /* ── 固政（張昭＆張紘）────────────────────────────────────────
     其他角色的棄牌階段結束時，你可以令其獲得其於此階段棄置的一張牌，
     然後你獲得其餘的牌 */
  SK['固政'] = {
    type: 'trigger',
    desc: '其他角色的棄牌階段結束時，你可以令該角色獲得其於此階段棄置的一張牌，然後你獲得以此法棄置的其餘的牌。',
    events: {
      async discardPhaseEnd(g, ctx, p) {
        if (ctx.player === p) return;
        const cards = (ctx.cards || []).filter(c => !c.virtual);
        if (cards.length < 2) return;
        const yes = await g.askSkill(p, '固政');
        if (!yes) return;
        const one = await g.askCard(p, {
          prompt: `【固政】選擇一張牌交還 ${g.nameOf(ctx.player)}（其餘歸你）`, pool: cards,
        });
        if (!one) return;
        for (const c of cards) {
          const i = g.discardPile.indexOf(c);
          if (i >= 0) g.discardPile.splice(i, 1);
          if (c === one) ctx.player.hand.push(c);
          else p.hand.push(c);
        }
        g.log(`${g.nameOf(p)} 發動【固政】：${g.nameOf(ctx.player)} 獲得 ${C.cardText(one)}，` +
          `${g.nameOf(p)} 獲得其餘 ${cards.length - 1} 張`, 'skill');
        g.update();
      },
    },
  };

  /* ── 英魂（孫堅）──────────────────────────────────────────────
     準備階段，若你已受傷，你可以令一名其他角色摸 X 張牌然後棄一張牌，
     或棄 X 張牌然後摸一張牌（X＝你已損失的體力值） */
  SK['英魂'] = {
    type: 'trigger',
    desc: '準備階段，若你已受傷，你可以令一名其他角色摸X張牌然後棄置一張牌，或棄置X張牌然後摸一張牌（X為你已損失的體力值）。',
    events: {
      async turnStart(g, ctx, p) {
        if (ctx.player !== p) return;
        const lost = p.maxHp - p.hp;
        if (lost <= 0) return;
        const others = g.alive().filter(q => q !== p);
        if (!others.length) return;
        const yes = await g.askSkill(p, '英魂');
        if (!yes) return;
        const t = await g.askTargets(p, {
          prompt: `【英魂】選擇一名其他角色（X＝${lost}）`, min: 1, max: 1, filter: q => q.alive && q !== p,
        });
        if (!t || !t.length) return;
        const tgt = t[0];
        const mode = await g.ask(p, {
          kind: 'choice', cancelable: false,
          prompt: `【英魂】對 ${g.nameOf(tgt)}：`,
          options: [`摸 ${lost} 張再棄一張`, `棄 ${lost} 張再摸一張`],
        });
        if (mode === 0) {
          g.drawCards(tgt, lost);
          if (tgt.hand.length) {
            const cs = await g.askCards(tgt, { min: 1, max: 1, prompt: '【英魂】棄置一張手牌', from: 'hand' });
            if (cs.length) { g.consumeCards(tgt, cs, '英魂'); }
          }
        } else {
          const n = Math.min(lost, tgt.hand.length + equipCount(tgt));
          if (n > 0) {
            const cs = await g.askCards(tgt, { min: n, max: n, prompt: `【英魂】棄置 ${n} 張牌`, from: 'any' });
            if (cs.length) g.consumeCards(tgt, cs, '英魂');
          }
          g.drawCards(tgt, 1);
        }
        g.log(`${g.nameOf(p)} 發動【英魂】作用於 ${g.nameOf(tgt)}（X＝${lost}）`, 'skill');
        g.update();
      },
    },
  };

  /* 標記：這些技能已有真實效果（UI 顯示用） */

  /* ═══════════ 第二批 ═══════════ */

  /* ── 火計 / 看破 / 連環：單張轉化 ───────────────────────────── */
  SK['火計'] = { type: 'convert', desc: '你可以將一張紅色手牌當【火攻】使用。' };
  SK['看破'] = { type: 'convert', desc: '你可以將一張黑色手牌當【無懈可擊】使用。' };
  SK['連環'] = { type: 'convert', desc: '你可以將一張♣手牌當【鐵索連環】使用。' };
  const CV = root.SGS_CONVERT = root.SGS_CONVERT || [];
  CV.push({ skill: '火計', to: '火攻', from: { color: 'red' } });
  CV.push({ skill: '看破', to: '無懈可擊', from: { color: 'black' } });
  CV.push({ skill: '連環', to: '鐵索連環', from: { suit: '♣' } });

  /* ── 亂擊（袁紹）──────────────────────────────────────────────
     出牌階段，你可以將兩張相同花色的手牌當【萬箭齊發】使用 */
  SK['亂擊'] = {
    type: 'active',
    desc: '出牌階段，你可以將兩張相同花色的手牌當【萬箭齊發】使用。',
    canUse(g, p) {
      const seen = new Set();
      for (const c of p.hand) { if (seen.has(c.suit)) return true; seen.add(c.suit); }
      return g.alive().filter(q => q !== p).length > 0 && p.hand.length >= 2;
    },
    async active(g, p) {
      const bySuit = {};
      for (const c of p.hand) (bySuit[c.suit] = bySuit[c.suit] || []).push(c);
      const pair = Object.values(bySuit).find(list => list.length >= 2);
      if (!pair) return;
      const cards = await g.askCards(p, {
        min: 2, max: 2, pool: p.hand.filter(c => c.suit === pair[0].suit),
        prompt: '【亂擊】選擇兩張相同花色的手牌當【萬箭齊發】',
      });
      if (!cards || cards.length < 2) return;
      for (const c of cards) { const i = p.hand.indexOf(c); if (i >= 0) p.hand.splice(i, 1); }
      g.toDiscard(cards);
      const vc = {
        id: 'v亂擊' + Date.now(), name: '萬箭齊發', type: 'trick', virtual: true,
        subcards: [], suit: cards[0].suit, rank: cards[0].rank, skill: '亂擊',
      };
      g.log(`${g.nameOf(p)} 發動【亂擊】，將兩張${SUITS[cards[0].suit] || ''}牌當【萬箭齊發】使用`, 'skill');
      await g.playCard(p, vc, null, '萬箭齊發', '亂擊');
      g.update();
    },
  };

  /* ── 涅槃 / 不屈：引擎在瀕死時呼叫（見 engine.trySaveSkills）────── */
  SK['涅槃'] = {
    type: 'limited',
    desc: '限定技，當你處於瀕死狀態時，你可以棄置你所有的牌，然後將你的體力回复至3點，摸三張牌。',
  };

  SK['不屈'] = {
    type: 'locked',
    desc: '鎖定技，當你處於瀕死狀態時，你將牌堆頂的一張牌置於你的武將牌上（稱為「不屈牌」）。若你的「不屈牌」點數各不相同，你回復至1點體力。',
  };

  const DONE2 = ['火計', '看破', '連環', '亂擊', '涅槃', '不屈'];
  for (const n of DONE2) if (SK[n]) { delete SK[n].todo; SK[n].impl = true; }
  root.SGS_SKILLS_DONE = (root.SGS_SKILLS_DONE || []).concat(DONE2);


  /* ═══════════ 第三批 ═══════════ */

  /* ── 八陣（諸葛亮）：鎖定技，無防具時視為裝備【八卦陣】 */
  SK['八陣'] = {
    type: 'locked',
    desc: '鎖定技，若你的裝備區裡沒有防具牌，你視為裝備著【八卦陣】。',
  };

  /* ── 滅殺：鎖定技，對體力值為 1 的角色傷害 +1（引擎 damage 內處理） */
  SK['滅殺'] = {
    type: 'locked',
    desc: '鎖定技，你對體力值為1的其他角色造成的傷害+1。',
  };

  /* ── 禍首：南蠻入侵對你無效，且傷害來源改為你 ───────────────── */
  SK['禍首'] = {
    type: 'locked',
    desc: '鎖定技，【南蠻入侵】對你無效；其他角色使用【南蠻入侵】指定目標後，你代替其成為此牌造成傷害的來源。',
    cannotBeTargeted(g, p, src, cardName) {
      return cardName === '南蠻入侵';
    },
  };

  /* ── 謙節：不能被橫置、不能成為延時錦囊目標 ───────────────── */
  SK['謙節'] = {
    type: 'locked',
    desc: '鎖定技，你不能被橫置，且不能成為延時類錦囊牌或其他角色拼點的目標。',
    cannotBeTargeted(g, p, src, cardName) {
      return cardName === '樂不思蜀' || cardName === '兵糧寸斷' || cardName === '閃電';
    },
  };

  /* ── 父蔭：每回合第一次成為【殺】的目標，手牌≤對方則此牌無效 ── */
  SK['父蔭'] = {
    type: 'locked',
    desc: '鎖定技，你每回合第一次成為【殺】或【決鬥】的目標後，若你的手牌數不大於該角色，此牌對你無效。',
    events: {
      async shaTargeted(g, ctx, p) {
        if (ctx.target !== p || ctx.source === p) return;
        if (p.turnFlags && p.turnFlags.fuyin) return;
        if (p.hand.length > ctx.source.hand.length) return;
        p.turnFlags.fuyin = true;
        ctx.noEffect = true;
        ctx.effectSkill = '父蔭';
      },
    },
  };

  /* ── 奮激：每名角色結束階段，若其沒有手牌，可令其摸兩張、你失去 1 點體力 ── */
  SK['奮激'] = {
    type: 'trigger',
    desc: '每名角色的結束階段，若其沒有手牌，你可以令其摸兩張牌，然後你失去1點體力。',
    events: {
      async turnEnd(g, ctx, p) {
        const q = ctx.player;
        if (!q || !q.alive || q.hand.length !== 0) return;
        if (!p.alive || p.hp <= 1) return;
        const ai = p.controller;
        if (q !== p && ai && typeof ai.isFriend === 'function' && !ai.isFriend(g, p, q)) return;
        const yes = await g.askSkill(p, '奮激', `【奮激】${g.nameOf(q)} 沒有手牌，是否令其摸兩張？（你失去 1 點體力）`);
        if (!yes) return;
        g.drawCards(q, 2);
        await g.loseHp(p, 1, '奮激');
        g.log(`${g.nameOf(p)} 發動【奮激】：${g.nameOf(q)} 摸兩張牌`, 'skill');
      },
    },
  };

  /* ── 奇謀：限定技，失去任意點體力 → 距離-X、可多使用 X 張【殺】 ── */
  SK['奇謀'] = {
    type: 'limited',
    desc: '限定技，出牌階段，你可以失去任意點體力，然後本回合你計算與其他角色的距離-X，且你可以多使用X張【殺】（X為你失去的體力值）。',
    canUse(g, p) {
      return !p.usedQimou && p.hp > 1 && p.phase === 'play';
    },
    async active(g, p) {
      if (p.usedQimou) return;
      const maxX = Math.max(0, p.hp - 1);
      if (maxX <= 0) return;
      const choices = [];
      for (let i = 1; i <= Math.min(maxX, 3); i++) choices.push(`失去 ${i} 點體力`);
      const idx = await g.ask(p, { kind: 'choice', prompt: '【奇謀】失去幾點體力？', options: choices, cancelable: true });
      if (idx === null || idx === undefined) return;
      const x = idx + 1;
      p.usedQimou = true;
      p.turnFlags.distX = (p.turnFlags.distX || 0) + x;
      p.turnFlags.extraSha = (p.turnFlags.extraSha || 0) + x;
      await g.loseHp(p, x, '奇謀');
      g.log(`${g.nameOf(p)} 發動【奇謀】：失去 ${x} 點體力，本回合距離 -${x}、可多使用 ${x} 張【殺】`, 'skill');
      g.update();
    },
  };

  /* ── 懷柔：出牌階段，你可以重鑄裝備牌 ─────────────────────── */
  SK['懷柔'] = {
    type: 'active',
    desc: '出牌階段，你可以重鑄一張裝備牌（棄置之，然後摸一張牌）。',
    canUse(g, p) { return p.hand.some(c => !!c.slot); },
    async active(g, p) {
      const eq = p.hand.filter(c => !!c.slot);
      if (!eq.length) return;
      const c = await g.askCard(p, { prompt: '【懷柔】選擇要重鑄的裝備牌', pool: eq });
      if (!c) return;
      const i = p.hand.indexOf(c);
      if (i >= 0) p.hand.splice(i, 1);
      g.toDiscard([c]);
      g.drawCards(p, 1);
      g.log(`${g.nameOf(p)} 發動【懷柔】重鑄 ${C.cardText(c)}，摸一張牌`, 'skill');
      g.update();
    },
  };

  const DONE3 = ['八陣', '滅殺', '禍首', '謙節', '父蔭', '奮激', '奇謀', '懷柔'];
  for (const n of DONE3) if (SK[n]) { delete SK[n].todo; SK[n].impl = true; }
  root.SGS_SKILLS_DONE = (root.SGS_SKILLS_DONE || []).concat(DONE3);

  const DONE = ['血裔', '據守', '狂骨', '破虜', '烈弓', '直諫', '固政', '英魂'];
  for (const n of DONE) if (SK[n]) { delete SK[n].todo; SK[n].impl = true; }
  root.SGS_SKILLS_DONE = (root.SGS_SKILLS_DONE || []).concat(DONE);
})(typeof window !== 'undefined' ? window : globalThis);
