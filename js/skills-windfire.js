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


  /* ═══════════ 第四批 ═══════════ */

  /* ── 決堰：廢除一種裝備欄，換取對應效果 ───────────────────── */
  const SLOT_TXT = { weapon: '武器', armor: '防具', 'horse+': '坐騎', 'horse-': '坐騎', treasure: '寶物' };
  SK['決堰'] = {
    type: 'active',
    desc: '出牌階段限一次，你可以廢除你裝備區裡的一種裝備欄，然後執行對應的一項：武器欄，本回合使用【殺】的限制次數+3；防具欄，摸三張牌，本回合手牌上限+3；坐騎欄，本回合你使用牌無距離限制；寶物欄，本回合獲得「集智」。',
    canUse(g, p) {
      if (p.turnFlags && p.turnFlags['決堰']) return false;
      return ['weapon', 'armor', 'horse+', 'horse-', 'treasure'].some(s => !(p.deadSlots && p.deadSlots[s]));
    },
    async active(g, p) {
      if (p.turnFlags['決堰']) return;
      const kinds = [];
      for (const s of ['weapon', 'armor', 'horse+', 'treasure']) {
        if (!(p.deadSlots && p.deadSlots[s]) && !kinds.some(k => k.slot === s)) kinds.push({ slot: s, label: SLOT_TXT[s] + '欄' });
      }
      if (!kinds.length) return;
      const idx = await g.ask(p, {
        kind: 'choice', prompt: '【決堰】廢除哪一個裝備欄？',
        options: kinds.map(k => `廢除${k.label}`), cancelable: true,
      });
      if (idx === null || idx === undefined) return;
      const slot = kinds[idx].slot;
      p.turnFlags['決堰'] = true;
      g.abolishSlot(p, slot);
      if (slot === 'weapon') {
        p.turnFlags.extraSha = (p.turnFlags.extraSha || 0) + 3;
        g.log(`${g.nameOf(p)} 發動【決堰】：本回合可多使用 3 張【殺】`, 'skill');
      } else if (slot === 'armor') {
        g.drawCards(p, 3);
        p.turnFlags.handLimitX = (p.turnFlags.handLimitX || 0) + 3;
        g.log(`${g.nameOf(p)} 發動【決堰】：摸三張牌，本回合手牌上限 +3`, 'skill');
      } else if (slot === 'horse+') {
        p.turnFlags.noDistance = true;
        g.log(`${g.nameOf(p)} 發動【決堰】：本回合使用牌無距離限制`, 'skill');
      } else {
        if (!p.skills.includes('集智（標）')) p.skills.push('集智（標）');
        p.granted = p.granted || [];
        p.granted.push({ name: '集智（標）', untilTurn: p.turnCount });
        g.log(`${g.nameOf(p)} 發動【決堰】：本回合獲得「集智」`, 'skill');
      }
      g.update();
    },
  };

  /* ── 破勢：覺醒技 ─────────────────────────────────────────── */
  SK['破勢'] = {
    type: 'awaken',
    desc: '覺醒技，準備階段，若你所有裝備欄均被廢除或體力值為1，則你減1點體力上限，然後將手牌摸至體力上限，失去「決堰」，獲得「懷柔」。',
    events: {
      async turnStart(g, ctx, p) {
        if (ctx.player !== p || p.awakened) return;
        const slots = ['weapon', 'armor', 'horse+', 'horse-', 'treasure'];
        const allDead = slots.every(s => p.deadSlots && p.deadSlots[s]);
        if (!allDead && p.hp > 1) return;
        p.awakened = true;
        g.loseMaxHp(p, 1);
        const want = Math.max(0, p.maxHp - p.hand.length);
        if (want > 0) g.drawCards(p, want);
        const i = p.skills.indexOf('決堰');
        if (i >= 0) p.skills.splice(i, 1);
        if (!p.skills.includes('懷柔')) p.skills.push('懷柔');
        g.log(`${g.nameOf(p)} 覺醒【破勢】：失去 1 點體力上限、摸至 ${p.maxHp} 張，獲得【懷柔】`, 'skill');
        g.update();
      },
    },
  };

  /* ── 蹈刃：交一張手牌，然後對雙方攻擊範圍交集內的人各造成 1 點傷害 ── */
  SK['蹈刃'] = {
    type: 'active',
    desc: '出牌階段限一次，你可以將一張手牌交給一名角色，然後你對你與其攻擊範圍內均包含的所有角色各造成1點傷害。',
    canUse(g, p) {
      return !(p.turnFlags && p.turnFlags['蹈刃']) && p.hand.length > 0;
    },
    async active(g, p) {
      if (p.turnFlags['蹈刃']) return;
      const c = await g.askCard(p, { prompt: '【蹈刃】選擇一張手牌交給目標', pool: p.hand.slice() });
      if (!c) return;
      const t = await g.askTargets(p, { prompt: '【蹈刃】選擇一名角色', min: 1, max: 1 });
      if (!t || !t.length) return;
      const tgt = t[0];
      p.turnFlags['蹈刃'] = true;
      const i = p.hand.indexOf(c);
      if (i >= 0) p.hand.splice(i, 1);
      tgt.hand.push(c);
      g.log(`${g.nameOf(p)} 發動【蹈刃】，將一張手牌交給 ${g.nameOf(tgt)}`, 'skill');
      const victims = g.alive().filter(q =>
        g.inAttackRange(p, q) && g.inAttackRange(tgt, q));
      for (const q of victims) await g.damage(p, q, 1, 'normal', null);
      if (!victims.length) g.log('【蹈刃】攻擊範圍內沒有交集角色', 'info');
      g.update();
    },
  };

  /* ── 飛軍＋兵略 ─────────────────────────────────────────────── */
  SK['飛軍'] = {
    type: 'active',
    desc: '出牌階段限一次，你可以棄置一張牌，然後：令一名手牌數大於你的角色交給你一張牌；或令一名裝備區裡牌數大於你的角色棄置一張裝備牌。',
    canUse(g, p) {
      return !(p.turnFlags && p.turnFlags['飛軍']) && (p.hand.length + equipCount(p)) > 0;
    },
    async active(g, p) {
      if (p.turnFlags['飛軍']) return;
      const pool = [...p.hand, ...equipSlots.map(s => p.equips[s]).filter(Boolean)];
      const c = await g.askCard(p, { prompt: '【飛軍】棄置一張牌', pool });
      if (!c) return;
      const t = await g.askTargets(p, {
        prompt: '【飛軍】選擇一名角色',
        min: 1, max: 1,
        filter: q => q.alive && q !== p && (q.hand.length > p.hand.length || equipCount(q) > equipCount(p)),
      });
      if (!t || !t.length) return;
      const tgt = t[0];
      p.turnFlags['飛軍'] = true;
      p.feiJunTargets = p.feiJunTargets || [];
      const fresh = !p.feiJunTargets.includes(tgt.id);
      p.feiJunTargets.push(tgt.id);
      if (c.slot && p.equips[c.slot] === c) { p.equips[c.slot] = null; g.onEquipChange && g.onEquipChange(p); g.toDiscard([c]); }
      else g.consumeCards(p, [c], '飛軍');
      if (tgt.hand.length > p.hand.length) {
        const give = tgt.hand[Math.floor(Math.random() * tgt.hand.length)];
        const i2 = tgt.hand.indexOf(give);
        if (i2 >= 0) tgt.hand.splice(i2, 1);
        p.hand.push(give);
        g.log(`${g.nameOf(p)} 發動【飛軍】令 ${g.nameOf(tgt)} 交給他一張牌`, 'skill');
      } else if (equipCount(tgt) > equipCount(p)) {
        const eqs = equipSlots.map(s => tgt.equips[s]).filter(Boolean);
        if (eqs.length) {
          const eq = eqs[0];
          tgt.equips[eq.slot] = null;
          g.onEquipChange && g.onEquipChange(tgt);
          g.toDiscard([eq]);
          g.log(`${g.nameOf(p)} 發動【飛軍】令 ${g.nameOf(tgt)} 棄置裝備 ${C.cardText(eq)}`, 'skill');
        }
      }
      if (fresh && p.skills.includes('兵略')) {
        g.drawCards(p, 2);
        g.log(`【兵略】目標與之前不同，${g.nameOf(p)} 摸兩張牌`, 'skill');
      }
      g.update();
    },
  };

  SK['兵略'] = {
    type: 'locked',
    desc: '鎖定技，當你發動「飛軍」時，若目標與你之前指定的目標均不相同，則你摸兩張牌。',
  };

  /* ── 集智（標準版）：使用錦囊時亮牌堆頂 ───────────────────── */
  SK['集智（標）'] = {
    type: 'trigger',
    desc: '當你使用一張錦囊牌時，你可以展示牌堆頂牌，若該牌為基本牌，將之置入棄牌堆或使用一張手牌與之交換；若不為基本牌，則將之收入手牌。',
    events: {
      async cardUsed(g, ctx, p) {
        if (ctx.player !== p) return;
        const cd = ctx.card;
        if (!cd || cd.type !== 'trick') return;
        const yes = await g.askSkill(p, '集智（標）');
        if (!yes) return;
        const top = g.peekDeck(1)[0];
        if (!top) return;
        g.log(`【集智】亮出牌堆頂：${C.cardText(top)}`, 'skill');
        if (top.type === 'basic') {
          const ch = await g.ask(p, {
            kind: 'choice', prompt: `【集智】牌堆頂是基本牌 ${C.cardText(top)}`,
            options: ['置入棄牌堆', '與一張手牌交換'], cancelable: true,
          });
          if (ch === 1 && p.hand.length) {
            const own = await g.askCard(p, { prompt: '【集智】選擇要放到牌堆頂的手牌', pool: p.hand.slice() });
            if (own) {
              const i = p.hand.indexOf(own);
              if (i >= 0) p.hand.splice(i, 1);
              p.hand.push(top);
              g.putOnDeckTop([own]);
            }
          } else if (ch === 0) {
            g.toDiscard(g.drawFromDeck(1));
          }
        } else {
          const got = g.drawFromDeck(1);
          if (got.length) p.hand.push(got[0]);
        }
        g.update();
      },
    },
  };

  /* ── 集智（界限突破）：使用普通錦囊摸一張 ─────────────────── */
  SK['集智（界）'] = {
    type: 'trigger',
    desc: '當你使用普通錦囊牌時，你可以摸一張牌。若此牌是基本牌，你可以棄置此牌令本回合手牌上限+1。',
    events: {
      async cardUsed(g, ctx, p) {
        if (ctx.player !== p) return;
        const cd = ctx.card;
        if (!cd || cd.type !== 'trick' || cd.delay) return;
        const yes = await g.askSkill(p, '集智（界）');
        if (!yes) return;
        const got = g.drawCards(p, 1);
        const c0 = got[0];
        if (c0 && c0.type === 'basic') {
          const ch = await g.ask(p, {
            kind: 'choice', prompt: `【集智】摸到基本牌 ${C.cardText(c0)}，是否棄置以令本回合手牌上限 +1？`,
            options: ['棄置並 +1', '保留'], cancelable: true,
          });
          if (ch === 0 && p.hand.includes(c0)) {
            g.consumeCards(p, [c0], '集智');
            p.turnFlags.handLimitX = (p.turnFlags.handLimitX || 0) + 1;
            g.log(`${g.nameOf(p)} 【集智】棄置 ${C.cardText(c0)}，本回合手牌上限 +1`, 'skill');
          }
        }
      },
    },
  };

  /* ── 明任：開局摸一張並存一張為「任」，結束階段可替換 ───────── */
  SK['明任'] = {
    type: 'trigger',
    desc: '遊戲開始時，你摸一張牌，然後將你的一張手牌置於你的武將牌上，稱為「任」。結束階段，你可以用手牌替換「任」。',
    events: {
      async gameStart(g, ctx, p) {
        g.drawCards(p, 1);
        if (!p.hand.length) return;
        const c = await g.askCard(p, { prompt: '【明任】選擇一張手牌置於武將牌上（稱為「任」）', pool: p.hand.slice() });
        if (!c) return;
        const i = p.hand.indexOf(c);
        if (i >= 0) p.hand.splice(i, 1);
        p.ren = c;
        g.log(`${g.nameOf(p)} 【明任】：將 ${C.cardText(c)} 置於武將牌上`, 'skill');
      },
      async turnEnd(g, ctx, p) {
        if (ctx.player !== p || !p.ren) return;
        const yes = await g.askSkill(p, '明任', '【明任】是否用手牌替換「任」？');
        if (!yes || !p.hand.length) return;
        const c = await g.askCard(p, { prompt: '【明任】選擇一張手牌替換「任」', pool: p.hand.slice() });
        if (!c) return;
        const i = p.hand.indexOf(c);
        if (i >= 0) p.hand.splice(i, 1);
        const old = p.ren;
        p.ren = c;
        p.hand.push(old);
        g.log(`${g.nameOf(p)} 【明任】：以 ${C.cardText(c)} 替換「任」，取回 ${C.cardText(old)}`, 'skill');
      },
    },
  };

  /* ── 再起：棄牌階段結束，令至多 X 名角色選擇摸牌或讓你回復 ───── */
  SK['再起'] = {
    type: 'trigger',
    desc: '棄牌階段結束時，你可以令至多X名角色各選擇一項（X為本回合內放入棄牌堆的紅色牌數量）：1.摸一張牌；2.令你回復1點體力。',
    events: {
      async discardPhaseEnd(g, ctx, p) {
        const x = Math.min(g.turnRedCount || 0, g.alive().length);
        if (x <= 0) return;
        const yes = await g.askSkill(p, '再起', `【再起】令至多 ${x} 名角色選擇摸一張或讓你回復 1 點體力？`);
        if (!yes) return;
        const list = [];
        for (let k = 0; k < x; k++) {
          const t = await g.askTargets(p, { prompt: `【再起】選擇第 ${k + 1} 名角色（可跳過）`, min: 1, max: 1, cancelable: true });
          if (!t || !t.length) break;
          list.push(t[0]);
        }
        for (const q of list) {
          const ch = await g.ask(q, {
            kind: 'choice', prompt: '【再起】選擇一項', options: ['摸一張牌', `令 ${g.nameOf(p)} 回復 1 點體力`], cancelable: false,
          });
          if (ch === 0) g.drawCards(q, 1);
          else await g.heal(p, 1, '再起');
        }
        if (list.length) g.log(`${g.nameOf(p)} 發動【再起】（X＝${x}）`, 'skill');
        g.update();
      },
    },
  };

  const DONE4 = ['決堰', '破勢', '蹈刃', '飛軍', '兵略', '集智（標）', '集智（界）', '明任', '再起'];
  for (const n of DONE4) if (SK[n]) { delete SK[n].todo; SK[n].impl = true; }
  root.SGS_SKILLS_DONE = (root.SGS_SKILLS_DONE || []).concat(DONE4);


  /* ═══════════ 第五批 ═══════════ */

  const isRedCard = c => c && (c.color === 'red' || c.suit === '♥' || c.suit === '♦');

  /* ── 神速（夏侯淵）：跳階段換【殺】 ───────────────────────── */
  SK['神速'] = {
    type: 'trigger',
    desc: '你可以選擇一項或多項：1.跳過判定階段和摸牌階段，視為對一名角色使用一張【殺】；2.跳過出牌階段並棄置一張裝備牌，視為對一名角色使用一張【殺】。',
    events: {
      async phaseStart(g, ctx, p) {
        if (ctx.player !== p) return;
        const sha = { id: 'v神速' + Date.now(), name: '殺', type: 'basic', virtual: true, subcards: [], suit: '♠', rank: 7, skill: '神速' };

        // ① 跳過判定＋摸牌階段
        if (ctx.phase === 'judge' && !p.turnFlags.shenSu1) {
          const yes = await g.askSkill(p, '神速', '【神速】跳過判定階段和摸牌階段，視為使用一張【殺】？');
          if (!yes) return;
          const t = await g.askTargets(p, {
            prompt: '【神速】選擇【殺】的目標', min: 1, max: 1,
            candidates: g.others(p).filter(q => g.shaReachable(p, q)),
          });
          if (!t || !t.length) return;
          p.turnFlags.shenSu1 = true;
          p.turnFlags.skipJudgeDraw = true;
          g.log(`${g.nameOf(p)} 發動【神速】，跳過判定與摸牌階段`, 'skill');
          await g.useShaOn(p, t[0], sha);
        }

        // ② 跳過出牌階段並棄一張裝備牌
        if (ctx.phase === 'play' && !p.turnFlags.shenSu2) {
          const eqs = [...p.hand.filter(c => !!c.slot), ...equipSlots.map(sl => p.equips[sl]).filter(Boolean)];
          if (!eqs.length) return;
          const yes = await g.askSkill(p, '神速', '【神速】跳過出牌階段並棄置一張裝備牌，視為使用一張【殺】？');
          if (!yes) return;
          const c = await g.askCard(p, { prompt: '【神速】棄置一張裝備牌', pool: eqs });
          if (!c) return;
          const t = await g.askTargets(p, {
            prompt: '【神速】選擇【殺】的目標', min: 1, max: 1,
            candidates: g.others(p).filter(q => g.shaReachable(p, q)),
          });
          if (!t || !t.length) return;
          p.turnFlags.shenSu2 = true;
          p.turnFlags.skipPlay = true;
          if (c.slot && p.equips[c.slot] === c) { p.equips[c.slot] = null; g.onEquipChange && g.onEquipChange(p); g.toDiscard([c]); }
          else g.consumeCards(p, [c], '神速');
          g.log(`${g.nameOf(p)} 發動【神速】，跳過出牌階段`, 'skill');
          await g.useShaOn(p, t[0], sha);
        }
      },
    },
  };

  /* ── 天香（小喬）：棄 ♥ 手牌把傷害轉給別人 ─────────────────── */
  SK['天香'] = {
    type: 'trigger',
    desc: '當你受到傷害時，你可以棄置一張紅桃手牌，防止此傷害並選擇一名其他角色：該角色受到1點傷害，然後摸X張牌（X為其已損失的體力值）。',
    events: {
      async beforeDamaged(g, ctx, p) {
        if (ctx.target !== p || ctx.canceled) return;
        const hearts = p.hand.filter(c => c.suit === '♥');
        if (!hearts.length) return;
        const others = g.alive().filter(q => q !== p);
        if (!others.length) return;
        const yes = await g.askSkill(p, '天香', '【天香】棄置一張紅桃手牌，將此傷害轉移給其他角色？');
        if (!yes) return;
        const c = await g.askCard(p, { prompt: '【天香】棄置一張紅桃手牌', pool: hearts });
        if (!c) return;
        const t = await g.askTargets(p, { prompt: '【天香】選擇承受傷害的角色', min: 1, max: 1, filter: q => q.alive && q !== p });
        if (!t || !t.length) return;
        const tgt = t[0];
        g.consumeCards(p, [c], '天香');
        ctx.canceled = true;
        g.log(`${g.nameOf(p)} 發動【天香】，將傷害轉移給 ${g.nameOf(tgt)}`, 'skill');
        await g.damage(null, tgt, 1, 'normal', null);
        const lost = Math.max(0, tgt.maxHp - tgt.hp);
        if (lost > 0) g.drawCards(tgt, lost);
      },
    },
  };

  /* ── 鬼道（張角）：黑色牌改判 ─────────────────────────────── */
  SK['鬼道'] = {
    type: 'trigger',
    desc: '在一名角色的判定牌生效前，你可以打出一張黑色牌代替之。',
    events: {
      async judge(g, ctx, p) {
        const blacks = p.hand.filter(c => !isRedCard(c));
        if (!blacks.length) return;
        if (ctx.player === p && ctx.reason === '鬼道') return;
        const yes = await g.askSkill(p, '鬼道', `【鬼道】是否用一張黑色牌代替 ${g.nameOf(ctx.player)} 的判定牌？`);
        if (!yes) return;
        const c = await g.askCard(p, { prompt: '【鬼道】選擇一張黑色牌', pool: blacks });
        if (!c) return;
        const i = p.hand.indexOf(c);
        if (i >= 0) p.hand.splice(i, 1);
        ctx.replaced = true;
        ctx.old = ctx.card;
        ctx.card = c;
        g.log(`${g.nameOf(p)} 發動【鬼道】，改判為 ${C.cardText(c)}`, 'skill');
      },
    },
  };

  /* ── 雷擊（張角）：閃避【殺】後判定，黑色則造成 2 點雷電傷害 ── */
  SK['雷擊'] = {
    type: 'trigger',
    desc: '當你使用或打出一張【閃】時，你可以令一名角色進行判定：若結果為黑色，你對其造成2點雷電傷害。',
    events: {
      async shaDodged(g, ctx, p) {
        if (ctx.target !== p) return;
        const yes = await g.askSkill(p, '雷擊');
        if (!yes) return;
        const t = await g.askTargets(p, { prompt: '【雷擊】選擇一名角色進行判定', min: 1, max: 1, filter: q => q.alive });
        if (!t || !t.length) return;
        const tgt = t[0];
        const jc = await g.judge(tgt, '雷擊');
        if (!jc) return;
        if (isRedCard(jc)) { g.log('【雷擊】判定為紅色，無效果'); return; }
        g.log(`${g.nameOf(p)} 發動【雷擊】，對 ${g.nameOf(tgt)} 造成 2 點雷電傷害`, 'skill');
        await g.damage(p, tgt, 2, 'thunder', null);
      },
    },
  };

  /* ── 激昂（孫策）：使用或成為【殺】／【決鬥】的目標摸一張 ───── */
  SK['激昂'] = {
    type: 'trigger',
    desc: '當你使用【決鬥】或【殺】指定目標後，或當你成為【決鬥】或【殺】的目標後，你可以摸一張牌。',
    events: {
      async shaTargeted(g, ctx, p) {
        if (ctx.source !== p && ctx.target !== p) return;
        if (p.turnFlags && p.turnFlags['激昂'] >= 2) return;
        const yes = await g.askSkill(p, '激昂');
        if (!yes) return;
        p.turnFlags['激昂'] = (p.turnFlags['激昂'] || 0) + 1;
        g.drawCards(p, 1);
        g.log(`${g.nameOf(p)} 發動【激昂】，摸一張牌`, 'skill');
      },
      async cardUsed(g, ctx, p) {
        if (ctx.player !== p || ctx.name !== '決鬥') return;
        if (ctx.targets && ctx.targets.every(t => t !== p)) {
          const yes = await g.askSkill(p, '激昂');
          if (!yes) return;
          g.drawCards(p, 1);
          g.log(`${g.nameOf(p)} 發動【激昂】（決鬥），摸一張牌`, 'skill');
        }
      },
    },
  };

  /* ── 魂姿（孫策）：覺醒，體力 1 時獲得英姿與英魂 ──────────── */
  SK['魂姿'] = {
    type: 'awaken',
    desc: '覺醒技，準備階段，若你的體力值為1，你減1點體力上限，然後獲得技能「英姿」和「英魂」。',
    events: {
      async turnStart(g, ctx, p) {
        if (ctx.player !== p || p.awakenedHz) return;
        if (p.hp !== 1) return;
        p.awakenedHz = true;
        g.loseMaxHp(p, 1);
        for (const n of ['英姿', '英魂']) if (!p.skills.includes(n)) p.skills.push(n);
        g.log(`${g.nameOf(p)} 覺醒【魂姿】：失去 1 點體力上限，獲得【英姿】【英魂】`, 'skill');
        g.update();
      },
    },
  };

  /* ── 恪守：受傷害時棄兩張同色牌使傷害 -1 ─────────────────── */
  SK['恪守'] = {
    type: 'trigger',
    desc: '當你受到傷害時，你可以棄置兩張顏色相同的牌，然後此傷害-1。若沒有與你勢力相同的其他角色，則你進行一次判定，若結果為紅色，你摸一張牌。',
    events: {
      async beforeDamaged(g, ctx, p) {
        if (ctx.target !== p || ctx.canceled) return;
        const pool = [...p.hand, ...equipSlots.map(sl => p.equips[sl]).filter(Boolean)];
        const red = pool.filter(c => isRedCard(c));
        const black = pool.filter(c => !isRedCard(c));
        const group = red.length >= 2 ? red : (black.length >= 2 ? black : null);
        if (group) {
          const yes = await g.askSkill(p, '恪守', '【恪守】棄置兩張同色牌，令此傷害 -1？');
          if (yes) {
            const cs = await g.askCards(p, { min: 2, max: 2, pool: group, prompt: '【恪守】棄置兩張同色牌' });
            if (cs && cs.length === 2) {
              // 裝備牌要先從裝備區摘下來再進棄牌堆，否則 removeCardFromPlayer 找不到、牌會憑空消失
              const eqCards = cs.filter(c => c.slot && p.equips[c.slot] === c);
              for (const c of eqCards) { p.equips[c.slot] = null; g.toDiscard([c]); }
              if (eqCards.length) g.onEquipChange && g.onEquipChange(p);
              const handCards = cs.filter(c => p.hand.includes(c));
              if (handCards.length) g.consumeCards(p, handCards, '恪守');
              ctx.amount = Math.max(0, ctx.amount - 1);
              if (ctx.amount === 0) ctx.canceled = true;
              g.log(`${g.nameOf(p)} 發動【恪守】，此傷害 -1`, 'skill');
            }
          }
        }
        const same = g.alive().some(q => q !== p && q.generals.some(x => p.generals.some(y => x.kingdom === y.kingdom)));
        if (!same) {
          const jc = await g.judge(p, '恪守');
          if (jc && isRedCard(jc)) { g.drawCards(p, 1); g.log('【恪守】判定為紅色，摸一張牌', 'skill'); }
        }
      },
    },
  };

  /* ── 築圍：判定牌為【殺】／【決鬥】時獲得，並強化本回合 ────── */
  SK['築圍'] = {
    type: 'trigger',
    desc: '你的判定牌生效後，若此牌為【殺】或【決鬥】，你可以獲得之，然後你可以令當前回合角色本回合使用【殺】的次數上限+1，手牌上限+1。',
    events: {
      async judge(g, ctx, p) {
        if (ctx.player !== p) return;
        const nm = ctx.card && ctx.card.name;
        if (nm !== '殺' && nm !== '決鬥') return;
        const yes = await g.askSkill(p, '築圍', `【築圍】判定牌是${C.cardText(ctx.card)}，是否獲得之？`);
        if (!yes) return;
        ctx.gain = p;
        g.log(`${g.nameOf(p)} 發動【築圍】，獲得判定牌 ${C.cardText(ctx.card)}`, 'skill');
        const cur = g.current || p;
        cur.turnFlags.extraSha = (cur.turnFlags.extraSha || 0) + 1;
        cur.turnFlags.handLimitX = (cur.turnFlags.handLimitX || 0) + 1;
      },
    },
  };

  const DONE5 = ['神速', '天香', '鬼道', '雷擊', '激昂', '魂姿', '恪守', '築圍'];
  for (const n of DONE5) if (SK[n]) { delete SK[n].todo; SK[n].impl = true; }
  root.SGS_SKILLS_DONE = (root.SGS_SKILLS_DONE || []).concat(DONE5);


  /* ═══════════ 第六批 ═══════════ */

  /* ── 強襲（太史慈→此版為群）：失體力或棄武器，對範圍內角色 1 傷害 ── */
  SK['強襲'] = {
    type: 'active',
    desc: '出牌階段對每名角色各限一次，你可以失去1點體力或棄置一張武器牌，然後對攻擊範圍內的一名其他角色造成1點傷害。',
    canUse(g, p) {
      const canHp = p.hp > 1;
      const canWpn = p.hand.some(c => c.name === '武器' || c.slot === 'weapon') || !!p.equips.weapon;
      return (canHp || canWpn) && g.others(p).some(q => g.inAttackRange(p, q));
    },
    async active(g, p) {
      const targets = g.others(p).filter(q => g.inAttackRange(p, q));
      if (!targets.length) return;
      const options = [];
      if (p.hp > 1) options.push('失去 1 點體力');
      if (p.equips.weapon || p.hand.some(c => c.slot === 'weapon')) options.push('棄置一張武器牌');
      if (!options.length) return;
      const ch = await g.ask(p, { kind: 'choice', prompt: '【強襲】選擇代價', options, cancelable: true });
      if (ch === null || ch === undefined) return;
      if (ch === 0 && p.hp > 1) {
        await g.loseHp(p, 1, '強襲');
      } else {
        const wpns = [...p.hand.filter(c => c.slot === 'weapon'), p.equips.weapon].filter(Boolean);
        if (!wpns.length) return;
        const c = wpns[0];
        if (p.equips.weapon === c) { p.equips.weapon = null; g.onEquipChange && g.onEquipChange(p); g.toDiscard([c]); }
        else g.consumeCards(p, [c], '強襲');
      }
      const t = await g.askTargets(p, { prompt: '【強襲】選擇一名攻擊範圍內的角色', min: 1, max: 1, filter: q => q.alive && q !== p && g.inAttackRange(p, q) });
      if (!t || !t.length) return;
      g.log(`${g.nameOf(p)} 發動【強襲】`, 'skill');
      await g.damage(p, t[0], 1, 'normal', null);
    },
  };

  /* ── 好施：摸牌階段多摸兩張，手牌過多則分一半給最少的人 ─────── */
  SK['好施'] = {
    type: 'trigger',
    desc: '摸牌階段，你可以多摸兩張牌，然後若你的手牌數大於5，則你將一半的手牌（向下取整）交給手牌最少的一名其他角色。',
    events: {
      async phaseStart(g, ctx, p) {
        if (ctx.player !== p || ctx.phase !== 'draw') return;
        const yes = await g.askSkill(p, '好施', '【好施】摸牌階段多摸兩張牌？');
        if (!yes) return;
        g.drawCards(p, 2);
        if (p.hand.length <= 5) return;
        const others = g.alive().filter(q => q !== p);
        if (!others.length) return;
        const least = Math.min(...others.map(q => q.hand.length));
        const cands = others.filter(q => q.hand.length === least);
        const t = await g.askTargets(p, { prompt: '【好施】選擇一名手牌最少的角色', min: 1, max: 1, candidates: cands });
        const tgt = (t && t[0]) || cands[0];
        const n = Math.floor(p.hand.length / 2);
        const give = p.hand.slice(0, n);
        for (const c of give) { const i = p.hand.indexOf(c); if (i >= 0) p.hand.splice(i, 1); }
        tgt.hand.push(...give);
        g.log(`${g.nameOf(p)} 發動【好施】，交給 ${g.nameOf(tgt)} ${n} 張手牌`, 'skill');
      },
    },
  };

  /* ── 挑釁：逼目標對你出【殺】，否則棄他一張牌 ─────────────── */
  SK['挑釁'] = {
    type: 'active',
    desc: '出牌階段限一次，你可以選擇一名其他角色，然後除非該角色對你使用一張【殺】，否則你棄置其一張牌。',
    canUse(g, p) { return !(p.turnFlags && p.turnFlags['挑釁']) && g.others(p).length > 0; },
    async active(g, p) {
      if (p.turnFlags['挑釁']) return;
      const t = await g.askTargets(p, { prompt: '【挑釁】選擇一名其他角色', min: 1, max: 1 });
      if (!t || !t.length) return;
      const tgt = t[0];
      p.turnFlags['挑釁'] = true;
      // 不要從新牌堆借牌物件：那會讓同一張牌 id 在場上出現兩次（卡牌守恒報重複）
      const sha = { id: 'v挑釁' + Date.now(), name: '殺', type: 'basic', virtual: true, subcards: [], suit: '♠', rank: 7, skill: '挑釁' };
      const r = await g.askForCard(tgt, '殺', {
        prompt: `${g.nameOf(p)} 對你發動【挑釁】，是否使用一張【殺】？`, cancelable: true,
      });
      if (r && r.cards) {
        g.consumeCards(tgt, r.cards, '殺');
        g.log(`${g.nameOf(tgt)} 對 ${g.nameOf(p)} 使用【殺】（【挑釁】）`, 'skill');
        await g.useShaOn(tgt, p, sha);
      } else {
        const pool = [...tgt.hand, ...equipSlots.map(sl => tgt.equips[sl]).filter(Boolean)];
        if (!pool.length) return;
        const c = pool[Math.floor(Math.random() * pool.length)];
        if (c.slot && tgt.equips[c.slot] === c) { tgt.equips[c.slot] = null; g.onEquipChange && g.onEquipChange(tgt); g.toDiscard([c]); }
        else g.consumeCards(tgt, [c], '挑釁');
        g.log(`${g.nameOf(p)} 發動【挑釁】，棄置 ${g.nameOf(tgt)} 的一張牌`, 'skill');
      }
      g.update();
    },
  };

  /* ── 觀星（標／界）：沿用既有觀星實作 ─────────────────────── */
  const GUANXING = SK['觀星'];
  if (GUANXING) {
    SK['觀星（標）'] = Object.assign({}, GUANXING, {
      desc: '準備階段，你可以觀看牌堆頂的X張牌（X為全場角色數且最多為5），然後以任意順序分配於牌堆頂或牌堆底。',
    });
    SK['觀星（界）'] = Object.assign({}, GUANXING, {
      desc: '準備階段，你可以觀看牌堆頂的五張牌（若存活人數小於4則改為三張），然後將其中任意張牌置於牌堆頂，其餘置於牌堆底。',
    });
  }

  /* ── 英姿（標／界）─────────────────────────────────────────── */
  const YINGZI = SK['英姿'];
  if (YINGZI) {
    SK['英姿（標）'] = Object.assign({}, YINGZI, { desc: '摸牌階段，你可以多摸一張牌。' });
    SK['英姿（界）'] = {
      type: 'passive',
      desc: '鎖定技，摸牌階段，你多摸一張牌；你的手牌上限等於你的體力上限。',
      drawCount(g, p, n) { return n + 1; },
      limitFor(g, owner, p) {
        if (owner !== p) return 0;
        return Math.max(0, p.maxHp - p.hp);
      },
    };
  }

  /* ── 奇制：用牌指定目標後，棄非目標的一張牌並讓其摸一張 ───── */
  SK['奇制'] = {
    type: 'trigger',
    desc: '當你於回合內使用基本牌或錦囊牌指定目標後，你可以棄置不是此牌目標的一名角色的一張牌，然後其摸一張牌。',
    events: {
      async cardUsed(g, ctx, p) {
        if (ctx.player !== p) return;
        const cd = ctx.card;
        if (!cd || (cd.type !== 'basic' && cd.type !== 'trick')) return;
        const targets = ctx.targets || [];
        const pool = g.alive().filter(q => q !== p && !targets.includes(q) &&
          (q.hand.length + equipSlots.filter(sl => q.equips[sl]).length) > 0);
        if (!pool.length) return;
        const yes = await g.askSkill(p, '奇制');
        if (!yes) return;
        const t = await g.askTargets(p, { prompt: '【奇制】選擇一名非目標角色', min: 1, max: 1, candidates: pool });
        if (!t || !t.length) return;
        const tgt = t[0];
        const all = [...tgt.hand, ...equipSlots.map(sl => tgt.equips[sl]).filter(Boolean)];
        if (!all.length) return;
        const c = all[Math.floor(Math.random() * all.length)];
        if (c.slot && tgt.equips[c.slot] === c) { tgt.equips[c.slot] = null; g.onEquipChange && g.onEquipChange(tgt); g.toDiscard([c]); }
        else g.consumeCards(tgt, [c], '奇制');
        g.drawCards(tgt, 1);
        p.turnFlags.qizhi = (p.turnFlags.qizhi || 0) + 1;
        g.log(`${g.nameOf(p)} 發動【奇制】，棄置 ${g.nameOf(tgt)} 一張牌後其摸一張`, 'skill');
      },
    },
  };

  /* ── 進趨：結束階段摸兩張，棄至 X 張（X＝本回合奇制次數）──── */
  SK['進趨'] = {
    type: 'trigger',
    desc: '結束階段，你可以摸兩張牌，然後將手牌棄置至X張（X為你於此回合內發動過「奇制」的次數）。',
    events: {
      async turnEnd(g, ctx, p) {
        if (ctx.player !== p) return;
        const yes = await g.askSkill(p, '進趨');
        if (!yes) return;
        g.drawCards(p, 2);
        const x = p.turnFlags.qizhi || 0;
        const over = p.hand.length - x;
        if (over > 0) {
          const cs = await g.askCards(p, { min: over, max: over, from: 'hand', prompt: `【進趨】棄置 ${over} 張手牌（保留 ${x} 張）` });
          if (cs && cs.length) g.consumeCards(p, cs, '進趨');
        }
        g.log(`${g.nameOf(p)} 發動【進趨】：摸兩張，手牌整理至 ${x} 張`, 'skill');
      },
    },
  };

  /* ── 潰誅：依棄牌階段棄牌數，摸牌或造成傷害 ───────────────── */
  SK['潰誅'] = {
    type: 'trigger',
    desc: '棄牌階段結束後，你可以選擇一項：1.令至多X名角色各摸一張牌；2.對任意名體力值之和為X的角色造成1點傷害，若多於一名角色，你受到1點傷害（X為你此階段棄置的牌數）。',
    events: {
      async discardPhaseEnd(g, ctx, p) {
        if (ctx.player !== p) return;
        const x = ctx.count || 0;
        if (x <= 0) return;
        const yes = await g.askSkill(p, '潰誅', `【潰誅】X＝${x}，是否發動？`);
        if (!yes) return;
        const mode = await g.ask(p, {
          kind: 'choice', cancelable: true, prompt: '【潰誅】選擇一項',
          options: [`令至多 ${x} 名角色各摸一張牌`, `對體力值之和為 ${x} 的角色造成 1 點傷害`],
        });
        if (mode === null || mode === undefined) return;
        if (mode === 0) {
          for (let k = 0; k < x; k++) {
            const t = await g.askTargets(p, { prompt: `【潰誅】第 ${k + 1} 名角色（可跳過）`, min: 1, max: 1, cancelable: true });
            if (!t || !t.length) break;
            g.drawCards(t[0], 1);
          }
        } else {
          const t = await g.askTargets(p, {
            prompt: `【潰誅】選擇體力值之和不超過 ${x} 的角色`, min: 1, max: Math.min(x, 4),
            filter: q => q.alive,
          });
          if (!t || !t.length) return;
          let sum = 0;
          const picked = [];
          for (const q of t) { if (sum + q.hp > x) break; sum += q.hp; picked.push(q); }
          for (const q of picked) await g.damage(p, q, 1, 'normal', null);
          if (picked.length > 1) await g.damage(null, p, 1, 'normal', null);
        }
        g.log(`${g.nameOf(p)} 發動【潰誅】（X＝${x}）`, 'skill');
        g.update();
      },
    },
  };

  const DONE6 = ['強襲', '好施', '挑釁', '觀星（標）', '觀星（界）', '英姿（標）', '英姿（界）', '奇制', '進趨', '潰誅'];
  for (const n of DONE6) if (SK[n]) { delete SK[n].todo; SK[n].impl = true; }
  root.SGS_SKILLS_DONE = (root.SGS_SKILLS_DONE || []).concat(DONE6);


  /* ═══════════ 第七批 ═══════════ */

  /* ── 紅顏：♠ 視為 ♥（判定入口統一走 engine.suitOf）─────────── */
  SK['紅顏'] = {
    type: 'locked',
    desc: '鎖定技，你的♠牌視為♥牌。',
  };

  /* ── 巨象：南蠻無效，且他人使用的南蠻結算後由你獲得 ────────── */
  SK['巨象'] = {
    type: 'locked',
    desc: '鎖定技，【南蠻入侵】對你無效；其他角色使用的【南蠻入侵】結算結束後，你獲得之。',
    cannotBeTargeted(g, p, src, cardName) { return cardName === '南蠻入侵'; },
  };

  /* ── 烈刃：使用【殺】指定目標後拼點，贏則拿一張牌，沒贏則交換 ── */
  SK['烈刃'] = {
    type: 'trigger',
    desc: '當你使用【殺】指定目標後，你可以與目標角色拼點，若你：贏，你獲得其一張牌；沒贏，你與其交換拼點的牌。',
    events: {
      async shaTargeted(g, ctx, p) {
        if (ctx.source !== p || !isSha(ctx.card)) return;
        const t = ctx.target;
        if (!t || !t.alive) return;
        if (!p.hand.length || !t.hand.length) return;
        const yes = await g.askSkill(p, '烈刃', `【烈刃】是否與 ${g.nameOf(t)} 拼點？`);
        if (!yes) return;
        const r = await g.pindian(p, t, '烈刃');
        if (!r) return;
        if (r.win) {
          const pool = [...t.hand, ...equipSlots.map(sl => t.equips[sl]).filter(Boolean)];
          if (!pool.length) return;
          const c = pool[Math.floor(Math.random() * pool.length)];
          if (c.slot && t.equips[c.slot] === c) { t.equips[c.slot] = null; g.onEquipChange && g.onEquipChange(t); }
          else { const i = t.hand.indexOf(c); if (i >= 0) t.hand.splice(i, 1); }
          p.hand.push(c);
          g.log(`【烈刃】${g.nameOf(p)} 拼點獲勝，獲得 ${g.nameOf(t)} 一張牌`, 'skill');
        } else {
          // 沒贏：交換拼點的兩張牌（把它們從棄牌堆拿回來對調）
          const ci = g.discardPile.indexOf(r.cp), cj = g.discardPile.indexOf(r.cq);
          if (ci >= 0) g.discardPile.splice(ci, 1);
          if (cj >= 0) g.discardPile.splice(cj, 1);
          t.hand.push(r.cp);
          p.hand.push(r.cq);
          g.log(`【烈刃】沒贏，${g.nameOf(p)} 與 ${g.nameOf(t)} 交換拼點的牌`, 'skill');
        }
      },
    },
  };

  /* ── 天義：拼點，贏則本回合加成，沒贏則不能使用【殺】────────── */
  SK['天義'] = {
    type: 'active',
    desc: '出牌階段限一次，你可以與一名角色拼點：若你贏，本回合你可以多使用一張【殺】，使用【殺】無距離限制且可以多選擇一個目標；若你沒贏，本回合你不能使用【殺】。',
    canUse(g, p) {
      return !(p.turnFlags && p.turnFlags['天義']) && p.hand.length > 0 && g.others(p).length > 0;
    },
    async active(g, p) {
      if (p.turnFlags['天義']) return;
      const t = await g.askTargets(p, { prompt: '【天義】選擇一名角色拼點', min: 1, max: 1, filter: q => q.alive && q.hand.length > 0 });
      if (!t || !t.length) return;
      const tgt = t[0];
      p.turnFlags['天義'] = true;
      const r = await g.pindian(p, tgt, '天義');
      if (!r) return;
      if (r.win) {
        p.turnFlags.extraSha = (p.turnFlags.extraSha || 0) + 1;
        p.turnFlags.shaNoRange = true;
        p.turnFlags.shaExtraTarget = (p.turnFlags.shaExtraTarget || 0) + 1;
        g.log(`【天義】拼點獲勝：本回合多一張【殺】、無距離限制、可多選一個目標`, 'skill');
      } else {
        p.turnFlags.noSha = true;
        g.log('【天義】沒贏：本回合不能使用【殺】', 'skill');
      }
      g.update();
    },
  };

  /* ── 志繼：覺醒技，沒有手牌時回复／摸牌，減上限並獲得觀星 ───── */
  SK['志繼'] = {
    type: 'awaken',
    desc: '覺醒技，準備階段，若你沒有手牌，你回復1點體力或摸兩張牌，減1點體力上限，然後獲得「觀星」。',
    events: {
      async turnStart(g, ctx, p) {
        if (ctx.player !== p || p.awakenedZj) return;
        if (p.hand.length > 0) return;
        const ch = await g.ask(p, {
          kind: 'choice', prompt: '【志繼】選擇一項', options: ['回復 1 點體力', '摸兩張牌'], cancelable: true,
        });
        if (ch === null || ch === undefined) return;
        p.awakenedZj = true;
        if (ch === 0) await g.heal(p, 1, '志繼');
        else g.drawCards(p, 2);
        g.loseMaxHp(p, 1);
        if (!p.skills.includes('觀星')) p.skills.push('觀星');
        g.log(`${g.nameOf(p)} 覺醒【志繼】：獲得【觀星】`, 'skill');
        g.update();
      },
    },
  };

  /* ── 從諫：成為多目標錦囊的目標時，交一張牌給另一目標並摸牌 ── */
  SK['從諫'] = {
    type: 'trigger',
    desc: '當你成為目標數大於1的錦囊牌目標時，你可以交給其中一名目標角色一張牌，然後摸一張牌。若你給出的牌是裝備牌，改為摸兩張牌。',
    events: {
      async trickTargets(g, ctx, p) {
        if (!ctx.targets || ctx.targets.length < 2) return;
        if (!ctx.targets.includes(p) || !p.hand.length) return;
        if (ctx._congjian) return;
        const others = ctx.targets.filter(q => q !== p && q.alive);
        if (!others.length) return;
        const yes = await g.askSkill(p, '從諫');
        if (!yes) return;
        ctx._congjian = true;
        const c = await g.askCard(p, { prompt: '【從諫】交給其中一名目標一張牌', pool: p.hand.slice() });
        if (!c) return;
        const t = await g.askTargets(p, { prompt: '【從諫】選擇交給哪個目標', min: 1, max: 1, candidates: others });
        const tgt = (t && t[0]) || others[0];
        const i = p.hand.indexOf(c);
        if (i >= 0) p.hand.splice(i, 1);
        tgt.hand.push(c);
        g.drawCards(p, c.slot ? 2 : 1);
        g.log(`${g.nameOf(p)} 發動【從諫】，交給 ${g.nameOf(tgt)} ${C.cardText(c)}`, 'skill');
      },
    },
  };

  /* ── 雄亂：限定技，廢除判定區與裝備區換取強攻 ─────────────── */
  SK['雄亂'] = {
    type: 'limited',
    desc: '限定技，出牌階段，你可以廢除你的判定區和裝備區，然後指定一名其他角色，本回合你對其使用牌無距離和次數限制，其不能使用或打出手牌。',
    canUse(g, p) { return !p.usedXiongluan && g.others(p).length > 0; },
    async active(g, p) {
      if (p.usedXiongluan) return;
      const t = await g.askTargets(p, { prompt: '【雄亂】選擇一名其他角色', min: 1, max: 1 });
      if (!t || !t.length) return;
      const tgt = t[0];
      p.usedXiongluan = true;
      for (const sl of ['weapon', 'armor', 'horse+', 'horse-', 'treasure']) {
        if (!(p.deadSlots && p.deadSlots[sl])) g.abolishSlot(p, sl);
      }
      p.turnFlags.shaNoRange = true;
      p.turnFlags.noShaLimit = true;
      tgt.silentHand = p.turnCount;      // 本回合不能使用或打出手牌（由下面 hook 判定）
      g.log(`${g.nameOf(p)} 發動【雄亂】：廢除判定區與裝備區，${g.nameOf(tgt)} 本回合不能使用手牌`, 'skill');
      g.update();
    },
  };

  /* ── 鎮骨：把手牌數綁給另一名角色 ─────────────────────────── */
  SK['鎮骨'] = {
    type: 'trigger',
    desc: '結束階段，你可以選擇一名其他角色，你的回合結束時和該角色的下個回合結束時，其將手牌摸至或棄至與你手牌數相同（最多摸至五張）。',
    events: {
      async turnEnd(g, ctx, p) {
        if (ctx.player !== p) return;
        const yes = await g.askSkill(p, '鎮骨');
        if (!yes) return;
        const t = await g.askTargets(p, { prompt: '【鎮骨】選擇一名其他角色', min: 1, max: 1 });
        if (!t || !t.length) return;
        const tgt = t[0];
        p.zhengu = tgt.id;
        const sync = () => {
          const want = Math.min(5, p.hand.length);
          if (tgt.hand.length < want) g.drawCards(tgt, want - tgt.hand.length);
          else if (tgt.hand.length > want) {
            const over = tgt.hand.length - want;
            const cs = tgt.hand.slice(0, over);
            g.consumeCards(tgt, cs, '鎮骨');
          }
          g.log(`【鎮骨】${g.nameOf(tgt)} 的手牌調整為 ${want} 張`, 'skill');
        };
        sync();
        g.log(`${g.nameOf(p)} 發動【鎮骨】，目標 ${g.nameOf(tgt)}`, 'skill');
      },
    },
  };

  const DONE7 = ['紅顏', '巨象', '烈刃', '天義', '志繼', '從諫', '雄亂', '鎮骨'];
  for (const n of DONE7) if (SK[n]) { delete SK[n].todo; SK[n].impl = true; }
  root.SGS_SKILLS_DONE = (root.SGS_SKILLS_DONE || []).concat(DONE7);

  const DONE = ['血裔', '據守', '狂骨', '破虜', '烈弓', '直諫', '固政', '英魂'];
  for (const n of DONE) if (SK[n]) { delete SK[n].todo; SK[n].impl = true; }
  root.SGS_SKILLS_DONE = (root.SGS_SKILLS_DONE || []).concat(DONE);
})(typeof window !== 'undefined' ? window : globalThis);
