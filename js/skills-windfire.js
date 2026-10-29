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
  const DONE = ['血裔', '據守', '狂骨', '破虜', '烈弓', '直諫', '固政', '英魂'];
  for (const n of DONE) if (SK[n]) { delete SK[n].todo; SK[n].impl = true; }
  root.SGS_SKILLS_DONE = (root.SGS_SKILLS_DONE || []).concat(DONE);
})(typeof window !== 'undefined' ? window : globalThis);
