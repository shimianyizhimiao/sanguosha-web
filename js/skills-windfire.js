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
          // 沒贏：交換拼點的兩張牌（只搬真的進了棄牌堆的那些，避免同一張牌出現兩次）
          const move = (card, to) => {
            const di = g.discardPile.indexOf(card);
            if (di < 0) return;                 // 還在原本手牌裡，不動
            g.discardPile.splice(di, 1);
            to.hand.push(card);
          };
          move(r.cp, t);
          move(r.cq, p);
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


  /* ═══════════ 第八批 ═══════════ */

  /* ── 纏怨：體力 1 時其他技能失效（引擎 isSilenced 已處理）──────── */
  SK['纏怨'] = {
    type: 'locked',
    desc: '鎖定技，你不能質疑「蠱惑」；若你的體力值為1，則你的其他技能失效。',
  };

  /* ── 千幻：同勢力受傷時存牌；同勢力成為目標時可棄牌取消 ───── */
  SK['千幻'] = {
    type: 'trigger',
    desc: '當與你勢力相同的一名角色受到傷害後，你可以將一張牌置於你的武將牌上（不能與武將牌上已有的牌花色相同）。當一名與你勢力相同的角色成為基本牌或錦囊牌的唯一目標時，你可以將你武將牌上的一張牌放入棄牌堆，然後取消之。',
    events: {
      async damaged(g, ctx, p) {
        const t = ctx.target;
        if (!t || t === p) return;
        const same = p.generals.some(a => t.generals.some(b => a.kingdom === b.kingdom));
        if (!same) return;
        p.qianhuan = p.qianhuan || [];
        const used = p.qianhuan.map(c => c.suit);
        const pool = [...p.hand, ...equipSlots.map(sl => p.equips[sl]).filter(Boolean)].filter(c => !used.includes(c.suit));
        if (!pool.length) return;
        const yes = await g.askSkill(p, '千幻');
        if (!yes) return;
        const c = await g.askCard(p, { prompt: '【千幻】將一張牌置於武將牌上', pool });
        if (!c) return;
        if (c.slot && p.equips[c.slot] === c) { p.equips[c.slot] = null; g.onEquipChange && g.onEquipChange(p); }
        else { const i = p.hand.indexOf(c); if (i >= 0) p.hand.splice(i, 1); }
        p.qianhuan.push(c);
        g.log(`${g.nameOf(p)} 發動【千幻】，將 ${C.cardText(c)} 置於武將牌上`, 'skill');
      },
      async shaTargeted(g, ctx, p) {
        const t = ctx.target;
        if (!t || t === p) return;
        if (!p.qianhuan || !p.qianhuan.length) return;
        const same = p.generals.some(a => t.generals.some(b => a.kingdom === b.kingdom));
        if (!same) return;
        const yes = await g.askSkill(p, '千幻', `【千幻】取消對 ${g.nameOf(t)} 的這張牌？`);
        if (!yes) return;
        const c = p.qianhuan.pop();
        g.toDiscard([c]);
        ctx.noEffect = true;
        ctx.effectSkill = '千幻';
        g.log(`${g.nameOf(p)} 發動【千幻】，棄置 ${C.cardText(c)} 取消此牌`, 'skill');
      },
      async trickTargets(g, ctx, p) {
        if (!ctx.targets || ctx.targets.length !== 1) return;
        const t = ctx.targets[0];
        if (!t || t === p) return;
        if (!p.qianhuan || !p.qianhuan.length) return;
        const same = p.generals.some(a => t.generals.some(b => a.kingdom === b.kingdom));
        if (!same) return;
        const yes = await g.askSkill(p, '千幻', `【千幻】取消【${ctx.name}】對 ${g.nameOf(t)} 的效果？`);
        if (!yes) return;
        const c = p.qianhuan.pop();
        g.toDiscard([c]);
        ctx.negate.push(t);
        g.log(`${g.nameOf(p)} 發動【千幻】，棄置 ${C.cardText(c)} 取消【${ctx.name}】`, 'skill');
      },
    },
  };

  /* ── 止啼：範圍內已受傷的敵方手牌上限 -1 ──────────────────── */
  SK['止啼'] = {
    type: 'locked',
    desc: '鎖定技，你攻擊範圍內已受傷的角色手牌上限-1；當你與這些角色【決鬥】或拼點贏時，或你受到來源為這些角色的傷害後，你恢復一個裝備欄。',
    limitFor(g, owner, p) {
      if (owner === p) return 0;
      if (p.hp >= p.maxHp) return 0;
      if (!g.inAttackRange(owner, p)) return 0;
      const ai = owner.controller;
      if (ai && typeof ai.isFriend === 'function' && ai.isFriend(g, owner, p)) return 0;
      return -1;
    },
    events: {
      async damaged(g, ctx, p) {
        if (ctx.target !== p || !ctx.source) return;
        if (!g.inAttackRange(p, ctx.source)) return;
        const slots = ['weapon', 'armor', 'horse+', 'horse-', 'treasure'].filter(s => p.deadSlots && p.deadSlots[s]);
        if (!slots.length) return;
        g.restoreSlot(p, slots[0]);
        g.log(`${g.nameOf(p)} 因【止啼】恢復一個裝備欄`, 'skill');
      },
    },
  };

  /* ── 薦降：成為他人用牌的目標後，令手牌最少者摸一張 ─────────── */
  SK['薦降'] = {
    type: 'trigger',
    desc: '當你成為其他角色使用牌的目標後，你可以令手牌數最少的一名角色摸一張牌。',
    events: {
      async shaTargeted(g, ctx, p) {
        if (ctx.target !== p || ctx.source === p) return;
        if (p.turnFlags && p.turnFlags['薦降']) return;
        const yes = await g.askSkill(p, '薦降');
        if (!yes) return;
        p.turnFlags['薦降'] = true;
        const alive = g.alive();
        const least = Math.min(...alive.map(q => q.hand.length));
        const cands = alive.filter(q => q.hand.length === least);
        const t = await g.askTargets(p, { prompt: '【薦降】令手牌最少的一名角色摸一張牌', min: 1, max: 1, candidates: cands });
        const tgt = (t && t[0]) || cands[0];
        g.drawCards(tgt, 1);
        g.log(`${g.nameOf(p)} 發動【薦降】，${g.nameOf(tgt)} 摸一張牌`, 'skill');
      },
      async trickTargets(g, ctx, p) {
        if (!ctx.targets || !ctx.targets.includes(p)) return;
        if (ctx.player === p) return;
        if (p.turnFlags && p.turnFlags['薦降']) return;
        const yes = await g.askSkill(p, '薦降');
        if (!yes) return;
        p.turnFlags['薦降'] = true;
        const alive = g.alive();
        const least = Math.min(...alive.map(q => q.hand.length));
        const cands = alive.filter(q => q.hand.length === least);
        const t = await g.askTargets(p, { prompt: '【薦降】令手牌最少的一名角色摸一張牌', min: 1, max: 1, candidates: cands });
        const tgt = (t && t[0]) || cands[0];
        g.drawCards(tgt, 1);
        g.log(`${g.nameOf(p)} 發動【薦降】，${g.nameOf(tgt)} 摸一張牌`, 'skill');
      },
    },
  };

  /* ── 卸兵：棄一名距離內角色的裝備 ─────────────────────────── */
  SK['卸兵'] = {
    type: 'active',
    desc: '出牌階段限一次，你可以選擇一名距離＜4＞以內的敵方角色，棄置其裝備區裡的一張牌。',
    canUse(g, p) {
      if (p.turnFlags && p.turnFlags['卸兵']) return false;
      return g.others(p).some(q => g.distance(p, q) <= 3 && equipSlots.some(sl => q.equips[sl]));
    },
    async active(g, p) {
      if (p.turnFlags['卸兵']) return;
      const t = await g.askTargets(p, {
        prompt: '【卸兵】選擇一名角色', min: 1, max: 1,
        filter: q => q.alive && q !== p && g.distance(p, q) <= 3 && equipSlots.some(sl => q.equips[sl]),
      });
      if (!t || !t.length) return;
      const tgt = t[0];
      const eqs = equipSlots.map(sl => tgt.equips[sl]).filter(Boolean);
      if (!eqs.length) return;
      p.turnFlags['卸兵'] = true;
      const c = eqs[Math.floor(Math.random() * eqs.length)];
      tgt.equips[c.slot] = null;
      g.onEquipChange && g.onEquipChange(tgt);
      g.toDiscard([c]);
      g.log(`${g.nameOf(p)} 發動【卸兵】，棄置 ${g.nameOf(tgt)} 的 ${C.cardText(c)}`, 'skill');
      g.update();
    },
  };

  /* ── 無懼：紅色【殺】對自己無效（引擎 useShaOn 已處理）────────── */
  SK['無懼'] = {
    type: 'locked',
    desc: '鎖定技，紅色【殺】對你無效。',
  };

  /* ── 附敵：受傷後交牌給來源，然後打同勢力體力最高者 ─────────── */
  SK['附敵'] = {
    type: 'trigger',
    desc: '當你受到傷害後，你可以交給傷害來源一張手牌，然後你對與其勢力相同的角色中體力值最多且不少於你的一名角色造成1點傷害。',
    events: {
      async damaged(g, ctx, p) {
        if (ctx.target !== p || !ctx.source || !ctx.source.alive) return;
        if (!p.hand.length) return;
        const yes = await g.askSkill(p, '附敵');
        if (!yes) return;
        const c = await g.askCard(p, { prompt: '【附敵】交給傷害來源一張手牌', pool: p.hand.slice() });
        if (!c) return;
        const i = p.hand.indexOf(c);
        if (i >= 0) p.hand.splice(i, 1);
        ctx.source.hand.push(c);
        const src = ctx.source;
        const cands = g.alive().filter(q => q !== p && q.hp >= p.hp &&
          q.generals.some(a => src.generals.some(b => a.kingdom === b.kingdom)));
        if (!cands.length) return;
        const top = cands.reduce((a, b) => (b.hp > a.hp ? b : a));
        g.log(`${g.nameOf(p)} 發動【附敵】，對 ${g.nameOf(top)} 造成 1 點傷害`, 'skill');
        await g.damage(p, top, 1, 'normal', null);
      },
    },
  };

  /* ── 相濡：交給來源兩張牌防止致命傷害 ─────────────────────── */
  SK['相濡'] = {
    type: 'trigger',
    desc: '當一名已受傷的其他角色或你受到致命傷害時，你可以交給傷害來源兩張牌防止此傷害。',
    events: {
      async beforeDamaged(g, ctx, p) {
        if (ctx.canceled) return;
        const t = ctx.target;
        if (!t || !t.alive) return;
        const wouldKill = t.hp - ctx.amount <= 0;
        if (!wouldKill) return;
        const me = p;
        if (me.hand.length + equipCount(me) < 2) return;
        const injured = me.hp < me.maxHp || t.hp < t.maxHp;
        if (!injured) return;
        const yes = await g.askSkill(p, '相濡', `【相濡】交出兩張牌防止對 ${g.nameOf(t)} 的致命傷害？`);
        if (!yes) return;
        const pool = [...p.hand, ...equipSlots.map(sl => p.equips[sl]).filter(Boolean)];
        const cs = await g.askCards(p, { min: 2, max: 2, pool, prompt: '【相濡】交給傷害來源兩張牌' });
        if (!cs || cs.length < 2) return;
        const eqCards = cs.filter(c => c.slot && p.equips[c.slot] === c);
        for (const c of eqCards) { p.equips[c.slot] = null; g.toDiscard([c]); }
        if (eqCards.length) g.onEquipChange && g.onEquipChange(p);
        const handCards = cs.filter(c => p.hand.includes(c));
        if (handCards.length) g.consumeCards(p, handCards, '相濡');
        ctx.canceled = true;
        g.log(`${g.nameOf(p)} 發動【相濡】，防止對 ${g.nameOf(t)} 的致命傷害`, 'skill');
      },
    },
  };

  const DONE8 = ['纏怨', '千幻', '止啼', '薦降', '卸兵', '無懼', '附敵', '相濡'];
  for (const n of DONE8) if (SK[n]) { delete SK[n].todo; SK[n].impl = true; }
  root.SGS_SKILLS_DONE = (root.SGS_SKILLS_DONE || []).concat(DONE8);


  /* ═══════════ 第九批 ═══════════ */

  /* ── 簡繁同名技能：直接沿用實作 ─────────────────────────── */
  if (SK['奇謀']) SK['奇谋'] = SK['奇謀'];
  if (SK['紅顏']) SK['紅顔'] = SK['紅顏'];

  /* ── 悲歌：受【殺】傷害後棄一張牌判定，按花色處置 ──────────── */
  SK['悲歌'] = {
    type: 'trigger',
    desc: '當一名角色受到【殺】造成的傷害後，你可以棄置一張牌，然後令其進行判定，若結果為：♥，其回復X點體力（X為其本次受到傷害值）；♦，其摸三張牌；♣，傷害來源棄置兩張牌；♠，傷害來源翻面。',
    events: {
      async damaged(g, ctx, p) {
        if (!ctx.card || !isSha(ctx.card)) return;
        const tgt = ctx.target;
        if (!tgt || !tgt.alive) return;
        const pool = [...p.hand, ...equipSlots.map(sl => p.equips[sl]).filter(Boolean)];
        if (!pool.length) return;
        const yes = await g.askSkill(p, '悲歌', `【悲歌】棄一張牌，令 ${g.nameOf(tgt)} 判定？`);
        if (!yes) return;
        const c = await g.askCard(p, { prompt: '【悲歌】棄置一張牌', pool });
        if (!c) return;
        if (c.slot && p.equips[c.slot] === c) { p.equips[c.slot] = null; g.onEquipChange && g.onEquipChange(p); g.toDiscard([c]); }
        else g.consumeCards(p, [c], '悲歌');
        const jc = await g.judge(tgt, '悲歌');
        if (!jc) return;
        const suit = g.suitOf(tgt, jc);
        if (suit === '♥') {
          await g.heal(tgt, ctx.amount || 1, '悲歌');
        } else if (suit === '♦') {
          g.drawCards(tgt, 3);
        } else if (suit === '♣') {
          if (ctx.source && ctx.source.alive) {
            const src = ctx.source;
            const cs = src.hand.slice(0, 2);
            if (cs.length) g.consumeCards(src, cs, '悲歌');
          }
        } else if (suit === '♠') {
          if (ctx.source && ctx.source.alive) { ctx.source.flipped = !ctx.source.flipped; g.log(`${g.nameOf(ctx.source)} 翻面`, 'skill'); }
        }
        g.log(`【悲歌】${g.nameOf(p)} 令 ${g.nameOf(tgt)} 判定：${C.cardText(jc)}`, 'skill');
      },
    },
  };

  /* ── 斷腸：死亡時，殺死你的角色失去所有武將技能 ────────────── */
  SK['斷腸'] = {
    type: 'locked',
    desc: '鎖定技，當你死亡時，殺死你的角色失去所有武將技能。',
    events: {
      async onDeath(g, ctx, p) {
        if (ctx.player !== p) return;
        const src = ctx.source;
        if (!src) return;
        src.skills = [];
        g.log(`【斷腸】${g.nameOf(src)} 失去所有武將技能`, 'skill');
        g.update();
      },
    },
  };

  /* ── 蠻裔：【南蠻入侵】對自己無效；登場時視為使用一張 ───────── */
  SK['蠻裔'] = {
    type: 'locked',
    desc: '你登場時，你可視為對對手使用一張【南蠻入侵】；【南蠻入侵】對你無效。',
    cannotBeTargeted(g, p, src, cardName) { return cardName === '南蠻入侵'; },
    events: {
      async turnStart(g, ctx, p) {
        if (ctx.player !== p || p.usedManyi) return;
        if (!(p.turnFlags && p.turnFlags.turnNo === 1)) {
          // 用「第一次自己的回合」近似「登場」
          if (p.turnCount > 1) { p.usedManyi = true; return; }
        }
        p.usedManyi = true;
        const foes = g.alive().filter(q => q !== p);
        if (!foes.length) return;
        const card = { id: 'v蠻裔' + Date.now(), name: '南蠻入侵', type: 'trick', virtual: true, subcards: [], suit: '♠', rank: 7, skill: '蠻裔' };
        g.log(`${g.nameOf(p)} 發動【蠻裔】，視為使用【南蠻入侵】`, 'skill');
        await g.useTrick(p, card, card.name, foes);
      },
    },
  };

  /* ── 儒宗：本回合只指定過同一名角色，可把手牌摸到與其相同 ───── */
  SK['儒宗'] = {
    type: 'trigger',
    desc: '回合結束時，若你本回合使用牌指定過的目標角色均為同一名，你可以將手牌數摸至與其相同（至多摸五張），若該目標為你，你可以改為令任意名其他角色將手牌數摸至與你相同。',
    events: {
      // 記錄本回合指定過的目標
      cardUsed(g, ctx, p) { if (ctx.player === p) trackTarget(p, ctx.targets); },
      shaTargeted(g, ctx, p) { if (ctx.source === p) trackTarget(p, [ctx.target]); },
      async turnEnd(g, ctx, p) {
        if (ctx.player !== p) return;
        const tset = p.turnFlags && p.turnFlags['儒宗目標'];
        if (!tset || tset.size !== 1) return;
        const id = [...tset][0];
        const tgt = g.players.find(q => q.id === id);
        if (!tgt) return;
        const want = Math.min(5, tgt.hand.length);
        if (p.hand.length >= want) return;
        const yes = await g.askSkill(p, '儒宗', `【儒宗】摸牌至 ${want} 張？`);
        if (!yes) return;
        g.drawCards(p, want - p.hand.length);
        g.log(`【儒宗】${g.nameOf(p)} 摸牌至 ${want} 張`, 'skill');
      },
    },
  };
  function trackTarget(p, targets) {
    if (!p.turnFlags) return;
    p.turnFlags['儒宗目標'] = p.turnFlags['儒宗目標'] || new Set();
    for (const t of (targets || [])) if (t) p.turnFlags['儒宗目標'].add(t.id);
  }

  /* ── 貞良：棄與「任」同色的牌造成傷害 ─────────────────────── */
  SK['貞良'] = {
    type: 'active',
    desc: '轉換技，①出牌階段限一次，你可以棄置X張與「任」顏色相同的牌，然後對攻擊範圍內的一名角色造成1點傷害（X為你與其體力值之差且至少為1）。②你的回合外，當你使用或打出的牌進入棄牌堆時，若此牌與「任」類別相同，你摸一張牌。',
    canUse(g, p) {
      if (p.turnFlags && p.turnFlags['貞良']) return false;
      if (!p.ren) return false;
      return g.alive().some(q => q !== p && g.inAttackRange(p, q));
    },
    async active(g, p) {
      if (p.turnFlags['貞良'] || !p.ren) return;
      const t = await g.askTargets(p, { prompt: '【貞良】選擇攻擊範圍內的一名角色', min: 1, max: 1, filter: q => q.alive && q !== p && g.inAttackRange(p, q) });
      if (!t || !t.length) return;
      const tgt = t[0];
      const x = Math.max(1, Math.abs(p.hp - tgt.hp));
      const pool = p.hand.filter(c => c.color === p.ren.color);
      if (pool.length < x) { g.log(`【貞良】與「任」同色的牌不足 ${x} 張`, 'skill'); return; }
      const cs = await g.askCards(p, { min: x, max: x, pool, prompt: `【貞良】棄置 ${x} 張與「任」同色的牌` });
      if (!cs || cs.length < x) return;
      p.turnFlags['貞良'] = true;
      g.consumeCards(p, cs, '貞良');
      g.log(`【貞良】${g.nameOf(p)} 棄 ${x} 張牌，對 ${g.nameOf(tgt)} 造成 1 點傷害`, 'skill');
      await g.damage(p, tgt, 1, 'normal', null);
      g.update();
    },
    events: {
      // ②回合外使用／打出的牌與「任」同類別 → 摸一張
      cardUsed(g, ctx, p) {
        if (ctx.player !== p || !p.ren || !g.turnPlayer || g.turnPlayer === p) return;
        if (ctx.card && ctx.card.type === p.ren.type) g.drawCards(p, 1);
      },
    },
  };

  /* ── 酣戰：拼點時對手隨機出牌；拼點後獲得點數最大的【殺】────── */
  SK['酣戰'] = {
    type: 'trigger',
    desc: '你與其他角色拼點，或其他角色與你拼點時，你可令其使用隨機的手牌拼點。當你拼點後，你可獲得拼點牌中點數最大的【殺】。',
    events: {
      async pindianEnd(g, ctx, p) {
        if (ctx.p !== p && ctx.q !== p) return;
        const shas = [ctx.cp, ctx.cq].filter(c => c && isSha(c));
        if (!shas.length) return;
        const best = shas.reduce((a, b) => (rankOf(b) > rankOf(a) ? b : a));
        const di = g.discardPile.indexOf(best);
        if (di < 0) return;
        const yes = await g.askSkill(p, '酣戰', `【酣戰】獲得 ${C.cardText(best)}？`);
        if (!yes) return;
        g.discardPile.splice(di, 1);
        p.hand.push(best);
        g.log(`【酣戰】${g.nameOf(p)} 獲得拼點牌 ${C.cardText(best)}`, 'skill');
      },
    },
  };
  const rankOf = c => (c.rank === 1 ? 14 : (typeof c.rank === 'number' ? c.rank : parseInt(c.rank, 10) || 0));

  /* ── 拒戰：轉換技，攻守兩用 ──────────────────────────────── */
  SK['拒戰'] = {
    type: 'trigger',
    desc: '轉換技，①當你成為其他角色【殺】的目標後，你可以與其各摸一張牌，然後其本回合不能再對你使用牌。②當你的【殺】指定目標後，你可以獲得目標角色一張牌，然後你本回合不能再對其使用牌。',
    events: {
      async shaTargeted(g, ctx, p) {
        if (ctx.target === p && ctx.source !== p) {
          if (p.turnFlags && p.turnFlags['拒戰甲']) return;
          const yes = await g.askSkill(p, '拒戰', `【拒戰】與 ${g.nameOf(ctx.source)} 各摸一張牌？`);
          if (!yes) return;
          p.turnFlags['拒戰甲'] = true;
          g.drawCards(p, 1);
          g.drawCards(ctx.source, 1);
          ctx.source.turnFlags = ctx.source.turnFlags || {};
          ctx.source.turnFlags['不能對' + p.id] = true;
          g.log(`【拒戰】${g.nameOf(p)} 與 ${g.nameOf(ctx.source)} 各摸一張牌`, 'skill');
        } else if (ctx.source === p && ctx.target) {
          const t = ctx.target;
          if (p.turnFlags && p.turnFlags['拒戰乙']) return;
          const pool = [...t.hand, ...equipSlots.map(sl => t.equips[sl]).filter(Boolean)];
          if (!pool.length) return;
          const yes = await g.askSkill(p, '拒戰', `【拒戰】獲得 ${g.nameOf(t)} 一張牌？`);
          if (!yes) return;
          p.turnFlags['拒戰乙'] = true;
          const c = pool[Math.floor(Math.random() * pool.length)];
          if (c.slot && t.equips[c.slot] === c) { t.equips[c.slot] = null; g.onEquipChange && g.onEquipChange(t); }
          else { const i = t.hand.indexOf(c); if (i >= 0) t.hand.splice(i, 1); }
          p.hand.push(c);
          p.turnFlags['不能對' + t.id] = true;
          g.log(`【拒戰】${g.nameOf(p)} 獲得 ${g.nameOf(t)} 的 ${C.cardText(c)}`, 'skill');
        }
      },
    },
  };

  /* ── 罪論：結束階段看牌堆頂三張，按條件保留 ────────────────── */
  SK['罪論'] = {
    type: 'trigger',
    desc: '結束階段，你可以觀看牌堆頂三張牌，你每滿足以下一項便保留一張，然後以任意順序放回：1.你於此回合內造成過傷害；2.你於此回合內未棄置過牌；3.手牌數為全場最少。',
    events: {
      async turnEnd(g, ctx, p) {
        if (ctx.player !== p) return;
        if (g.deck.length < 3) return;
        const yes = await g.askSkill(p, '罪論');
        if (!yes) return;
        const tf = p.turnFlags || {};
        const conds = [!!tf['造成傷害'], !tf['棄置過牌'], p.hand.length === Math.min(...g.alive().map(q => q.hand.length))];
        let keep = conds.filter(Boolean).length;
        const top = g.deck.splice(0, 3);
        const got = top.slice(0, keep);
        const back = top.slice(keep);
        p.hand.push(...got);
        g.deck.push(...back);                 // 其餘放回牌堆底
        g.log(`【罪論】${g.nameOf(p)} 保留 ${got.length} 張（${got.map(c => C.cardText(c)).join('、') || '無'}），其餘放回牌堆底`, 'skill');
        g.update();
      },
    },
  };

  const DONE9 = ['奇谋', '紅顔', '悲歌', '斷腸', '蠻裔', '儒宗', '貞良', '酣戰', '拒戰', '罪論'];
  for (const n of DONE9) if (SK[n]) { delete SK[n].todo; SK[n].impl = true; }
  root.SGS_SKILLS_DONE = (root.SGS_SKILLS_DONE || []).concat(DONE9);


  /* ═══════════ 第十批 ═══════════ */

  const mark = (p, k) => ((p.marks = p.marks || {})[k] || 0);
  const addMark = (p, k, n) => { p.marks = p.marks || {}; p.marks[k] = Math.max(0, (p.marks[k] || 0) + n); };

  /* ── 武烈：失去體力，給其他角色「烈」標記；受傷時棄標記免傷 ──── */
  SK['武烈'] = {
    type: 'limited',
    desc: '限定技，結束階段，你可以失去任意點體力，令等同於失去體力值數量的其他角色獲得“烈”標記；擁有“烈”標記的角色受到一次傷害時，棄置此標記並防止該傷害。',
    events: {
      async turnEnd(g, ctx, p) {
        if (ctx.player !== p || p.usedWulie) return;
        const others = g.alive().filter(q => q !== p);
        if (!others.length || p.hp < 2) return;
        const ch = await g.ask(p, { kind: 'choice', prompt: '【武烈】失去幾點體力？', options: Array.from({ length: p.hp - 1 }, (_, i) => `失去 ${i + 1} 點`).concat(['不發動']), cancelable: true });
        if (ch === null || ch === undefined || ch === p.hp - 2) return;
        const n = ch + 1;
        p.usedWulie = true;
        g.loseHp(p, n, '武烈');
        const pick = others.sort(() => Math.random() - 0.5).slice(0, n);
        for (const q of pick) addMark(q, '烈', 1);
        g.log(`【武烈】${g.nameOf(p)} 失去 ${n} 點體力，${pick.map(q => g.nameOf(q)).join('、')} 獲得「烈」`, 'skill');
        g.update();
      },
      async beforeDamaged(g, ctx, p) {
        if (ctx.canceled) return;
        const t = ctx.target;
        if (!t || !mark(t, '烈')) return;
        addMark(t, '烈', -1);
        ctx.canceled = true;
        g.log(`【武烈】${g.nameOf(t)} 棄置「烈」標記，防止此傷害`, 'skill');
      },
    },
  };

  /* ── 將略：軍令，同勢力各回復並加上限，自己摸牌 ────────────── */
  SK['將略'] = {
    type: 'limited',
    desc: '限定技，出牌階段，你可以發起一次“軍令”，與你勢力相同的其他角色均可以執行該“軍令”；你和每一個執行“軍令”的角色體力上限+1且回復1點體力，然後你摸X張牌（X為因此回復體力的角色數）。',
    canUse(g, p) { return !p.usedJianglue && g.alive().some(q => q !== p); },
    async active(g, p) {
      if (p.usedJianglue) return;
      p.usedJianglue = true;
      const same = g.alive().filter(q => q !== p && q.generals.some(a => p.generals.some(b => a.kingdom === b.kingdom)));
      let n = 0;
      g.gainMaxHp(p, 1); await g.heal(p, 1, '將略'); n++;
      for (const q of same) {
        const yes = await g.ask(q, { kind: 'choice', prompt: `【將略】${g.nameOf(p)} 發起軍令，是否執行？`, options: ['執行', '不執行'] });
        if (yes !== 0) continue;
        g.gainMaxHp(q, 1); await g.heal(q, 1, '將略'); n++;
        g.log(`${g.nameOf(q)} 執行軍令`, 'skill');
      }
      g.drawCards(p, n);
      g.log(`【將略】${g.nameOf(p)} 發起軍令，共 ${n} 人受益，摸 ${n} 張`, 'skill');
      g.update();
    },
  };

  /* ── 奪銳：廢裝備欄，封印目標技能並自己獲得 ────────────────── */
  SK['奪銳'] = {
    type: 'trigger',
    desc: '當你於出牌階段對一名其他角色造成傷害後，你可以廢除你的一個裝備欄，令其一個技能於其下個回合結束之前無效，然後你於其下個回合結束或其死亡前擁有此技能且不能發動“奪銳”。',
    events: {
      async damaged(g, ctx, p) {
        if (ctx.source !== p || p.turnFlags && p.turnFlags['奪銳']) return;
        const t = ctx.target;
        if (!t || !t.alive || g.phase !== 'play') return;
        const cands = t.skills.filter(s => s !== '奪銳');
        if (!cands.length) return;
        const slots = ['weapon', 'armor', 'horse+', 'horse-', 'treasure'].filter(sl => !(p.deadSlots && p.deadSlots[sl]));
        if (!slots.length) return;
        const yes = await g.askSkill(p, '奪銳');
        if (!yes) return;
        p.turnFlags['奪銳'] = true;
        g.abolishSlot(p, slots[0]);
        const sk = cands[Math.floor(Math.random() * cands.length)];
        t.silenced = t.silenced || {};
        t.silenced[sk] = (t.turnCount || 0) + 3;
        if (!p.skills.includes(sk)) p.skills.push(sk);
        p.stolenSkill = sk;
        g.log(`【奪銳】${g.nameOf(p)} 廢除裝備欄，封印 ${g.nameOf(t)} 的【${sk}】並獲得之`, 'skill');
        g.update();
      },
    },
  };

  /* ── 享樂：成為【殺】目標後，來源須棄基本牌否則無效 ────────── */
  SK['享樂'] = {
    type: 'locked',
    desc: '鎖定技，當你成為一名角色【殺】的目標後，除非該角色棄置一張基本牌，否則此【殺】對你無效。',
    events: {
      async shaTargeted(g, ctx, p) {
        if (ctx.target !== p || !ctx.source || ctx.source === p) return;
        const src = ctx.source;
        const basics = src.hand.filter(c => c.type === 'basic');
        if (!basics.length) { ctx.noEffect = true; g.log(`【享樂】${g.nameOf(src)} 沒有基本牌，此【殺】無效`, 'skill'); return; }
        const c = await g.askCard(src, { prompt: `【享樂】棄置一張基本牌，否則此【殺】對 ${g.nameOf(p)} 無效`, pool: basics, cancelable: true });
        if (!c) { ctx.noEffect = true; g.log(`【享樂】${g.nameOf(src)} 未棄基本牌，此【殺】無效`, 'skill'); return; }
        g.consumeCards(src, [c], '享樂');
      },
    },
  };

  /* ── 放權：跳過出牌階段換手牌上限，結束時給別人額外回合 ────── */
  SK['放權'] = {
    type: 'active',
    desc: '你可以跳過出牌階段，則你本回合手牌上限等於你的體力上限值，然後本回合結束時，你可以棄置一張手牌並令一名其他角色獲得一個額外的回合。',
    canUse(g, p) { return !(p.turnFlags && p.turnFlags.skipPlay); },
    async active(g, p) {
      p.turnFlags.skipPlay = true;
      p.turnFlags.limitToMax = true;
      g.log(`【放權】${g.nameOf(p)} 跳過出牌階段，手牌上限＝體力上限`, 'skill');
      p.pendingFangquan = true;
      g.update();
    },
    events: {
      async turnEnd(g, ctx, p) {
        if (ctx.player !== p || !p.pendingFangquan) return;
        p.pendingFangquan = false;
        if (!p.hand.length) return;
        const yes = await g.askSkill(p, '放權', '【放權】棄一張手牌，令一名其他角色獲得額外回合？');
        if (!yes) return;
        const c = await g.askCard(p, { prompt: '【放權】棄置一張手牌', pool: p.hand.slice() });
        if (!c) return;
        g.consumeCards(p, [c], '放權');
        const t = await g.askTargets(p, { prompt: '【放權】選擇獲得額外回合的角色', min: 1, max: 1 });
        if (!t || !t.length) return;
        t[0].extraTurn = true;
        g.log(`【放權】${g.nameOf(t[0])} 獲得一個額外回合`, 'skill');
      },
    },
  };

  /* ── 若愚：主公覺醒技，體力最少時加上限並獲得激將 ──────────── */
  SK['若愚'] = {
    type: 'awaken',
    desc: '主公技，覺醒技，準備階段，若你是體力值最小的角色，你加1點體力上限，回復1點體力，然後獲得“激將”。',
    events: {
      async turnStart(g, ctx, p) {
        if (ctx.player !== p || p.awakenedRuoyu) return;
        if (p.identityName !== '主公' && p.identity !== 'lord') return;
        const min = Math.min(...g.alive().map(q => q.hp));
        if (p.hp !== min) return;
        p.awakenedRuoyu = true;
        g.gainMaxHp(p, 1);
        await g.heal(p, 1, '若愚');
        if (!p.skills.includes('激將')) p.skills.push('激將');
        g.log(`${g.nameOf(p)} 覺醒【若愚】：獲得【激將】`, 'skill');
        g.update();
      },
    },
  };

  /* ── 思蜀：指定一名角色，其樂不思蜀判定反轉 ────────────────── */
  SK['思蜀'] = {
    type: 'trigger',
    desc: '出牌階段開始時，你可以指定一名角色，令其本局遊戲中【樂不思蜀】判定效果反轉。',
    events: {
      async phaseStart(g, ctx, p) {
        if (ctx.player !== p || ctx.phase !== 'play') return;
        const cands = g.alive().filter(q => !q.sishu);
        if (!cands.length) return;
        const yes = await g.askSkill(p, '思蜀');
        if (!yes) return;
        const t = await g.askTargets(p, { prompt: '【思蜀】選擇一名角色', min: 1, max: 1, candidates: cands });
        if (!t || !t.length) return;
        t[0].sishu = true;
        g.log(`【思蜀】${g.nameOf(t[0])} 的【樂不思蜀】判定反轉`, 'skill');
      },
    },
  };

  /* ── 成略：摸牌棄牌，換本回合距離與次數 ───────────────────── */
  SK['成略'] = {
    type: 'active',
    desc: '轉換技，出牌階段限一次，①你可以摸一張牌，然後棄置兩張手牌。②你可以摸兩張牌，然後棄置一張手牌。若如此做，本回合你使用與棄置牌相同花色的牌無距離和次數限制。',
    canUse(g, p) { return !(p.turnFlags && p.turnFlags['成略']) && p.hand.length >= 1; },
    async active(g, p) {
      if (p.turnFlags['成略']) return;
      const mode = await g.ask(p, { kind: 'choice', prompt: '【成略】選擇一項', options: ['摸 1 棄 2', '摸 2 棄 1'], cancelable: true });
      if (mode === null || mode === undefined) return;
      const draw = mode === 0 ? 1 : 2, need = mode === 0 ? 2 : 1;
      if (p.hand.length + draw < need) return;
      p.turnFlags['成略'] = true;
      g.drawCards(p, draw);
      const cs = await g.askCards(p, { min: need, max: need, pool: p.hand.slice(), prompt: `【成略】棄置 ${need} 張手牌` });
      if (!cs || cs.length < need) return;
      g.consumeCards(p, cs, '成略');
      p.turnFlags.chengSuit = cs.map(c => c.suit);
      p.turnFlags.shaNoRange = true;
      p.turnFlags.noShaLimit = true;
      g.log(`【成略】${g.nameOf(p)} 摸 ${draw} 棄 ${need}，本回合 ${p.turnFlags.chengSuit.join('')} 無距離次數限制`, 'skill');
      g.update();
    },
  };

  /* ── 恃才：用的牌類型不同 → 放回牌堆頂並摸一張 ─────────────── */
  SK['恃才'] = {
    type: 'trigger',
    desc: '當你使用一張牌結算結束後，若此牌與你本回合使用的牌類型均不同，你可以將此牌置於牌堆頂，然後摸一張牌。',
    events: {
      async cardUsed(g, ctx, p) {
        if (ctx.player !== p || !ctx.card) return;
        const tf = p.turnFlags || {};
        const types = tf['恃才類型'] = tf['恃才類型'] || [];
        if (types.includes(ctx.card.type)) return;
        types.push(ctx.card.type);
        const yes = await g.askSkill(p, '恃才');
        if (!yes) return;
        const di = g.discardPile.indexOf(ctx.card);
        if (di < 0) return;
        g.discardPile.splice(di, 1);
        g.putOnDeckTop([ctx.card]);
        g.drawCards(p, 1);
        g.log(`【恃才】${g.nameOf(p)} 將 ${C.cardText(ctx.card)} 置於牌堆頂並摸一張`, 'skill');
      },
    },
  };

  /* ── 寸目：從牌堆底摸牌 ──────────────────────────────────── */
  SK['寸目'] = {
    type: 'locked',
    desc: '鎖定技，你從牌堆底摸牌。',
    events: {
      drawCards(g, ctx, p, n) {
        // 由引擎的 drawCards 直接支援（見 engine.drawCards 的 寸目 分支）
      },
    },
  };

  /* ── 附勢：場上勢力多寡決定獲得哪個技能 ───────────────────── */
  SK['附勢'] = {
    type: 'locked',
    desc: '鎖定技，若場上勢力數為：群大於魏，你擁有技能“擇主”；魏大於群，你擁有技能“逞功”。',
    events: {
      turnStart(g, ctx, p) {
        if (ctx.player !== p) return;
        const cnt = k => g.alive().filter(q => q.generals.some(a => a.kingdom === k)).length;
        const want = cnt('群') > cnt('魏') ? '擇主' : (cnt('魏') > cnt('群') ? '逞功' : null);
        if (want && !p.skills.includes(want)) { p.skills.push(want); g.log(`${g.nameOf(p)} 因【附勢】獲得【${want}】`, 'skill'); }
      },
    },
  };

  /* ── 逞功：他人用牌指定 ≥2 目標時令其摸一張 ───────────────── */
  SK['逞功'] = {
    type: 'trigger',
    desc: '一名角色使用牌指定目標後，若目標數不小於2，你可以令其摸一張牌。',
    events: {
      async trickTargets(g, ctx, p) {
        if (!ctx.targets || ctx.targets.length < 2) return;
        if (ctx.player === p) return;
        if (p.turnFlags && p.turnFlags['逞功']) return;
        const yes = await g.askSkill(p, '逞功');
        if (!yes) return;
        p.turnFlags['逞功'] = true;
        g.drawCards(ctx.player, 1);
        g.log(`【逞功】${g.nameOf(p)} 令 ${g.nameOf(ctx.player)} 摸一張牌`, 'skill');
      },
    },
  };

  /* ── 往烈：第一張牌無距離；可令一張牌不能被響應 ────────────── */
  SK['往烈'] = {
    type: 'trigger',
    desc: '出牌階段，你使用的第一張牌無距離限制。當你於出牌階段使用一張牌時，你可以令此牌不能被響應，然後本回合你不能再使用牌。',
    events: {
      async cardUsed(g, ctx, p) {
        if (ctx.player !== p || g.phase !== 'play') return;
        const tf = p.turnFlags || {};
        if (!tf['往烈用過']) { tf['往烈用過'] = true; tf.shaNoRange = true; p.turnFlags = tf; }
        const yes = await g.askSkill(p, '往烈', '【往烈】令此牌不能被響應？（之後本回合不能再使用牌）');
        if (!yes) return;
        ctx.unrespondable = true;
        p.turnFlags.noMoreCards = true;
        g.log(`【往烈】此牌不能被響應，${g.nameOf(p)} 本回合不能再使用牌`, 'skill');
      },
    },
  };

  /* ── 將烈：【殺】指定目標後，令其棄所有紅或所有黑手牌 ───────── */
  SK['將烈'] = {
    type: 'trigger',
    desc: '當你的【殺】指定目標後，你可以令其展示所有手牌，然後其棄置所有紅色手牌或所有黑色手牌，且至少一張。',
    events: {
      async shaTargeted(g, ctx, p) {
        if (ctx.source !== p || !ctx.target) return;
        const t = ctx.target;
        if (!t.alive || !t.hand.length) return;
        const reds = t.hand.filter(c => c.color === 'red'), blacks = t.hand.filter(c => c.color === 'black');
        if (!reds.length && !blacks.length) return;
        const yes = await g.askSkill(p, '將烈');
        if (!yes) return;
        g.log(`【將烈】${g.nameOf(t)} 展示手牌：${t.hand.map(c => C.cardText(c)).join('、')}`, 'skill');
        const opts = [];
        if (reds.length) opts.push(`棄 ${reds.length} 張紅牌`);
        if (blacks.length) opts.push(`棄 ${blacks.length} 張黑牌`);
        const ch = await g.ask(t, { kind: 'choice', prompt: '【將烈】選擇棄置哪一組手牌', options: opts });
        const pickReds = (ch === 0 && reds.length) || !blacks.length;
        const cs = pickReds ? reds : blacks;
        if (!cs.length) return;
        g.consumeCards(t, cs, '將烈');
        g.log(`【將烈】${g.nameOf(t)} 棄置 ${cs.length} 張${pickReds ? '紅' : '黑'}牌`, 'skill');
      },
    },
  };

  /* ── 设变：翻面時可移動場上一張裝備牌 ─────────────────────── */
  SK['设变'] = {
    type: 'trigger',
    desc: '你翻面時，你可以移動場上一張裝備牌。',
    events: {
      async flip(g, ctx, p) {
        if (ctx.player !== p) return;
        const eqs = [];
        for (const q of g.alive()) for (const sl of equipSlots) if (q.equips[sl]) eqs.push({ q, c: q.equips[sl] });
        if (!eqs.length) return;
        const yes = await g.askSkill(p, '设变', '【设变】移動場上一張裝備牌？');
        if (!yes) return;
        const one = eqs[Math.floor(Math.random() * eqs.length)];
        const t = await g.askTargets(p, { prompt: `【设变】將 ${C.cardText(one.c)} 移到誰的裝備區？`, min: 1, max: 1 });
        if (!t || !t.length) return;
        const dst = t[0];
        one.q.equips[one.c.slot] = null;
        placeEquip(g, dst, one.c);
        g.log(`【设变】${C.cardText(one.c)} 移到 ${g.nameOf(dst)} 的裝備區`, 'skill');
        g.update();
      },
    },
  };

  /* ── 肅資：對手死亡後獲得其死亡時棄置的牌 ──────────────────── */
  SK['肅資'] = {
    type: 'trigger',
    desc: '對手死亡後，你可以獲得其於死亡時棄置的所有牌。',
    events: {
      async onDeath(g, ctx, p) {
        const dead = ctx.player;
        if (!dead || dead === p) return;
        const sameTeam = (a, b) => (a.identityName === b.identityName);
        if (sameTeam(dead, p)) return;
        const recent = g.discardPile.slice(-12);
        if (!recent.length) return;
        const yes = await g.askSkill(p, '肅資');
        if (!yes) return;
        for (const c of recent) {
          const i = g.discardPile.indexOf(c);
          if (i >= 0) { g.discardPile.splice(i, 1); p.hand.push(c); }
        }
        g.log(`【肅資】${g.nameOf(p)} 獲得 ${g.nameOf(dead)} 死亡時棄置的 ${recent.length} 張牌`, 'skill');
        g.update();
      },
    },
  };

  /* ── 懷橘／遺禮／整論：「橘」標記 ───────────────────────────── */
  SK['懷橘'] = {
    type: 'locked',
    desc: '鎖定技，遊戲開始時，你獲得3個“橘”標記（有“橘”的角色受到傷害時，防止此傷害，然後移去一個“橘”；有“橘”的角色摸牌階段額外摸一張牌）。',
    events: {
      gameStart(g, ctx, p) { addMark(p, '橘', 3); g.log(`${g.nameOf(p)} 獲得 3 個「橘」標記`, 'skill'); },
      async beforeDamaged(g, ctx, p) {
        if (ctx.canceled) return;
        const t = ctx.target;
        if (!t || !mark(t, '橘')) return;
        addMark(t, '橘', -1);
        ctx.canceled = true;
        g.log(`【懷橘】${g.nameOf(t)} 移去一個「橘」防止傷害`, 'skill');
      },
      drawCount(g, p, n) {
        return (mark(p, '橘') && p.skills.includes('懷橘')) ? n + 1 : n;
      },
    },
  };
  SK['遺禮'] = {
    type: 'trigger',
    desc: '出牌階段開始時，你可以失去1點體力或移去一個“橘”，然後令一名其他角色獲得一個“橘”。',
    events: {
      async phaseStart(g, ctx, p) {
        if (ctx.player !== p || ctx.phase !== 'play') return;
        const others = g.alive().filter(q => q !== p);
        if (!others.length) return;
        if (!mark(p, '橘') && p.hp < 2) return;
        const yes = await g.askSkill(p, '遺禮');
        if (!yes) return;
        if (mark(p, '橘')) addMark(p, '橘', -1); else g.loseHp(p, 1, '遺禮');
        const t = await g.askTargets(p, { prompt: '【遺禮】令一名其他角色獲得「橘」', min: 1, max: 1, candidates: others });
        const tgt = (t && t[0]) || others[0];
        addMark(tgt, '橘', 1);
        g.log(`【遺禮】${g.nameOf(tgt)} 獲得一個「橘」標記`, 'skill');
        g.update();
      },
    },
  };
  SK['整論'] = {
    type: 'trigger',
    desc: '若你沒有“橘”，你可以跳過摸牌階段然後獲得一個“橘”。',
    events: {
      async phaseStart(g, ctx, p) {
        if (ctx.player !== p || ctx.phase !== 'draw') return;
        if (mark(p, '橘')) return;
        const yes = await g.askSkill(p, '整論', '【整論】跳過摸牌階段，獲得一個「橘」？');
        if (!yes) return;
        p.turnFlags.skipDrawNext = true;
        addMark(p, '橘', 1);
        g.log(`【整論】${g.nameOf(p)} 跳過摸牌階段，獲得一個「橘」`, 'skill');
      },
    },
  };

  /* ── 掣政：攻擊範圍不含你的角色不能成為目標 ────────────────── */
  SK['掣政'] = {
    type: 'locked',
    desc: '鎖定技，出牌階段，攻擊範圍內不包含你的其他角色不能成為你使用牌的目標。出牌階段結束時，若你本階段內使用的牌數小於這些角色數，你棄置其中一名角色一張牌。',
    cannotBeTargeted(g, p, src, cardName) {
      // p 是來源時由 canBeTargeted 的反向檢查處理（見 engine.canBeTargeted 的 掣政 分支）
      return false;
    },
    events: {
      async phaseEnd(g, ctx, p) {
        if (ctx.player !== p || ctx.phase !== 'play') return;
        const pool = g.alive().filter(q => q !== p && !g.inAttackRange(q, p));
        const used = (p.turnFlags && p.turnFlags['掣政用牌']) || 0;
        if (!pool.length || used >= pool.length) return;
        const t = pool[Math.floor(Math.random() * pool.length)];
        const cards = [...t.hand, ...equipSlots.map(sl => t.equips[sl]).filter(Boolean)];
        if (!cards.length) return;
        const c = cards[Math.floor(Math.random() * cards.length)];
        if (c.slot && t.equips[c.slot] === c) { t.equips[c.slot] = null; g.onEquipChange && g.onEquipChange(t); g.toDiscard([c]); }
        else g.consumeCards(t, [c], '掣政');
        g.log(`【掣政】${g.nameOf(p)} 棄置 ${g.nameOf(t)} 的 ${C.cardText(c)}`, 'skill');
      },
    },
  };

  /* ── 鷹揚：拼點牌點數 ±3 ─────────────────────────────────── */
  SK['鷹揚'] = {
    type: 'trigger',
    desc: '當你拼點的牌亮出後，你可以令此牌的點數+3或-3（最大為K，最小為A）。',
    events: {
      async pindianEnd(g, ctx, p) {
        const mine = ctx.p === p ? ctx.cp : (ctx.q === p ? ctx.cq : null);
        if (!mine) return;
        const yes = await g.askSkill(p, '鷹揚', `【鷹揚】令 ${C.cardText(mine)} 的點數 +3／-3？`);
        if (!yes) return;
        const ch = await g.ask(p, { kind: 'choice', prompt: '【鷹揚】選擇', options: ['+3', '-3'] });
        const base = rankOf(mine);
        const next = Math.min(13, Math.max(1, base + (ch === 0 ? 3 : -3)));
        mine.rank = next === 14 ? 1 : next;
        g.log(`【鷹揚】${g.nameOf(p)} 令拼點牌點數變為 ${next === 1 ? 'A' : next}`, 'skill');
      },
    },
  };

  /* ── 魂殤：體力上限 -1；體力 1 時本回合擁有英姿英魂 ─────────── */
  SK['魂殤'] = {
    type: 'trigger',
    startMaxHpMinus: 1,
    desc: '副將技，你計算體力上限時減少1個單獨的陰陽魚。準備階段，若你的體力值為1，本回合視為你擁有“英姿”和“英魂”。',
    events: {
      gameStart(g, ctx, p) {
        p.maxHp = Math.max(1, p.maxHp - 1);
        p.hp = Math.min(p.hp, p.maxHp);
        g.log(`${g.nameOf(p)} 因【魂殤】體力上限 -1（${p.maxHp}）`, 'skill');
      },
      turnStart(g, ctx, p) {
        if (ctx.player !== p || p.hp !== 1) return;
        for (const sk of ['英姿', '英魂']) if (!p.skills.includes(sk)) p.skills.push(sk);
        p.turnFlags.hunshang = true;
        g.log(`【魂殤】${g.nameOf(p)} 本回合獲得【英姿】【英魂】`, 'skill');
      },
      turnEnd(g, ctx, p) {
        if (ctx.player !== p || !p.turnFlags.hunshang) return;
        p.skills = p.skills.filter(sk => sk !== '英姿' && sk !== '英魂');
        delete p.turnFlags.hunshang;
      },
    },
  };

  /* ── 威嚴：距離 1 內沒有敵方角色時傷害 +1 ─────────────────── */
  SK['威嚴'] = {
    type: 'trigger',
    desc: '你的【殺】造成傷害時，若目標角色距離1以內沒有敵方角色，該傷害+1。',
    damageBonus(g, ctx, p) {
      if (ctx.source !== p || !ctx.card || !isSha(ctx.card)) return 0;
      const t = ctx.target;
      const hasFoe = g.alive().some(q => q !== t && q !== p && g.distance(t, q) <= 1);
      return hasFoe ? 0 : 1;
    },
  };

  /* ── 惡來／蠻刃：擊殺計數 ────────────────────────────────── */
  SK['惡來'] = {
    type: 'locked',
    desc: '鎖定技，你殺死敵方角色獲得的積分+1。',
    events: {
      onDeath(g, ctx, p) {
        if (ctx.source !== p) return;
        g.kills = g.kills || {};
        g.kills[p.id] = (g.kills[p.id] || 0) + 1;
        g.log(`【惡來】${g.nameOf(p)} 擊殺數 ${g.kills[p.id]}`, 'skill');
      },
    },
  };
  SK['蠻刃'] = {
    type: 'locked',
    desc: '鎖定技，若己方角色已擊殺至少兩次敵方角色，你的【殺】傷害等於目標角色當前體力值。',
    damageOverride(g, ctx, p) {
      if (ctx.source !== p || !ctx.card || !isSha(ctx.card)) return 0;
      const k = (g.kills && g.kills[p.id]) || 0;
      if (k < 2) return 0;
      return Math.max(1, ctx.target.hp);
    },
  };

  /* ── 悟道／驚雷 ─────────────────────────────────────────── */
  SK['悟道'] = {
    type: 'awaken',
    desc: '覺醒技，當一名角色進入瀕死狀態時，若你沒有手牌，你加1點體力上限並回復1點體力，獲得"驚雷"。',
    events: {
      async dying(g, ctx, p) {
        if (p.awakenedWudao || p.hand.length) return;
        p.awakenedWudao = true;
        g.gainMaxHp(p, 1);
        await g.heal(p, 1, '悟道');
        if (!p.skills.includes('驚雷')) p.skills.push('驚雷');
        g.log(`${g.nameOf(p)} 覺醒【悟道】：獲得【驚雷】`, 'skill');
        g.update();
      },
    },
  };
  SK['驚雷'] = {
    type: 'trigger',
    desc: '準備階段，你可以選擇一名角色，然後你令任意名手牌數之和小於其的角色各對其造成1點雷電傷害。',
    events: {
      async turnStart(g, ctx, p) {
        if (ctx.player !== p) return;
        const t = await g.askTargets(p, { prompt: '【驚雷】選擇一名角色', min: 1, max: 1, cancelable: true });
        if (!t || !t.length) return;
        const tgt = t[0];
        const cands = g.alive().filter(q => q !== tgt && q !== p && q.hand.length < tgt.hand.length);
        if (!cands.length) return;
        const pick = await g.askTargets(p, { prompt: '【驚雷】選擇對其造成傷害的角色（可多選）', min: 1, max: cands.length, candidates: cands });
        for (const q of (pick || [])) {
          await g.damage(q, tgt, 1, 'thunder', null);
        }
        g.log(`【驚雷】${g.nameOf(p)} 令 ${(pick || []).map(q => g.nameOf(q)).join('、')} 各對 ${g.nameOf(tgt)} 造成 1 點雷電傷害`, 'skill');
      },
    },
  };

  /* ── 群蚑：傷害後對其鄰近角色造成等量傷害 ──────────────────── */
  SK['群蚑'] = {
    type: 'trigger',
    desc: '當你使用【殺】對一名角色造成傷害後，你可以對與其距離＜1＞以內除其外的一名角色造成等量傷害。',
    events: {
      async damaged(g, ctx, p) {
        if (ctx.source !== p || !ctx.card || !isSha(ctx.card)) return;
        const t = ctx.target;
        const near = g.alive().filter(q => q !== t && q !== p && g.distance(t, q) <= 1);
        if (!near.length) return;
        const yes = await g.askSkill(p, '群蚑');
        if (!yes) return;
        const pick = await g.askTargets(p, { prompt: '【群蚑】選擇一名鄰近角色', min: 1, max: 1, candidates: near });
        if (!pick || !pick.length) return;
        g.log(`【群蚑】${g.nameOf(p)} 對 ${g.nameOf(pick[0])} 造成 ${ctx.amount} 點傷害`, 'skill');
        await g.damage(p, pick[0], ctx.amount, ctx.nature || 'normal', null);
      },
    },
  };

  /* ── 太平：對所有其他角色 1 點傷害（鄰近有他人者免）────────── */
  SK['太平'] = {
    type: 'limited',
    desc: '限定技，出牌階段，你可以對所有其他角色造成1點傷害，若其距離＜1＞以內有除其外的角色，防止此傷害。',
    canUse(g, p) { return !p.usedTaiping && g.alive().length > 1; },
    async active(g, p) {
      if (p.usedTaiping) return;
      p.usedTaiping = true;
      for (const q of g.alive()) {
        if (q === p) continue;
        const near = g.alive().some(r => r !== q && g.distance(q, r) <= 1);
        if (near) { g.log(`【太平】${g.nameOf(q)} 附近有其他人，傷害被防止`, 'skill'); continue; }
        await g.damage(p, q, 1, 'normal', null);
      }
      g.log(`【太平】${g.nameOf(p)} 發動限定技`, 'skill');
      g.update();
    },
  };

  /* ── 摧鋒／登難：限定技虛擬牌，未達條件則重置 ───────────────── */
  SK['摧鋒'] = {
    type: 'limited',
    desc: '限定技，出牌階段，你可以視為使用一張唯一目標的傷害類牌（無距離限制），若此牌未造成傷害或造成的傷害數大於1，此回合結束時重置“摧鋒”。',
    canUse(g, p) { return !p.usedCuifeng && g.others(p).length > 0; },
    async active(g, p) {
      const t = await g.askTargets(p, { prompt: '【摧鋒】選擇一名角色', min: 1, max: 1 });
      if (!t || !t.length) return;
      p.usedCuifeng = true;
      const card = { id: 'v摧鋒' + Date.now(), name: '殺', type: 'basic', virtual: true, subcards: [], suit: '♠', rank: 7, skill: '摧鋒', noRange: true };
      const hp0 = t[0].hp;
      await g.useShaOn(p, t[0], card);
      const dealt = hp0 - t[0].hp;
      if (dealt !== 1) { p.usedCuifeng = false; g.log('【摧鋒】條件成立，本回合結束時重置', 'skill'); }
      g.update();
    },
  };
  SK['登難'] = {
    type: 'limited',
    desc: '限定技，出牌階段，你可以視為使用一張非傷害類普通錦囊牌，此回合結束時，若此牌的目標均於此回合受到過傷害，你重置“登難”。',
    canUse(g, p) { return !p.usedDengnan && p.hand.length >= 1 && g.others(p).length > 0; },
    async active(g, p) {
      const t = await g.askTargets(p, { prompt: '【登難】選擇一名角色', min: 1, max: 1 });
      if (!t || !t.length) return;
      p.usedDengnan = true;
      const card = { id: 'v登難' + Date.now(), name: '過河拆橋', type: 'trick', virtual: true, subcards: [], suit: '♠', rank: 7, skill: '登難' };
      await g.useTrick(p, card, card.name, t);
      g.log(`【登難】${g.nameOf(p)} 視為使用【過河拆橋】`, 'skill');
      g.update();
    },
  };

  const DONE10 = ['武烈', '將略', '奪銳', '享樂', '放權', '若愚', '思蜀', '成略', '恃才', '寸目', '附勢', '逞功', '往烈', '將烈', '设变', '肅資', '懷橘', '遺禮', '整論', '掣政', '鷹揚', '魂殤', '威嚴', '惡來', '蠻刃', '悟道', '驚雷', '群蚑', '太平', '摧鋒', '登難'];
  for (const n of DONE10) if (SK[n]) { delete SK[n].todo; SK[n].impl = true; }
  root.SGS_SKILLS_DONE = (root.SGS_SKILLS_DONE || []).concat(DONE10);


  /* ═══════════ 第十一批 ═══════════ */

  // 直接把一張「不在手牌裡」的牌裝到裝備區（用於移動裝備，不能走 g.equipCard）
  const placeEquip = (g, dst, card) => {
    const slot = card.slot;
    if (dst.deadSlots && dst.deadSlots[slot]) { g.toDiscard([card]); return; }
    const old = dst.equips[slot];
    dst.equips[slot] = card;
    if (old && old !== card) g.toDiscard([old]);
    g.onEquipChange && g.onEquipChange(dst);
    g.log(`${g.nameOf(dst)} 裝備 ${C.cardText(card)}`, 'equip');
  };
  const GZ = '（國戰專用：本作身份局沒有地形／計分／帥旗機制，此技能不生效，保留官方描述。）';
  const gzSkill = (name, desc) => { SK[name] = { type: 'guozhan', desc, todoNote: GZ, noop: true }; };

  /* ── 兵威：交一張牌給隊友並回復（本作無帥旗，以此等效）───────── */
  SK['兵威'] = {
    type: 'active',
    desc: '出牌階段限一次，你可以交給距離 3 以內的一名其他角色一張手牌，然後其回復 1 點體力。（本作無帥旗與移動機制，以此等效實作。）',
    canUse(g, p) { return !(p.turnFlags && p.turnFlags['兵威']) && p.hand.length > 0 && g.others(p).some(q => g.distance(p, q) <= 3); },
    async active(g, p) {
      if (p.turnFlags['兵威']) return;
      const t = await g.askTargets(p, { prompt: '【兵威】交給一名距離 3 內的角色一張牌', min: 1, max: 1, filter: q => q.alive && q !== p && g.distance(p, q) <= 3 });
      if (!t || !t.length) return;
      const c = await g.askCard(p, { prompt: '【兵威】選擇要交出的牌', pool: p.hand.slice(), cancelable: true });
      if (!c) return;
      p.turnFlags['兵威'] = true;
      const i = p.hand.indexOf(c); if (i >= 0) p.hand.splice(i, 1);
      t[0].hand.push(c);
      await g.heal(t[0], 1, '兵威');
      g.log(`【兵威】${g.nameOf(p)} 交給 ${g.nameOf(t[0])} ${C.cardText(c)} 並令其回復 1 點體力`, 'skill');
      g.update();
    },
  };

  /* ── 蠱惑：扣置一張手牌當任意基本牌／普通錦囊，可被質疑 ──────── */
  SK['蠱惑'] = {
    type: 'active',
    desc: '每名角色的回合限一次，你可以扣置一張手牌當任意一張基本牌或普通錦囊牌使用或打出。其他所有角色依次選擇是否質疑，然後有人質疑則翻開此牌：若為假則此牌作廢，若為真則質疑者獲得“纏怨”。',
    canUse(g, p) {
      if (p.turnFlags && p.turnFlags['蠱惑']) return false;
      return p.hand.length > 0 && g.others(p).length > 0;
    },
    async active(g, p) {
      if (p.turnFlags['蠱惑']) return;
      const claims = ['殺', '閃', '桃', '無中生有', '過河拆橋', '決鬥'];
      const c = await g.askCard(p, { prompt: '【蠱惑】扣置一張手牌', pool: p.hand.slice(), cancelable: true });
      if (!c) return;
      const ci = await g.ask(p, { kind: 'choice', prompt: '【蠱惑】聲稱為哪張牌？', options: claims });
      if (ci === null || ci === undefined) return;
      const claim = claims[ci];
      p.turnFlags['蠱惑'] = true;
      const dropCard = () => { const i = p.hand.indexOf(c); if (i >= 0) p.hand.splice(i, 1); g.toDiscard([c]); };
      // 其他人依次質疑
      let doubted = false;
      for (const q of g.alive()) {
        if (q === p) continue;
        const yes = await g.ask(q, { kind: 'choice', prompt: `${g.nameOf(p)} 聲稱此牌是【${claim}】，質疑嗎？`, options: ['質疑', '不質疑'] });
        if (yes === 0) { doubted = true; break; }
      }
      const isTrue = c.name === claim;
      if (doubted && !isTrue) {
        dropCard();
        g.log(`【蠱惑】${g.nameOf(p)} 的牌是假的（其實是 ${C.cardText(c)}），此牌作廢`, 'skill');
        g.update();
        return;
      }
      if (doubted && isTrue) {
        const q = g.alive().find(x => x !== p);
        if (q && !q.skills.includes('纏怨')) { q.skills.push('纏怨'); g.log(`【蠱惑】此牌為真，${g.nameOf(q)} 獲得【纏怨】`, 'skill'); }
      }
      g.log(`【蠱惑】${g.nameOf(p)} 以 ${C.cardText(c)} 當【${claim}】${doubted ? '（質疑失敗）' : ''}`, 'skill');
      const virtual = Object.assign({}, c, { name: claim, virtual: true, subcards: [c], skill: '蠱惑', id: 'v蠱惑' + c.id });
      if (claim === '殺') {
        const t = await g.askTargets(p, { prompt: '【蠱惑】選擇【殺】的目標', min: 1, max: 1 });
        if (t && t.length) await g.useShaOn(p, t[0], virtual);
        else dropCard();
      } else if (claim === '桃') {
        if (p.hp < p.maxHp) { dropCard(); await g.heal(p, 1, '蠱惑'); } else dropCard();
      } else if (claim === '閃') {
        g.log('【蠱惑】不可主動使用【閃】，改為棄置', 'skill'); dropCard();
      } else {
        const t = await g.askTargets(p, { prompt: `【蠱惑】選擇【${claim}】的目標`, min: 1, max: claim === '決鬥' ? 1 : 1 });
        if (t && t.length) await g.useTrick(p, virtual, virtual.name, t); else dropCard();
      }
      g.update();
    },
  };

  /* ── 纏鬥：距離 1 的敵方回合開始須棄【閃】，否則跳過出牌 ─────── */
  SK['纏鬥'] = {
    type: 'locked',
    desc: '鎖定技，與你距離 1 以內的敵方角色的回合開始前，其需棄置一張【閃】，否則跳過出牌階段。（本作無移動階段，改為跳過出牌階段。）',
    events: {
      async turnStart(g, ctx, p) {
        if (ctx.player === p) return;
        const t = ctx.player;
        if (g.distance(p, t) > 1) return;
        const shan = t.hand.filter(c => c.name === '閃');
        if (!shan.length) {
          t.turnFlags.skipPlay = true;
          g.log(`【纏鬥】${g.nameOf(t)} 沒有【閃】，跳過出牌階段`, 'skill');
          return;
        }
        const c = await g.askCard(t, { prompt: `【纏鬥】棄置一張【閃】，否則跳過出牌階段`, pool: shan, cancelable: true });
        if (!c) { t.turnFlags.skipPlay = true; g.log(`【纏鬥】${g.nameOf(t)} 未棄【閃】，跳過出牌階段`, 'skill'); return; }
        g.consumeCards(t, [c], '纏鬥');
      },
    },
  };

  /* ── 解圍：裝備當無懈；翻回正面時移動場上一張牌 ──────────────── */
  SK['解圍'] = {
    type: 'trigger',
    desc: '你可以將裝備區裡的牌當【無懈可擊】使用；當你從背面翻至正面時，你可以棄置一張手牌，然後移動場上的一張牌。',
    events: {
      async trickTargets(g, ctx, p) {
        if (!ctx.targets || !ctx.targets.includes(p)) return;
        const eqs = equipSlots.map(sl => p.equips[sl]).filter(Boolean);
        if (!eqs.length) return;
        const yes = await g.askSkill(p, '解圍', '【解圍】棄一張裝備當【無懈可擊】取消此錦囊？');
        if (!yes) return;
        const c = eqs[0];
        p.equips[c.slot] = null;
        g.onEquipChange && g.onEquipChange(p);
        g.toDiscard([c]);
        ctx.negate.push(p);
        g.log(`【解圍】${g.nameOf(p)} 以 ${C.cardText(c)} 當【無懈可擊】`, 'skill');
      },
      async flip(g, ctx, p) {
        if (ctx.player !== p || !p.hand.length) return;
        const yes = await g.askSkill(p, '解圍', '【解圍】棄一張手牌，移動場上一張牌？');
        if (!yes) return;
        const c = await g.askCard(p, { prompt: '【解圍】棄置一張手牌', pool: p.hand.slice(), cancelable: true });
        if (!c) return;
        g.consumeCards(p, [c], '解圍');
        const pool = [];
        for (const q of g.alive()) { for (const sl of equipSlots) if (q.equips[sl]) pool.push({ q, c: q.equips[sl] }); }
        for (const q of g.alive()) if (q.judge.length) pool.push({ q, c: q.judge[0], judge: true });
        if (!pool.length) return;
        const one = pool[Math.floor(Math.random() * pool.length)];
        if (one.judge) {
          one.q.judge.splice(one.q.judge.indexOf(one.c), 1);
          const t = await g.askTargets(p, { prompt: '【解圍】把判定牌移到誰的判定區', min: 1, max: 1 });
          if (t && t.length) t[0].judge.push(one.c);
        } else {
          const t = await g.askTargets(p, { prompt: '【解圍】把裝備移到誰的裝備區', min: 1, max: 1 });
          if (t && t.length) { one.q.equips[one.c.slot] = null; placeEquip(g, t[0], one.c); }
        }
        g.log(`【解圍】${g.nameOf(p)} 移動了場上一張牌`, 'skill');
        g.update();
      },
    },
  };

  /* ── 箜聲：準備階段放牌到武將牌上，結束階段使用／收回 ─────────── */
  SK['箜聲'] = {
    type: 'trigger',
    desc: '準備階段，你可以將任意張牌置於武將牌上。結束階段，你使用武將牌上的裝備牌，並獲得武將牌上的其他牌。',
    events: {
      async turnStart(g, ctx, p) {
        if (ctx.player !== p) return;
        const pool = [...p.hand, ...equipSlots.map(sl => p.equips[sl]).filter(Boolean)];
        if (!pool.length) return;
        const yes = await g.askSkill(p, '箜聲', '【箜聲】將手牌置於武將牌上？');
        if (!yes) return;
        const cs = await g.askCards(p, { min: 1, max: pool.length, pool, prompt: '選擇任意張牌置於武將牌上' });
        if (!cs || !cs.length) return;
        p.kongsheng = p.kongsheng || [];
        for (const c of cs) {
          if (c.slot && p.equips[c.slot] === c) { p.equips[c.slot] = null; g.onEquipChange && g.onEquipChange(p); }
          else { const i = p.hand.indexOf(c); if (i >= 0) p.hand.splice(i, 1); }
          p.kongsheng.push(c);
        }
        g.log(`【箜聲】${g.nameOf(p)} 將 ${cs.length} 張牌置於武將牌上`, 'skill');
      },
      async turnEnd(g, ctx, p) {
        if (ctx.player !== p || !p.kongsheng || !p.kongsheng.length) return;
        const equips = p.kongsheng.filter(c => c.slot);
        const rest = p.kongsheng.filter(c => !c.slot);
        p.kongsheng = [];
        for (const c of equips) { placeEquip(g, p, c); g.log(`${g.nameOf(p)} 使用武將牌上的 ${C.cardText(c)}`, 'skill'); }
        p.hand.push(...rest);
        if (rest.length) g.log(`【箜聲】${g.nameOf(p)} 收回 ${rest.length} 張牌`, 'skill');
        g.update();
      },
    },
  };

  /* ── 擇主：獲得雙方主帥各一張牌，再各交一張 ──────────────────── */
  SK['擇主'] = {
    type: 'active',
    desc: '出牌階段限一次，你可以獲得兩名角色各一張牌，然後分別交給其一張牌；若某角色沒有牌，則改為摸一張牌。',
    canUse(g, p) { return !(p.turnFlags && p.turnFlags['擇主']) && g.others(p).length >= 2; },
    async active(g, p) {
      if (p.turnFlags['擇主']) return;
      const t = await g.askTargets(p, { prompt: '【擇主】選擇兩名角色', min: 2, max: 2 });
      if (!t || t.length < 2) return;
      p.turnFlags['擇主'] = true;
      const got = [];
      for (const q of t) {
        if (!q.hand.length) { g.drawCards(q, 1); continue; }
        const c = q.hand[Math.floor(Math.random() * q.hand.length)];
        q.hand.splice(q.hand.indexOf(c), 1);
        p.hand.push(c); got.push(c);
      }
      for (const q of t) {
        if (!p.hand.length) break;
        const c = p.hand[Math.floor(Math.random() * p.hand.length)];
        p.hand.splice(p.hand.indexOf(c), 1);
        q.hand.push(c);
      }
      g.log(`【擇主】${g.nameOf(p)} 各取 ${t.map(q => g.nameOf(q)).join('、')} 一張牌後歸還`, 'skill');
      g.update();
    },
  };

  /* ── 立軍／制霸／黃天：主公技（吳／群隊友互動）────────────────── */
  SK['立軍'] = {
    type: 'lord',
    desc: '主公技，其他吳勢力角色於其出牌階段限一次，使用【殺】結算結束後，其可以將此【殺】交給你，然後你可以令其摸一張牌。',
    events: {
      async shaTargeted(g, ctx, p) {
        const src = ctx.source;
        if (ctx.target === p || !src || src === p) return;
        if (src.turnFlags && src.turnFlags['立軍']) return;
        if (!src.generals.some(a => a.kingdom === '吳')) return;
        const yes = await g.ask(src, { kind: 'choice', prompt: `【立軍】將此【殺】交給 ${g.nameOf(p)}？`, options: ['交給', '不交'] });
        if (yes !== 0) return;
        src.turnFlags['立軍'] = true;
        g.log(`${g.nameOf(src)} 發動【立軍】`, 'skill');
        g.drawCards(src, 1);
      },
    },
  };
  SK['制霸'] = {
    type: 'lord',
    desc: '主公技，其他吳勢力角色的出牌階段限一次，該角色可以與你拼點；若其沒贏，你可以獲得拼點的兩張牌。',
    events: {
      async phaseStart(g, ctx, p) {
        const cur = ctx.player;
        if (ctx.phase !== 'play' || !cur || cur === p) return;
        if (cur.turnFlags && cur.turnFlags['制霸']) return;
        if (!cur.generals.some(a => a.kingdom === '吳')) return;
        if (!cur.hand.length || !p.hand.length) return;
        const yes = await g.ask(cur, { kind: 'choice', prompt: `【制霸】與 ${g.nameOf(p)} 拼點？`, options: ['拼點', '不拼'] });
        if (yes !== 0) return;
        cur.turnFlags['制霸'] = true;
        const r = await g.pindian(cur, p, '制霸');
        if (r && !r.win) {
          const take = await g.ask(p, { kind: 'choice', prompt: '【制霸】獲得拼點的兩張牌？', options: ['獲得', '不獲得'] });
          if (take === 0) {
            for (const c of [r.cp, r.cq]) { const i = g.discardPile.indexOf(c); if (i >= 0) { g.discardPile.splice(i, 1); p.hand.push(c); } }
            g.log(`【制霸】${g.nameOf(p)} 獲得拼點的兩張牌`, 'skill');
          }
        }
      },
    },
  };
  SK['黃天'] = {
    type: 'lord',
    desc: '主公技，其他群勢力角色的出牌階段限一次，該角色可以將一張【閃】或【閃電】交給你。',
    events: {
      async phaseStart(g, ctx, p) {
        const cur = ctx.player;
        if (ctx.phase !== 'play' || !cur || cur === p) return;
        if (cur.turnFlags && cur.turnFlags['黃天']) return;
        if (!cur.generals.some(a => a.kingdom === '群')) return;
        const pool = cur.hand.filter(c => c.name === '閃' || c.name === '閃電');
        if (!pool.length) return;
        const yes = await g.ask(cur, { kind: 'choice', prompt: `【黃天】交給 ${g.nameOf(p)} 一張【閃】或【閃電】？`, options: ['交給', '不交'] });
        if (yes !== 0) return;
        cur.turnFlags['黃天'] = true;
        const c = pool[0];
        cur.hand.splice(cur.hand.indexOf(c), 1);
        p.hand.push(c);
        g.log(`【黃天】${g.nameOf(cur)} 交給 ${g.nameOf(p)} ${C.cardText(c)}`, 'skill');
      },
    },
  };

  /* ── 魄襲：看手牌，棄共四張不同花色 ─────────────────────────── */
  SK['魄襲'] = {
    type: 'active',
    desc: '出牌階段限一次，你可以觀看一名其他角色的手牌，然後你可以棄置你與其手裡共計四張不同花色的牌。若如此做，根據你棄置你手裡的牌數執行如下效果：沒有，你減1點體力上限；一張，結束出牌階段且本回合你手牌上限-1；三張，你回復1點體力；四張，你摸四張牌。',
    canUse(g, p) { return !(p.turnFlags && p.turnFlags['魄襲']) && p.hand.length > 0 && g.others(p).some(q => q.hand.length > 0); },
    async active(g, p) {
      if (p.turnFlags['魄襲']) return;
      const t = await g.askTargets(p, { prompt: '【魄襲】觀看一名角色的手牌', min: 1, max: 1 });
      if (!t || !t.length) return;
      const tgt = t[0];
      p.turnFlags['魄襲'] = true;
      g.log(`【魄襲】${g.nameOf(tgt)} 的手牌：${tgt.hand.map(c => C.cardText(c)).join('、') || '（無）'}`, 'skill');
      const pool = [...p.hand.map(c => ({ c, from: 'me' })), ...tgt.hand.map(c => ({ c, from: 'them' }))];
      const suits = [...new Set(pool.map(x => x.c.suit))];
      if (suits.length < 4) { g.log('【魄襲】花色不足四種，無法發動', 'skill'); return; }
      const picks = [];
      for (const su of suits.slice(0, 4)) {
        const cand = pool.filter(x => x.c.suit === su && !picks.includes(x.c));
        if (cand.length) picks.push(cand[0].c);
      }
      const mine = picks.filter(c => p.hand.includes(c));
      const theirs = picks.filter(c => tgt.hand.includes(c));
      if (mine.length) g.consumeCards(p, mine, '魄襲');
      if (theirs.length) g.consumeCards(tgt, theirs, '魄襲');
      const n = mine.length;
      if (n === 0) g.loseMaxHp(p, 1);
      else if (n === 1) { p.turnFlags.skipPlay = true; p.turnFlags.handLimitX = (p.turnFlags.handLimitX || 0) - 1; }
      else if (n === 3) await g.heal(p, 1, '魄襲');
      else if (n === 4) g.drawCards(p, 4);
      g.log(`【魄襲】${g.nameOf(p)} 棄了自己 ${n} 張、對方 ${theirs.length} 張`, 'skill');
      g.update();
    },
  };

  /* ── 劫營：營標記的給予與回收 ───────────────────────────────── */
  SK['劫營'] = {
    type: 'trigger',
    desc: '回合開始時，若場上沒有“營”標記，你獲得一個“營”；結束階段，你可以用“營”標記一名角色；有“營”的角色摸牌階段多摸一張牌、出牌階段可以多使用一張【殺】、手牌上限+1；有“營”的角色回合結束後，你獲得“營”和其所有手牌。',
    events: {
      turnStart(g, ctx, p) {
        if (ctx.player !== p) return;
        const holder = g.players.find(q => mark(q, '營'));
        if (!holder) { addMark(p, '營', 1); g.log(`${g.nameOf(p)} 獲得「營」標記`, 'skill'); }
      },
      async turnEnd(g, ctx, p) {
        if (ctx.player !== p) {
          // 帶著「營」的角色回合結束後：技能持有者收回「營」與其所有手牌
          if (mark(ctx.player, '營') && mark(p, '營') === 0) {
            addMark(ctx.player, '營', -1);
            addMark(p, '營', 1);
            p.hand.push(...ctx.player.hand.splice(0));
            g.log(`【劫營】${g.nameOf(p)} 收回「營」，並獲得 ${g.nameOf(ctx.player)} 的所有手牌`, 'skill');
          }
          return;
        }
        if (!mark(p, '營')) return;
        const yes = await g.askSkill(p, '劫營', '【劫營】把「營」標記給一名角色？');
        if (!yes) return;
        const t = await g.askTargets(p, { prompt: '【劫營】選擇獲得「營」的角色', min: 1, max: 1 });
        if (!t || !t.length) return;
        addMark(p, '營', -1);
        addMark(t[0], '營', 1);
        g.log(`【劫營】「營」交給 ${g.nameOf(t[0])}`, 'skill');
      },
      drawCount(g, p, n) { return mark(p, '營') ? n + 1 : n; },
      turnEndHolder(g, ctx, p) {},
    },
  };

  /* ── 化身／新生／役鬼／汲魂：化身與魂 ───────────────────────── */
  const genPool = () => Object.values(root.SGS_GENERALS || {}).filter(x => x.name);
  SK['化身'] = {
    type: 'locked',
    desc: '遊戲開始時，你隨機獲得三張武將牌作為“化身”牌，然後亮出其中一張，獲得該“化身”牌的一個技能，且性別與勢力視為與該“化身”牌相同。回合開始時或結束後，你可以選擇：1.更改亮出的“化身”牌；2.移去至多兩張未亮出的“化身”牌，然後你獲得等量的技能。',
    events: {
      gameStart(g, ctx, p) {
        const pool = genPool().sort(() => Math.random() - 0.5).slice(0, 3);
        p.huanshen = pool.map(x => x.name);
        p.huanshenShown = 0;
        const gname = p.huanshen[0];
        const gen = root.SGS_GENERALS[gname];
        if (gen) {
          if (gen.kingdom) p.generals[0].kingdom = gen.kingdom;
          const sk = (gen.skills || [])[0];
          if (sk && !p.skills.includes(sk)) p.skills.push(sk);
          g.log(`${g.nameOf(p)} 化身亮出【${gname}】，獲得【${sk}】`, 'skill');
        }
      },
      async turnStart(g, ctx, p) {
        if (ctx.player !== p || !p.huanshen) return;
        const ch = await g.ask(p, { kind: 'choice', prompt: '【化身】是否變更？', options: ['更改亮出的化身', '不變更'], cancelable: true });
        if (ch !== 0) return;
        const gname = p.huanshen[Math.floor(Math.random() * p.huanshen.length)];
        const gen = root.SGS_GENERALS[gname];
        if (!gen) return;
        p.huanshenShown = p.huanshen.indexOf(gname);
        const sk = (gen.skills || [])[0];
        if (sk && !p.skills.includes(sk)) p.skills.push(sk);
        g.log(`【化身】${g.nameOf(p)} 改為【${gname}】，獲得【${sk}】`, 'skill');
      },
    },
  };
  SK['新生'] = {
    type: 'trigger',
    desc: '當你受到1點傷害後，你可以獲得一張新的“化身”牌。',
    events: {
      async damaged(g, ctx, p) {
        if (ctx.target !== p) return;
        const yes = await g.askSkill(p, '新生');
        if (!yes) return;
        const pool = genPool().filter(x => !(p.huanshen || []).includes(x.name));
        if (!pool.length) return;
        const one = pool[Math.floor(Math.random() * pool.length)];
        p.huanshen = p.huanshen || [];
        p.huanshen.push(one.name);
        g.log(`【新生】${g.nameOf(p)} 獲得新的化身【${one.name}】`, 'skill');
      },
    },
  };
  SK['役鬼'] = {
    type: 'active',
    desc: '當你首次明置此武將後，你將剩餘武將牌堆中的兩張武將牌扣置於武將牌上，稱為“魂”牌；你可以移去一張“魂”牌，視為使用任意一張基本牌或普通錦囊牌（此牌不得是本回合你以此法使用過的牌），且目標必須為與此“魂”牌勢力相同或未確定勢力的角色。',
    events: {
      gameStart(g, ctx, p) {
        p.hun = p.hun || 2;
        g.log(`${g.nameOf(p)} 獲得 2 張「魂」牌`, 'skill');
      },
    },
    canUse(g, p) { return (p.hun || 0) > 0 && g.others(p).length > 0; },
    async active(g, p) {
      if (!p.hun) return;
      const names = ['殺', '閃', '桃', '過河拆橋', '順手牽羊', '無中生有'];
      const ci = await g.ask(p, { kind: 'choice', prompt: '【役鬼】移去一張「魂」，視為使用：', options: names, cancelable: true });
      if (ci === null || ci === undefined) return;
      const used = p.turnFlags['役鬼用過'] = p.turnFlags['役鬼用過'] || [];
      const name = names[ci];
      if (used.includes(name)) { g.log(`【役鬼】本回合已用過【${name}】`, 'skill'); return; }
      used.push(name);
      p.hun -= 1;
      const card = { id: 'v役鬼' + Date.now(), name, virtual: true, subcards: [], suit: '♠', rank: 7, skill: '役鬼' };
      if (name === '殺') {
        const t = await g.askTargets(p, { prompt: '【役鬼】選擇目標', min: 1, max: 1 });
        if (t && t.length) await g.useShaOn(p, t[0], card);
      } else if (name === '桃') {
        if (p.hp < p.maxHp) await g.heal(p, 1, '役鬼');
      } else if (name === '無中生有') {
        await g.useTrick(p, card, card.name, [p]);
      } else {
        const t = await g.askTargets(p, { prompt: `【役鬼】選擇【${name}】的目標`, min: 1, max: 1 });
        if (t && t.length) await g.useTrick(p, card, card.name, t);
      }
      g.log(`【役鬼】${g.nameOf(p)} 移去一張「魂」當【${name}】（剩 ${p.hun}）`, 'skill');
      g.update();
    },
  };
  SK['汲魂'] = {
    type: 'trigger',
    desc: '當你受到傷害後，或與你勢力不同的角色進入瀕死狀態被救回後，你可以從剩餘武將牌堆中扣置一張牌加入到“魂”牌中。',
    events: {
      async damaged(g, ctx, p) {
        if (ctx.target !== p || !p.skills.includes('役鬼')) return;
        const yes = await g.askSkill(p, '汲魂');
        if (!yes) return;
        p.hun = (p.hun || 0) + 1;
        g.log(`【汲魂】${g.nameOf(p)} 增加一張「魂」（${p.hun}）`, 'skill');
      },
    },
  };

  /* ── 抨伐／復謀／選鋒：議事與「影」 ─────────────────────────── */
  SK['矜伐'] = {
    type: 'active',
    desc: '出牌階段限一次，你可以展示一張手牌，然後令所有體力上限不大於你的角色議事，若結果與此牌顏色相同，你令其中至多兩名角色將手牌摸至體力上限；不同，你獲得兩張【影】；若沒有角色與你意見相同，你可以變更勢力。',
    canUse(g, p) { return !(p.turnFlags && p.turnFlags['矜伐']) && p.hand.length > 0; },
    async active(g, p) {
      if (p.turnFlags['矜伐']) return;
      const c = await g.askCard(p, { prompt: '【矜伐】展示一張手牌', pool: p.hand.slice(), cancelable: true });
      if (!c) return;
      p.turnFlags['矜伐'] = true;
      p.turnFlags.ying = p.turnFlags.ying || 0;
      const voters = g.alive().filter(q => q !== p && q.maxHp <= p.maxHp);
      let agree = 0;
      for (const q of voters) {
        const ch = await g.ask(q, { kind: 'choice', prompt: `【矜伐】議事：${C.cardText(c)} 是紅還是黑？`, options: ['紅', '黑'] });
        const col = ch === 0 ? 'red' : 'black';
        if (col === c.color) agree++;
      }
      if (agree > 0) {
        const targets = g.alive().filter(q => q !== p && q.hand.length < q.maxHp).slice(0, 2);
        for (const q of targets) g.drawCards(q, q.maxHp - q.hand.length);
        g.log(`【矜伐】${agree} 人意見相同，令 ${targets.map(q => g.nameOf(q)).join('、') || '無人'} 摸牌至體力上限`, 'skill');
      } else {
        p.turnFlags.ying += 2;
        g.log(`【矜伐】意見不同，${g.nameOf(p)} 獲得 2 張【影】（共 ${p.turnFlags.ying}）`, 'skill');
      }
      g.update();
    },
  };
  SK['復謀'] = {
    type: 'active',
    desc: '議事結束後，與你意見不同的角色本回合不能使用或打出與其意見牌顏色相同的牌，你可以將一張【影】當【出其不意】對其中一名角色使用。',
    canUse(g, p) { return (p.turnFlags && p.turnFlags.ying > 0) && g.others(p).length > 0; },
    async active(g, p) {
      if (!(p.turnFlags.ying > 0)) return;
      const t = await g.askTargets(p, { prompt: '【復謀】將一張【影】當【出其不意】使用', min: 1, max: 1, cancelable: true });
      if (!t || !t.length) return;
      p.turnFlags.ying -= 1;
      const card = { id: 'v復謀' + Date.now(), name: '過河拆橋', virtual: true, subcards: [], suit: '♠', rank: 7, skill: '復謀' };
      await g.useTrick(p, card, card.name, t);
      g.log(`【復謀】${g.nameOf(p)} 以【影】當【出其不意】（影剩 ${p.turnFlags.ying}）`, 'skill');
      g.update();
    },
  };
  SK['選鋒'] = {
    type: 'active',
    desc: '你可以將一張【影】當無距離次數限制的刺【殺】使用。',
    canUse(g, p) { return (p.turnFlags && p.turnFlags.ying > 0) && g.others(p).length > 0; },
    async active(g, p) {
      if (!(p.turnFlags.ying > 0)) return;
      const t = await g.askTargets(p, { prompt: '【選鋒】以【影】當【殺】', min: 1, max: 1, cancelable: true });
      if (!t || !t.length) return;
      p.turnFlags.ying -= 1;
      p.turnFlags.shaNoRange = true;
      const card = { id: 'v選鋒' + Date.now(), name: '殺', type: 'basic', virtual: true, subcards: [], suit: '♠', rank: 7, skill: '選鋒' };
      await g.useShaOn(p, t[0], card);
      g.log(`【選鋒】${g.nameOf(p)} 以【影】當【殺】（影剩 ${p.turnFlags.ying}）`, 'skill');
      g.update();
    },
  };

  /* ── 遺志／天覆 ─────────────────────────────────────────── */
  SK['遺志'] = {
    type: 'locked',
    desc: '副將技，若你的主將擁有“觀星”，則將其描述中的X改為5，否則你視為擁有“觀星”。',
    events: {
      gameStart(g, ctx, p) {
        if (!p.skills.includes('觀星')) p.skills.push('觀星');
        p.guanxingMax = 5;
        g.log(`${g.nameOf(p)} 因【遺志】獲得【觀星】（X 視為 5）`, 'skill');
      },
    },
  };
  SK['天覆'] = {
    type: 'lord',
    desc: '主將技，陣法技，與你處於同一隊列的角色回合內，你視為擁有“看破”。（本作無隊列，改為常時擁有。）',
    events: {
      gameStart(g, ctx, p) {
        if (!p.skills.includes('看破')) p.skills.push('看破');
        g.log(`${g.nameOf(p)} 因【天覆】獲得【看破】`, 'skill');
      },
    },
  };

  /* ── 飄零／征榮／鴻舉／清側 ───────────────────────────────── */
  SK['飄零'] = {
    type: 'trigger',
    desc: '回合結束時，你可進行一次判定，若結果為♥，你將判定牌置於牌堆頂或交給一名角色，若該角色是你，你棄置一張牌。',
    events: {
      async turnEnd(g, ctx, p) {
        if (ctx.player !== p) return;
        const yes = await g.askSkill(p, '飄零');
        if (!yes) return;
        const jc = await g.judge(p, '飄零');
        if (!jc) return;
        const di = g.discardPile.indexOf(jc);
        if (di >= 0) g.discardPile.splice(di, 1);
        if (g.suitOf(p, jc) !== '♥') { g.deck.push(jc); return; }
        const ch = await g.ask(p, { kind: 'choice', prompt: '【飄零】判定牌放在哪裡？', options: ['牌堆頂', '交給一名角色'] });
        if (ch === 0) { g.putOnDeckTop([jc]); g.log(`【飄零】${C.cardText(jc)} 置於牌堆頂`, 'skill'); return; }
        const t = await g.askTargets(p, { prompt: '【飄零】交給一名角色', min: 1, max: 1 });
        const tgt = (t && t[0]) || p;
        tgt.hand.push(jc);
        if (tgt === p && p.hand.length) {
          const c = await g.askCard(p, { prompt: '【飄零】棄置一張牌', pool: p.hand.filter(x => x !== jc), cancelable: true });
          if (c) g.consumeCards(p, [c], '飄零');
        }
        g.log(`【飄零】${C.cardText(jc)} 交給 ${g.nameOf(tgt)}`, 'skill');
      },
    },
  };
  SK['征榮'] = {
    type: 'trigger',
    desc: '出牌階段，當你對其他角色使用偶數張牌後，你可以將一名其他角色的一張牌置於你的武將牌上，稱為“榮”。',
    events: {
      async cardUsed(g, ctx, p) {
        if (ctx.player !== p || g.phase !== 'play') return;
        if (!ctx.targets || !ctx.targets.some(t => t !== p)) return;
        p.turnFlags.zhengCount = (p.turnFlags.zhengCount || 0) + 1;
        if (p.turnFlags.zhengCount % 2 !== 0) return;
        const cands = g.alive().filter(q => q !== p && (q.hand.length || equipSlots.some(sl => q.equips[sl])));
        if (!cands.length) return;
        const yes = await g.askSkill(p, '征榮');
        if (!yes) return;
        const q = cands[Math.floor(Math.random() * cands.length)];
        const pool = [...q.hand, ...equipSlots.map(sl => q.equips[sl]).filter(Boolean)];
        const c = pool[Math.floor(Math.random() * pool.length)];
        if (c.slot && q.equips[c.slot] === c) { q.equips[c.slot] = null; g.onEquipChange && g.onEquipChange(q); }
        else { const i = q.hand.indexOf(c); if (i >= 0) q.hand.splice(i, 1); }
        p.rong = p.rong || [];
        p.rong.push(c);
        g.log(`【征榮】${g.nameOf(p)} 將 ${g.nameOf(q)} 的 ${C.cardText(c)} 置為「榮」（${p.rong.length}）`, 'skill');
      },
    },
  };
  SK['鴻舉'] = {
    type: 'awaken',
    desc: '覺醒技，準備階段，若“榮”的數量大於2且場上有角色死亡，則你摸等於“榮”數量的牌，然後以任意張手牌替換等量的“榮”，之後你減1點體力上限並獲得“清側”。',
    events: {
      async turnStart(g, ctx, p) {
        if (ctx.player !== p || p.awakenedHongju) return;
        const n = (p.rong || []).length;
        if (n <= 2) return;
        if (!g.players.some(q => !q.alive)) return;
        p.awakenedHongju = true;
        g.drawCards(p, n);
        g.loseMaxHp(p, 1);
        if (!p.skills.includes('清側')) p.skills.push('清側');
        g.log(`${g.nameOf(p)} 覺醒【鴻舉】：摸 ${n} 張、獲得【清側】`, 'skill');
        g.update();
      },
    },
  };
  SK['清側'] = {
    type: 'active',
    desc: '出牌階段，你可以移去一張“榮”，然後棄置場上的一張牌。',
    canUse(g, p) { return (p.rong || []).length > 0; },
    async active(g, p) {
      if (!(p.rong || []).length) return;
      const pool = [];
      for (const q of g.alive()) {
        pool.push(...q.hand.map(c => ({ q, c })));
        for (const sl of equipSlots) if (q.equips[sl]) pool.push({ q, c: q.equips[sl] });
      }
      if (!pool.length) return;
      const t = await g.askTargets(p, { prompt: '【清側】選擇棄置誰的牌', min: 1, max: 1 });
      if (!t || !t.length) return;
      const mine = pool.filter(x => x.q === t[0]);
      if (!mine.length) return;
      const one = mine[Math.floor(Math.random() * mine.length)];
      const removed = p.rong.pop();
      g.toDiscard([removed]);
      if (one.c.slot && one.q.equips[one.c.slot] === one.c) { one.q.equips[one.c.slot] = null; g.onEquipChange && g.onEquipChange(one.q); g.toDiscard([one.c]); }
      else g.consumeCards(one.q, [one.c], '清側');
      g.log(`【清側】${g.nameOf(p)} 移去一張「榮」，棄置 ${g.nameOf(one.q)} 的 ${C.cardText(one.c)}`, 'skill');
      g.update();
    },
  };

  /* ── 審時 ───────────────────────────────────────────────── */
  SK['審時'] = {
    type: 'trigger',
    desc: '轉換技，①出牌階段限一次，你可以將一張牌交給一名手牌數最多的角色，然後對其造成1點傷害；若該角色因此死亡，則你可以令一名角色將手牌摸至四張。②其他角色對你造成傷害後，你可以觀看該角色的手牌，然後交給其一張牌。',
    events: {
      async phaseStart(g, ctx, p) {
        if (ctx.player !== p || ctx.phase !== 'play') return;
        if (p.turnFlags['審時']) return;
        if (!p.hand.length) return;
        const maxH = Math.max(...g.alive().filter(q => q !== p).map(q => q.hand.length));
        const cands = g.alive().filter(q => q !== p && q.hand.length === maxH);
        if (!cands.length) return;
        const yes = await g.askSkill(p, '審時');
        if (!yes) return;
        p.turnFlags['審時'] = true;
        const t = await g.askTargets(p, { prompt: '【審時】交給手牌最多的一名角色一張牌', min: 1, max: 1, candidates: cands });
        if (!t || !t.length) return;
        const tgt = t[0];
        const c = await g.askCard(p, { prompt: '【審時】選擇交給的牌', pool: p.hand.slice(), cancelable: true });
        if (!c) return;
        p.hand.splice(p.hand.indexOf(c), 1);
        tgt.hand.push(c);
        const hp0 = tgt.hp;
        await g.damage(p, tgt, 1, 'normal', null);
        g.log(`【審時】${g.nameOf(p)} 交給 ${g.nameOf(tgt)} ${C.cardText(c)} 並造成 1 點傷害`, 'skill');
        if (!tgt.alive) {
          const t2 = await g.askTargets(p, { prompt: '【審時】令一名角色將手牌摸至四張', min: 1, max: 1, cancelable: true });
          if (t2 && t2.length) g.drawCards(t2[0], Math.max(0, 4 - t2[0].hand.length));
        }
      },
      async damaged(g, ctx, p) {
        if (ctx.target !== p || !ctx.source || ctx.source === p) return;
        if (p.turnFlags['審時乙']) return;
        const yes = await g.askSkill(p, '審時', '【審時】觀看傷害來源的手牌並交給其一張牌？');
        if (!yes) return;
        p.turnFlags['審時乙'] = true;
        g.log(`【審時】${g.nameOf(ctx.source)} 的手牌：${ctx.source.hand.map(c => C.cardText(c)).join('、') || '（無）'}`, 'skill');
        if (!p.hand.length) return;
        const c = p.hand[Math.floor(Math.random() * p.hand.length)];
        p.hand.splice(p.hand.indexOf(c), 1);
        ctx.source.hand.push(c);
        g.log(`【審時】${g.nameOf(p)} 交給 ${g.nameOf(ctx.source)} ${C.cardText(c)}`, 'skill');
      },
    },
  };

  /* ── 締盟：交換兩名角色的手牌 ─────────────────────────────── */
  SK['締盟'] = {
    type: 'active',
    desc: '出牌階段限一次，你可以選擇兩名其他角色並棄置X張牌（X為這兩名角色手牌數的差），然後令這兩名角色交換手牌。',
    canUse(g, p) { return !(p.turnFlags && p.turnFlags['締盟']) && g.others(p).length >= 2; },
    async active(g, p) {
      if (p.turnFlags['締盟']) return;
      const t = await g.askTargets(p, { prompt: '【締盟】選擇兩名角色', min: 2, max: 2 });
      if (!t || t.length < 2) return;
      const x = Math.abs(t[0].hand.length - t[1].hand.length);
      if (p.hand.length < x) { g.log(`【締盟】需要棄 ${x} 張牌，手牌不足`, 'skill'); return; }
      if (x > 0) {
        const cs = await g.askCards(p, { min: x, max: x, pool: p.hand.slice(), prompt: `【締盟】棄置 ${x} 張牌` });
        if (!cs || cs.length < x) return;
        g.consumeCards(p, cs, '締盟');
      }
      p.turnFlags['締盟'] = true;
      const a = t[0].hand.splice(0), b = t[1].hand.splice(0);
      t[0].hand.push(...b);
      t[1].hand.push(...a);
      g.log(`【締盟】${g.nameOf(t[0])} 與 ${g.nameOf(t[1])} 交換手牌`, 'skill');
      g.update();
    },
  };

  /* ── 國戰專用（本作身份局無地形／計分／帥旗／射程機制）────────── */
  gzSkill('固城', '鎖定技，敵方角色無法因任何效果進入你所在的地形。');
  gzSkill('衝殺', '移動階段，可以進入有敵方角色存在的地形，並將敵方角色向你的移動方向移動1格。若其無法如此做，你的移動立即結束，將其放置在距離其最近的任意可放置地形，然後你對其造成1點傷害。');
  gzSkill('退守', '當你的對手得分時，你可以棄置一張手牌令其所得分數-1。');
  gzSkill('神弓', '你的【殺】可以當射【殺】使用，但不能指定位於大本營的角色為目標。');
  gzSkill('良姻', '當有牌移出遊戲時，你可以令手牌數大於你的一名角色摸一張牌；當有牌從遊戲外加入任意角色的手牌時，你可以令手牌數小於你的一名角色棄置一張牌。');

  const DONE11 = ['兵威', '蠱惑', '纏鬥', '解圍', '箜聲', '擇主', '立軍', '制霸', '黃天', '魄襲', '劫營', '化身', '新生', '役鬼', '汲魂', '矜伐', '復謀', '選鋒', '遺志', '天覆', '飄零', '征榮', '鴻舉', '清側', '審時', '締盟', '固城', '衝殺', '退守', '神弓', '良姻'];
  for (const n of DONE11) if (SK[n]) { delete SK[n].todo; SK[n].impl = true; }
  root.SGS_SKILLS_DONE = (root.SGS_SKILLS_DONE || []).concat(DONE11);

  const DONE = ['血裔', '據守', '狂骨', '破虜', '烈弓', '直諫', '固政', '英魂'];
  for (const n of DONE) if (SK[n]) { delete SK[n].todo; SK[n].impl = true; }
  root.SGS_SKILLS_DONE = (root.SGS_SKILLS_DONE || []).concat(DONE);
})(typeof window !== 'undefined' ? window : globalThis);
