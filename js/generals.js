/* 三國殺 · 武將包 + 技能
   pack: std(標) / jie(界限突破) / god(神) / sp / famous(一將成名) / custom
   技能統一註冊在 SGS_SKILLS，轉化牌註冊在 SGS_CONVERT。
*/
(function (root) {
  'use strict';
  const C = root.SGS_CARDS;
  const isRed = C.isRed, isBlack = C.isBlack;
  const SK = root.SGS_SKILLS = root.SGS_SKILLS || {};
  const CV = root.SGS_CONVERT = root.SGS_CONVERT || [];

  const SHA_NAMES = ['殺', '火殺', '雷殺'];
  const isShaCard = (c) => SHA_NAMES.includes(c.name);

  // 只挑自己人（AI 才不會把好處送給敵人）
  function friendly(g, p, list) {
    const ai = p.controller;
    if (ai && typeof ai.isFriend === 'function') return list.filter(q => q === p || ai.isFriend(g, p, q));
    return list;
  }

  // 取得目標的一張手牌（面朝下，隨機）
  function randomHandCard(g, p) {
    if (!p.hand.length) return null;
    return p.hand[Math.floor(g.rand() * p.hand.length)];
  }

  /* =====================================================================
     標準包 · 蜀
     ===================================================================== */

  SK['仁德'] = {
    type: 'active',
    desc: '出牌階段，你可以將任意張手牌交給其他角色。若本回合累計交出不少於兩張，你回復 1 點體力。',
    canUse(g, p) { return p.hand.length > 0 && g.others(p).length > 0; },
    async active(g, p) {
      const cards = await g.askCards(p, { min: 1, max: 6, prompt: '【仁德】選擇要交出的手牌', cancelable: true });
      if (!cards.length) return;
      const cands = friendly(g, p, g.others(p));
      if (!cands.length) return;
      const tg = await g.askTargets(p, { prompt: '【仁德】選擇獲得這些牌的角色', candidates: cands });
      if (!tg.length) return;
      for (const c of cards) {
        const i = p.hand.indexOf(c);
        if (i >= 0) p.hand.splice(i, 1);
        tg[0].hand.push(c);
      }
      p.turnFlags.rende = (p.turnFlags.rende || 0) + cards.length;
      g.log(`${g.nameOf(p)} 發動【仁德】，交給 ${g.nameOf(tg[0])} ${cards.length} 張牌`, 'skill');
      if (p.turnFlags.rende >= 2 && !p.turnFlags.rendeHeal) {
        p.turnFlags.rendeHeal = true;
        await g.heal(p, 1, '仁德');
      }
    },
  };

  SK['激將'] = {
    type: 'lord',
    desc: '主公技：需要打出【殺】時，可令蜀勢力角色代打。',
    assist: {
      need: '殺',
      async provide(g, p) {
        const allies = g.alive().filter(q => q !== p && q.generals.some(x => x.kingdom === '蜀') &&
          q.hand.some(c => isShaCard(c)));
        if (!allies.length) return null;
        for (const q of allies) {
          const r = await g.askForCard(q, '殺', { prompt: `主公 ${g.nameOf(p)} 發動【激將】，是否代打一張【殺】？`, cancelable: true });
          if (r) { g.consumeCards(q, r.cards, '殺'); g.log(`${g.nameOf(q)} 代打出【殺】`, 'skill'); return r.cards[0]; }
        }
        return null;
      },
    },
  };

  SK['武聖'] = { type: 'convert', desc: '你可以將一張紅色手牌當【殺】使用或打出。' };
  CV.push({ skill: '武聖', to: '殺', from: { color: 'red' } });

  SK['咆哮'] = {
    type: 'passive',
    desc: '鎖定技：你使用【殺】無次數限制。',
    shaLimit() { return 99; },
  };

  SK['龍膽'] = { type: 'convert', desc: '你可以將【殺】當【閃】、將【閃】當【殺】使用或打出。' };
  CV.push({ skill: '龍膽', to: '閃', from: { names: ['殺', '火殺', '雷殺'] } });
  CV.push({ skill: '龍膽', to: '殺', from: { names: ['閃'] } });

  SK['馬術'] = {
    type: 'passive',
    desc: '鎖定技：你計算與其他角色的距離 -1。',
    distance(g, p) { return -1; },
  };

  SK['鐵騎'] = {
    type: 'trigger',
    desc: '當你使用【殺】指定目標後，可判定：若為紅色，該角色不能使用【閃】。',
    events: {
      async shaTargeted(g, ctx, p) {
        if (ctx.source !== p || !isShaCard(ctx.card)) return;
        const jc = await g.judge(p, '鐵騎');
        if (jc && isRed(jc)) {
          ctx.noShan = true;
          g.log(`【鐵騎】生效：${g.nameOf(ctx.target)} 不能使用【閃】`, 'skill');
        }
      },
    },
  };

  SK['集智'] = {
    type: 'trigger',
    desc: '當你使用錦囊牌時，你可以摸一張牌。',
    events: {
      async cardUsed(g, ctx, p) {
        if (ctx.player !== p || ctx.card.type !== 'trick') return;
        g.drawCards(p, 1, '集智');
      },
    },
  };

  SK['奇才'] = {
    type: 'passive',
    desc: '鎖定技：你使用錦囊牌無距離限制。',
    ignoreTrickDistance() { return true; },
  };

  SK['觀星'] = {
    type: 'trigger',
    desc: '回合開始時，你可以觀看牌堆頂至多五張牌，將任意張以任意順序置於牌堆頂或堆底。',
    events: {
      async turnStart(g, ctx, p) {
        const n = Math.min(5, g.deck.length);
        if (n === 0) return;
        const top = g.deck.slice(g.deck.length - n).reverse(); // top first
        g.deck.splice(g.deck.length - n, n);
        const ids = await g.ask(p, {
          kind: 'cards', prompt: `【觀星】觀看牌堆頂 ${n} 張，選出要放到牌堆底的牌（其餘留在頂部，可不選）`,
          cards: top.map(c => c.id),
          cardData: top.map(c => ({ id: c.id, name: c.name, suit: c.suit, rank: c.rank, color: c.color })),
          min: 0, max: n, cancelable: true,
        });
        const bottomIds = ids || [];
        const bottomArr = top.filter(c => bottomIds.includes(c.id));
        const rest = top.filter(c => !bottomIds.includes(c.id));
        g.deck.push(...bottomArr.slice().reverse(), ...rest.slice().reverse());
        g.log(`${g.nameOf(p)} 發動【觀星】：${rest.length} 張置頂、${bottomArr.length} 張置底`, 'skill');
      },
    },
  };

  SK['空城'] = {
    type: 'passive',
    desc: '鎖定技：若你沒有手牌，你不能成為【殺】或【決鬥】的目標。',
    cannotBeTargeted(g, p, source, cardName) {
      return p.hand.length === 0 && (cardName === '殺' || isShaCard({ name: cardName }) || cardName === '決鬥');
    },
  };

  /* =====================================================================
     標準包 · 魏
     ===================================================================== */

  SK['奸雄'] = {
    type: 'trigger',
    desc: '當你受到傷害後，你可以獲得造成此傷害的牌。',
    events: {
      async damaged(g, ctx, p) {
        if (ctx.target !== p || !ctx.card) return;
        const card = ctx.card;
        const i = g.discardPile.indexOf(card);
        if (i < 0) return;
        const yes = await g.askSkill(p, '奸雄');
        if (!yes) return;
        g.discardPile.splice(i, 1);
        const real = card.virtual && card.subcards ? card.subcards : [card];
        for (const c of real) { const j = g.discardPile.indexOf(c); if (j >= 0) g.discardPile.splice(j, 1); p.hand.push(c); }
        g.log(`${g.nameOf(p)} 發動【奸雄】，獲得 ${C.cardText(card)}`, 'skill');
      },
    },
  };

  SK['護駕'] = {
    type: 'lord',
    desc: '主公技：需要打出【閃】時，可令魏勢力角色代打。',
    assist: {
      need: '閃',
      async provide(g, p) {
        const allies = g.alive().filter(q => q !== p && q.generals.some(x => x.kingdom === '魏') &&
          (q.hand.some(c => c.name === '閃') || (q.skills.includes('傾國') && q.hand.some(c => isBlack(c)))));
        for (const q of allies) {
          const r = await g.askForCard(q, '閃', { prompt: `主公 ${g.nameOf(p)} 發動【護駕】，是否代打一張【閃】？`, cancelable: true });
          if (r) { g.consumeCards(q, r.cards, '閃'); g.log(`${g.nameOf(q)} 代打出【閃】`, 'skill'); return r.cards[0]; }
        }
        return null;
      },
    },
  };

  SK['反饋'] = {
    type: 'trigger',
    desc: '當你受到傷害後，你可以獲得傷害來源的一張牌。',
    events: {
      async damaged(g, ctx, p) {
        if (ctx.target !== p || !ctx.source || !ctx.source.alive) return;
        const src = ctx.source;
        const total = src.hand.length + ['weapon', 'armor', 'horse+', 'horse-', 'treasure'].filter(s => src.equips[s]).length;
        if (total === 0) return;
        const yes = await g.askSkill(p, '反饋');
        if (!yes) return;
        const card = await g.chooseCardFromPlayer(p, src, '【反饋】選擇獲得一張牌');
        if (!card) return;
        g.removeCardFromPlayer(src, card);
        p.hand.push(card);
        g.log(`${g.nameOf(p)} 發動【反饋】，獲得 ${g.nameOf(src)} 的一張牌`, 'skill');
      },
    },
  };

  SK['鬼才'] = {
    type: 'trigger',
    desc: '在一名角色的判定牌生效前，你可以打出一張手牌代替之。',
    events: {
      async judge(g, ctx, p) {
        if (!p.hand.length) return;
        if (ctx.player === p && ctx.reason === '洛神') return;
        const yes = await g.askSkill(p, '鬼才', `【鬼才】是否用一張手牌代替 ${g.nameOf(ctx.player)} 的判定牌？`);
        if (!yes) return;
        const c = await g.askCard(p, { prompt: '【鬼才】選擇一張手牌作為判定牌' });
        if (!c) return;
        p.hand.splice(p.hand.indexOf(c), 1);
        ctx.replaced = true;
        ctx.old = ctx.card;
        ctx.card = c;
        g.log(`${g.nameOf(p)} 發動【鬼才】，改判為 ${C.cardText(c)}`, 'skill');
      },
    },
  };

  SK['剛烈'] = {
    type: 'trigger',
    desc: '當你受到傷害後，你可以進行判定：若結果不為紅桃，傷害來源選擇棄置兩張牌或受到你造成的 1 點傷害。',
    events: {
      async damaged(g, ctx, p) {
        if (ctx.target !== p || !ctx.source || !ctx.source.alive) return;
        const yes = await g.askSkill(p, '剛烈');
        if (!yes) return;
        const jc = await g.judge(p, '剛烈');
        if (!jc || jc.suit === '♥') { g.log('【剛烈】判定失敗'); return; }
        const src = ctx.source;
        const total = src.hand.length + ['weapon', 'armor', 'horse+', 'horse-', 'treasure'].filter(s => src.equips[s]).length;
        if (total >= 2) {
          const ch = await g.ask(src, {
            kind: 'choice', prompt: `【剛烈】${g.nameOf(p)} 令你棄置兩張牌，否則受到 1 點傷害`,
            options: ['棄置兩張牌', '受到傷害'], cancelable: false,
          });
          if (ch === 0) {
            const cards = await g.askCards(src, { min: 2, max: 2, prompt: '【剛烈】棄置兩張牌', from: 'any', cancelable: false });
            if (cards.length >= 2) {
              g.consumeCards(src, cards, '剛烈');
              g.log(`${g.nameOf(src)} 棄置兩張牌`, 'skill');
              return;
            }
          }
        }
        await g.damage(p, src, 1, 'normal', null);
      },
    },
  };

  SK['突襲'] = {
    type: 'trigger',
    desc: '摸牌階段，你可以改為獲得至多兩名其他角色各一張手牌。',
    events: {
      async phaseStart(g, ctx, p) {
        if (ctx.player !== p || ctx.phase !== 'draw') return;
        const cands = g.others(p).filter(q => q.hand.length > 0);
        if (!cands.length) return;
        const yes = await g.askSkill(p, '突襲', '是否發動【突襲】取代摸牌？');
        if (!yes) return;
        p.turnFlags.skipDraw = true;
        const tg = await g.askTargets(p, { prompt: '【突襲】選擇至多兩名角色', candidates: cands, min: 1, max: 2 });
        for (const q of tg) {
          const c = randomHandCard(g, q);
          if (!c) continue;
          q.hand.splice(q.hand.indexOf(c), 1);
          p.hand.push(c);
          g.log(`${g.nameOf(p)} 從 ${g.nameOf(q)} 獲得一張手牌`, 'skill');
        }
      },
    },
  };

  SK['裸衣'] = {
    type: 'trigger',
    desc: '摸牌階段，你可以少摸一張牌；若如此做，本回合你使用【殺】或【決鬥】造成的傷害 +1。',
    events: {
      async phaseStart(g, ctx, p) {
        if (ctx.player !== p || ctx.phase !== 'draw') return;
        const yes = await g.askSkill(p, '裸衣', '是否發動【裸衣】（少摸一張，本回合傷害 +1）？');
        if (!yes) return;
        p.turnFlags.skipDraw = true;
        const n = p.modDrawCount ? p.modDrawCount(2) : 2;
        g.drawCards(p, Math.max(0, n - 1), '裸衣');
        p.turnFlags.luoyi = true;
        g.log(`${g.nameOf(p)} 發動【裸衣】，本回合【殺】傷害 +1`, 'skill');
      },
    },
  };

  SK['天妒'] = {
    type: 'trigger',
    desc: '當你的判定牌生效後，你可以獲得之。',
    events: {
      async judge(g, ctx, p) {
        if (ctx.player !== p || ctx.gain) return;
        ctx.gain = p;
        g.log(`${g.nameOf(p)} 發動【天妒】，獲得判定牌 ${C.cardText(ctx.card)}`, 'skill');
      },
    },
  };

  SK['遺計'] = {
    type: 'trigger',
    desc: '當你受到傷害後，你可以摸兩張牌，然後將這些牌交給任意角色。',
    events: {
      async damaged(g, ctx, p) {
        if (ctx.target !== p) return;
        const yes = await g.askSkill(p, '遺計');
        if (!yes) return;
        const cards = g.drawCards(p, 2, '遺計');
        for (const c of cards) {
          const tg = await g.askTargets(p, {
            prompt: `【遺計】將 ${C.cardText(c)} 交給一名角色（或選自己保留）`,
            candidates: g.alive(), cancelable: true,
          });
          if (!tg.length) break;
          if (tg[0] === p) continue;
          const i = p.hand.indexOf(c);
          if (i >= 0) { p.hand.splice(i, 1); tg[0].hand.push(c); g.log(`${C.cardText(c)} → ${g.nameOf(tg[0])}`, 'skill'); }
        }
      },
    },
  };

  SK['傾國'] = { type: 'convert', desc: '你可以將一張黑色手牌當【閃】使用或打出。' };
  CV.push({ skill: '傾國', to: '閃', from: { color: 'black' } });

  SK['洛神'] = {
    type: 'trigger',
    desc: '回合開始時，你可以進行判定：若為黑色，你獲得此牌並可重複此流程。',
    events: {
      async turnStart(g, ctx, p) {
        const yes = await g.askSkill(p, '洛神', '是否發動【洛神】？');
        if (!yes) return;
        let guard = 0;
        while (guard++ < 10) {
          let jc = await g.judge(p, '洛神');
          if (!jc) break;
          if (isBlack(jc)) {
            const di = g.discardPile.indexOf(jc);
            if (di >= 0) g.discardPile.splice(di, 1);
            if (!p.hand.includes(jc)) p.hand.push(jc);
            g.log(`${g.nameOf(p)} 獲得 ${C.cardText(jc)}`, 'skill');
          } else break;
        }
      },
    },
  };

  /* =====================================================================
     標準包 · 吳
     ===================================================================== */

  SK['制衡'] = {
    type: 'active',
    once: true,
    desc: '出牌階段限一次，你可以棄置任意張牌，然後摸等量的牌。',
    canUse(g, p) {
      const total = p.hand.length + ['weapon', 'armor', 'horse+', 'horse-', 'treasure'].filter(s => p.equips[s]).length;
      return total > 0 && !p.turnFlags.zhiheng;
    },
    async active(g, p) {
      const cards = await g.askCards(p, { min: 1, max: 8, prompt: '【制衡】選擇要棄置的牌', from: 'any', cancelable: true });
      if (!cards.length) return;
      p.turnFlags.zhiheng = true;
      g.consumeCards(p, cards, '制衡');
      g.drawCards(p, cards.length, '制衡');
      g.log(`${g.nameOf(p)} 發動【制衡】，棄 ${cards.length} 摸 ${cards.length}`, 'skill');
    },
  };

  SK['救援'] = {
    type: 'lord',
    desc: '主公技：其他吳勢力角色於你瀕死時使用【桃】，你額外回復 1 點體力。',
    events: {
      async healedBy(g, ctx, p) { /* 由 engine heal 觸發，簡化處理 */ },
    },
  };

  SK['奇襲'] = { type: 'convert', desc: '出牌階段，你可以將一張黑色手牌當【過河拆橋】使用。' };
  CV.push({ skill: '奇襲', to: '過河拆橋', from: { color: 'black' } });

  SK['克己'] = {
    type: 'trigger',
    desc: '若你於出牌階段未使用或打出過【殺】，你可以跳過棄牌階段。',
    events: {
      async turnEnd(g, ctx, p) {
        if (ctx.player !== p) return;
        if (ctx.phaseEnd) return;
      },
    },
  };
  SK['克己'].handLimit = function (g, p, lim) {
    if (!p.turnFlags) return lim;
    return p.turnFlags.shaUsed ? lim : 999;
  };

  SK['苦肉'] = {
    type: 'active',
    desc: '出牌階段，你可以失去 1 點體力，然後摸兩張牌。',
    canUse(g, p) { return p.hp > 1; },
    async active(g, p) {
      await g.loseHp(p, 1, '苦肉');
      if (!p.alive) return;
      g.drawCards(p, 2, '苦肉');
      g.log(`${g.nameOf(p)} 發動【苦肉】`, 'skill');
    },
  };

  SK['英姿'] = {
    type: 'passive',
    desc: '摸牌階段，你多摸一張牌。',
    drawCount(g, p, n) { return n + 1; },
  };

  SK['反間'] = {
    type: 'active',
    once: true,
    desc: '出牌階段限一次，你可以令一名角色選擇一種花色，然後獲得你的一張手牌；若花色不同，該角色受到 1 點傷害。',
    canUse(g, p) { return p.hand.length > 0 && g.others(p).length > 0 && !p.turnFlags.fanjian; },
    async active(g, p) {
      const tg = await g.askTargets(p, { prompt: '【反間】選擇一名角色', cancelable: true });
      if (!tg.length) return;
      const card = await g.askCard(p, { prompt: '【反間】選擇一張手牌交給該角色（暗置）', cancelable: true });
      if (!card) return;
      p.turnFlags.fanjian = true;
      p.hand.splice(p.hand.indexOf(card), 1);
      const t = tg[0];
      const guess = await g.ask(t, {
        kind: 'choice', prompt: '【反間】：請選擇一種花色', options: ['♠', '♥', '♣', '♦'], cancelable: false,
      });
      const suits = ['♠', '♥', '♣', '♦'];
      t.hand.push(card);
      g.log(`${g.nameOf(t)} 猜 ${suits[guess || 0]}，實際為 ${card.suit}`, 'skill');
      if (suits[guess || 0] !== card.suit) {
        await g.damage(p, t, 1, 'normal', null);
      }
    },
  };

  SK['國色'] = { type: 'convert', desc: '你可以將一張♦手牌當【樂不思蜀】使用。' };
  CV.push({ skill: '國色', to: '樂不思蜀', from: { suit: '♦' } });

  SK['流離'] = {
    type: 'trigger',
    desc: '當你成為【殺】的目標時，你可以棄置一張牌，將此【殺】轉移給另一名角色。',
    events: {
      async shaTargeted(g, ctx, p) {
        if (ctx.target !== p || ctx.source === p) return;
        const others = g.alive().filter(q => q !== p && q !== ctx.source);
        if (!others.length) return;
        const total = p.hand.length + ['weapon', 'armor', 'horse+', 'horse-', 'treasure'].filter(s => p.equips[s]).length;
        if (!total) return;
        const yes = await g.askSkill(p, '流離', '是否發動【流離】轉移這張【殺】？');
        if (!yes) return;
        const card = await g.askCard(p, { prompt: '【流離】棄置一張牌', from: 'any', cancelable: true });
        if (!card) return;
        g.consumeCards(p, [card], '流離');
        const tg = await g.askTargets(p, { prompt: '【流離】將【殺】轉移給', candidates: others });
        if (!tg.length) return;
        ctx.target = tg[0];
        g.log(`${g.nameOf(p)} 發動【流離】，轉移給 ${g.nameOf(tg[0])}`, 'skill');
      },
    },
  };

  SK['謙遜'] = {
    type: 'passive',
    desc: '鎖定技：你不能成為【順手牽羊】或【樂不思蜀】的目標。',
    cannotBeTargeted(g, p, source, cardName) {
      return cardName === '順手牽羊' || cardName === '樂不思蜀';
    },
  };

  SK['連營'] = {
    type: 'trigger',
    desc: '當你失去最後一張手牌時，你可以摸一張牌。',
    events: {
      async handEmpty(g, ctx, p) {
        g.drawCards(p, 1, '連營');
      },
    },
  };

  SK['結姻'] = {
    type: 'active',
    once: true,
    desc: '出牌階段限一次，你可以棄置兩張手牌，令一名男性角色回復 1 點體力。',
    canUse(g, p) {
      return p.hand.length >= 2 && !p.turnFlags.jieyin &&
        g.alive().some(q => q.generals.some(x => x.gender === 'male') && q.hp < q.maxHp);
    },
    async active(g, p) {
      const cards = await g.askCards(p, { min: 2, max: 2, prompt: '【結姻】棄置兩張手牌', cancelable: true });
      if (cards.length < 2) return;
      const cand = friendly(g, p, g.alive().filter(q => q.generals.some(x => x.gender === 'male') && q.hp < q.maxHp));
      if (!cand.length) return;
      const tg = await g.askTargets(p, {
        prompt: '【結姻】選擇一名男性角色回復體力',
        candidates: cand,
        cancelable: true,
      });
      if (!tg.length) return;
      p.turnFlags.jieyin = true;
      g.consumeCards(p, cards, '結姻');
      await g.heal(tg[0], 1, '結姻');
    },
  };

  SK['梟姬'] = {
    type: 'trigger',
    desc: '當你失去裝備區裡的牌時，你可以摸兩張牌。',
    events: {
      async equipLost(g, ctx, p) {
        g.drawCards(p, 2, '梟姬');
      },
    },
  };

  /* =====================================================================
     標準包 · 群
     ===================================================================== */

  SK['急救'] = { type: 'convert', desc: '你的回合外，你可以將一張紅色牌當【桃】使用。' };
  CV.push({
    skill: '急救', to: '桃', from: { color: 'red' },
    when(g, p) { return g.current !== p; },
  });

  SK['青囊'] = {
    type: 'active',
    once: true,
    desc: '出牌階段限一次，你可以棄置一張手牌，令一名角色回復 1 點體力。',
    canUse(g, p) { return p.hand.length > 0 && !p.turnFlags.qingnang && g.alive().some(q => q.hp < q.maxHp); },
    async active(g, p) {
      const card = await g.askCard(p, { prompt: '【青囊】棄置一張手牌', cancelable: true });
      if (!card) return;
      const cand = friendly(g, p, g.alive().filter(q => q.hp < q.maxHp));
      if (!cand.length) return;
      const tg = await g.askTargets(p, {
        prompt: '【青囊】選擇回復體力的角色', candidates: cand, cancelable: true,
      });
      if (!tg.length) return;
      p.turnFlags.qingnang = true;
      p.hand.splice(p.hand.indexOf(card), 1);
      g.toDiscard([card]);
      await g.heal(tg[0], 1, '青囊');
    },
  };

  SK['無雙'] = {
    type: 'passive',
    desc: '鎖定技：你使用【殺】時，目標需連續使用兩張【閃】；你與他人【決鬥】時，對方需連續打出兩張【殺】。',
    shanNeeded() { return 2; },
    juedouNeeded() { return 2; },
  };

  SK['離間'] = {
    type: 'active',
    once: true,
    desc: '出牌階段限一次，你可以棄置一張牌，令兩名男性角色視為互相【決鬥】。',
    canUse(g, p) {
      const males = g.others(p).filter(q => q.generals.some(x => x.gender === 'male'));
      const total = p.hand.length + ['weapon', 'armor', 'horse+', 'horse-', 'treasure'].filter(s => p.equips[s]).length;
      return males.length >= 2 && total > 0 && !p.turnFlags.lijian;
    },
    async active(g, p) {
      const card = await g.askCard(p, { prompt: '【離間】棄置一張牌', from: 'any', cancelable: true });
      if (!card) return;
      const males = g.others(p).filter(q => q.generals.some(x => x.gender === 'male'));
      if (males.length < 2) return;
      const a = await g.askTargets(p, { prompt: '【離間】選擇第一名男性角色', candidates: males });
      if (!a.length) return;
      const b = await g.askTargets(p, { prompt: '【離間】選擇第二名男性角色', candidates: males.filter(q => q !== a[0]) });
      if (!b.length) return;
      p.turnFlags.lijian = true;
      g.consumeCards(p, [card], '離間');
      g.log(`${g.nameOf(p)} 發動【離間】：${g.nameOf(a[0])} 與 ${g.nameOf(b[0])} 決鬥`, 'skill');
      await g.juedou(a[0], b[0], null);
    },
  };

  SK['閉月'] = {
    type: 'trigger',
    desc: '結束階段開始時，你可以摸一張牌。',
    events: {
      async turnEnd(g, ctx, p) {
        if (ctx.player !== p) return;
        g.drawCards(p, 1, '閉月');
      },
    },
  };

  /* =====================================================================
     武將資料（標準 25）
     ===================================================================== */
  const G = root.SGS_GENERALS = {
    // 蜀
    '劉備': { name: '劉備', kingdom: '蜀', hp: 4, gender: 'male', pack: 'std', skills: ['仁德', '激將'] },
    '關羽': { name: '關羽', kingdom: '蜀', hp: 4, gender: 'male', pack: 'std', skills: ['武聖'] },
    '張飛': { name: '張飛', kingdom: '蜀', hp: 4, gender: 'male', pack: 'std', skills: ['咆哮'] },
    '趙雲': { name: '趙雲', kingdom: '蜀', hp: 4, gender: 'male', pack: 'std', skills: ['龍膽'] },
    '馬超': { name: '馬超', kingdom: '蜀', hp: 4, gender: 'male', pack: 'std', skills: ['馬術', '鐵騎'] },
    '黃月英': { name: '黃月英', kingdom: '蜀', hp: 3, gender: 'female', pack: 'std', skills: ['集智', '奇才'] },
    '諸葛亮': { name: '諸葛亮', kingdom: '蜀', hp: 3, gender: 'male', pack: 'std', skills: ['觀星', '空城'] },
    // 魏
    '曹操': { name: '曹操', kingdom: '魏', hp: 4, gender: 'male', pack: 'std', skills: ['奸雄', '護駕'] },
    '司馬懿': { name: '司馬懿', kingdom: '魏', hp: 3, gender: 'male', pack: 'std', skills: ['反饋', '鬼才'] },
    '夏侯惇': { name: '夏侯惇', kingdom: '魏', hp: 4, gender: 'male', pack: 'std', skills: ['剛烈'] },
    '張遼': { name: '張遼', kingdom: '魏', hp: 4, gender: 'male', pack: 'std', skills: ['突襲'] },
    '許褚': { name: '許褚', kingdom: '魏', hp: 4, gender: 'male', pack: 'std', skills: ['裸衣'] },
    '郭嘉': { name: '郭嘉', kingdom: '魏', hp: 3, gender: 'male', pack: 'std', skills: ['天妒', '遺計'] },
    '甄姬': { name: '甄姬', kingdom: '魏', hp: 3, gender: 'female', pack: 'std', skills: ['傾國', '洛神'] },
    // 吳
    '孫權': { name: '孫權', kingdom: '吳', hp: 4, gender: 'male', pack: 'std', skills: ['制衡', '救援'] },
    '甘寧': { name: '甘寧', kingdom: '吳', hp: 4, gender: 'male', pack: 'std', skills: ['奇襲'] },
    '呂蒙': { name: '呂蒙', kingdom: '吳', hp: 4, gender: 'male', pack: 'std', skills: ['克己'] },
    '黃蓋': { name: '黃蓋', kingdom: '吳', hp: 4, gender: 'male', pack: 'std', skills: ['苦肉'] },
    '周瑜': { name: '周瑜', kingdom: '吳', hp: 3, gender: 'male', pack: 'std', skills: ['英姿', '反間'] },
    '大喬': { name: '大喬', kingdom: '吳', hp: 3, gender: 'female', pack: 'std', skills: ['國色', '流離'] },
    '陸遜': { name: '陸遜', kingdom: '吳', hp: 3, gender: 'male', pack: 'std', skills: ['謙遜', '連營'] },
    '孫尚香': { name: '孫尚香', kingdom: '吳', hp: 3, gender: 'female', pack: 'std', skills: ['結姻', '梟姬'] },
    // 群
    '華佗': { name: '華佗', kingdom: '群', hp: 3, gender: 'male', pack: 'std', skills: ['急救', '青囊'] },
    '呂布': { name: '呂布', kingdom: '群', hp: 4, gender: 'male', pack: 'std', skills: ['無雙'] },
    '貂蟬': { name: '貂蟬', kingdom: '群', hp: 3, gender: 'female', pack: 'std', skills: ['離間', '閉月'] },
  };

  // 武將包顯示名稱
  root.SGS_PACK_NAMES = {
    std: '標準（標將）', jie: '界限突破（界將）', god: '神將', sp: 'SP 將', famous: '一將成名', custom: '自定義',
  };
})(typeof window !== 'undefined' ? window : globalThis);
