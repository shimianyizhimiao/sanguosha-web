/* 三國殺 · 擴充武將包：界將（界限突破）、神將、SP、一將成名
   載入順序：generals.js → generals-extra.js
*/
(function (root) {
  'use strict';
  const C = root.SGS_CARDS;
  const isRed = C.isRed, isBlack = C.isBlack;
  const SK = root.SGS_SKILLS;
  const CV = root.SGS_CONVERT;
  const G = root.SGS_GENERALS;
  const SHA = ['殺', '火殺', '雷殺'];

  /* =========================================================
     界限突破 · 新技能
     ========================================================= */

  // 界劉備 · 仁德（官方描述）：出牌階段每名角色限一次，可交給一名其他角色任意張手牌；
  // 若此次給出了本階段的第二張「仁德」牌，你可以視為使用一張基本牌。
  SK['仁德·界'] = {
    type: 'active',
    desc: '出牌階段每名角色限一次，你可以交給一名其他角色任意張手牌；若你此次給出了本階段的第二張「仁德」牌，你可以視為使用一張基本牌（殺／桃／酒）。',
    canUse(g, p) {
      return p.hand.length > 0 && g.others(p).some(q => !(p.turnFlags.rendeTo || {})[q.id]);
    },
    async active(g, p) {
      const tg = await g.askTargets(p, {
        prompt: '【仁德】選擇要交給手牌的角色（本階段每人限一次）',
        candidates: g.others(p).filter(q => !(p.turnFlags.rendeTo || {})[q.id]),
        cancelable: true,
      });
      if (!tg.length) return;
      const cards = await g.askCards(p, { min: 1, max: 6, prompt: `【仁德】選擇要交給 ${g.nameOf(tg[0])} 的手牌`, cancelable: true });
      if (!cards.length) return;
      for (const c of cards) {
        const i = p.hand.indexOf(c);
        if (i >= 0) p.hand.splice(i, 1);
        tg[0].hand.push(c);
      }
      p.turnFlags.rendeTo = p.turnFlags.rendeTo || {};
      p.turnFlags.rendeTo[tg[0].id] = true;
      p.turnFlags.rende = (p.turnFlags.rende || 0) + cards.length;
      g.log(`${g.nameOf(p)} 發動【仁德】，交給 ${g.nameOf(tg[0])} ${cards.length} 張牌`, 'skill');
      // 第二張仁德牌 → 可視為使用一張基本牌
      if (p.turnFlags.rende >= 2 && !p.turnFlags.rendeFree) {
        p.turnFlags.rendeFree = true;
        const ch = await g.ask(p, {
          kind: 'choice', prompt: '【仁德】你可以視為使用一張基本牌',
          options: ['視為使用【桃】', '視為使用【殺】', '視為使用【酒】', '不發動'], cancelable: true,
        });
        if (ch === 0) await g.heal(p, 1, '仁德');
        else if (ch === 1) {
          const t2 = await g.askTargets(p, {
            prompt: '【仁德】選擇【殺】的目標', candidates: g.others(p).filter(q => g.inAttackRange(p, q)), cancelable: true,
          });
          if (t2.length) await g.useShaOn(p, t2[0], { id: 'virtu', name: '殺', nature: 'normal', suit: '♥', rank: 1 });
        } else if (ch === 2) {
          p.turnFlags.drunk = (p.turnFlags.drunk || 0) + 1;
          g.log(`${g.nameOf(p)} 視為使用【酒】`, 'skill');
        }
      }
    },
  };

  SK['苦肉·界'] = {
    type: 'active',
    desc: '出牌階段，你可以失去 1 點體力，然後摸三張牌。',
    canUse(g, p) { return p.hp > 1; },
    async active(g, p) {
      await g.loseHp(p, 1, '苦肉');
      if (!p.alive) return;
      g.drawCards(p, 3, '苦肉');
      g.log(`${g.nameOf(p)} 發動【苦肉】`, 'skill');
    },
  };

  SK['制衡·界'] = {
    type: 'active',
    desc: '出牌階段限一次，你可以棄置任意張牌，摸等量的牌；若棄置不少於兩張，額外摸一張。',
    canUse(g, p) {
      const total = p.hand.length + ['weapon', 'armor', 'horse+', 'horse-', 'treasure'].filter(s => p.equips[s]).length;
      return total > 0 && !p.turnFlags.zhiheng;
    },
    async active(g, p) {
      const cards = await g.askCards(p, { min: 1, max: 8, prompt: '【制衡】選擇要棄置的牌', from: 'any', cancelable: true });
      if (!cards.length) return;
      p.turnFlags.zhiheng = true;
      g.consumeCards(p, cards, '制衡');
      const n = cards.length + (cards.length >= 2 ? 1 : 0);
      g.drawCards(p, n, '制衡');
      g.log(`${g.nameOf(p)} 發動【制衡】，棄 ${cards.length} 摸 ${n}`, 'skill');
    },
  };

  SK['英姿·界'] = {
    type: 'passive',
    desc: '摸牌階段多摸一張牌；你的手牌上限 +1。',
    drawCount(g, p, n) { return n + 1; },
    handLimit(g, p, lim) { return lim + 1; },
  };

  SK['青囊·界'] = {
    type: 'active',
    desc: '出牌階段限一次，你可以棄置一張手牌，令一名角色回復 1 點體力；若棄置的是紅色牌，你摸一張牌。',
    canUse(g, p) { return p.hand.length > 0 && !p.turnFlags.qingnang && g.alive().some(q => q.hp < q.maxHp); },
    async active(g, p) {
      const card = await g.askCard(p, { prompt: '【青囊】棄置一張手牌', cancelable: true });
      if (!card) return;
      const tg = await g.askTargets(p, {
        prompt: '【青囊】選擇回復體力的角色', candidates: g.alive().filter(q => q.hp < q.maxHp), cancelable: true,
      });
      if (!tg.length) return;
      p.turnFlags.qingnang = true;
      p.hand.splice(p.hand.indexOf(card), 1);
      g.toDiscard([card]);
      await g.heal(tg[0], 1, '青囊');
      if (isRed(card)) g.drawCards(p, 1, '青囊');
    },
  };

  SK['奸雄·界'] = {
    type: 'trigger',
    desc: '當你受到傷害後，你可以獲得造成此傷害的牌，然後摸一張牌。',
    events: {
      async damaged(g, ctx, p) {
        if (ctx.target !== p || !ctx.card) return;
        const card = ctx.card;
        const i = g.discardPile.indexOf(card);
        if (i < 0) return;
        const yes = await g.askSkill(p, '奸雄·界');
        if (!yes) return;
        g.discardPile.splice(i, 1);
        p.hand.push(card);
        g.drawCards(p, 1, '奸雄');
        g.log(`${g.nameOf(p)} 發動【奸雄】，獲得 ${C.cardText(card)} 並摸一張`, 'skill');
      },
    },
  };

  SK['鐵騎·界'] = {
    type: 'trigger',
    desc: '當你使用【殺】指定目標後，你可以判定：紅色則該角色不能使用【閃】；黑色則該角色不能使用【閃】且你摸一張牌。',
    events: {
      async shaTargeted(g, ctx, p) {
        if (ctx.source !== p || !SHA.includes(ctx.card.name)) return;
        const jc = await g.judge(p, '鐵騎');
        if (!jc) return;
        ctx.noShan = true;
        if (isBlack(jc)) g.drawCards(p, 1, '鐵騎');
        g.log(`【鐵騎】生效：${g.nameOf(ctx.target)} 不能使用【閃】`, 'skill');
      },
    },
  };

  SK['涯角'] = {
    type: 'trigger',
    desc: '當你於回合外使用或打出一張牌時，你可以摸一張牌。',
    events: {
      async cardUsed(g, ctx, p) {
        if (ctx.player !== p || g.current === p) return;
        g.drawCards(p, 1, '涯角');
      },
    },
  };

  /* =========================================================
     神將
     ========================================================= */
  SK['武神'] = { type: 'convert', desc: '你可以將紅桃手牌當【殺】使用或打出。' };
  CV.push({ skill: '武神', to: '殺', from: { suit: '♥' } });

  SK['武魂'] = {
    type: 'trigger',
    desc: '鎖定技，當你受到 1 點傷害後，傷害來源獲得 1 個「夢魘」標記；當你死亡時，令擁有最多「夢魘」的一名其他角色判定：若結果不為【桃】或【桃園結義】，該角色死亡。',
    events: {
      damaged(g, ctx, p) {
        if (ctx.target !== p || !ctx.source) return;
        g.addMark(ctx.source, '夢魘', Math.max(1, ctx.amount || 1));
      },
      async onDeath(g, ctx, p) {
        if (ctx.player !== p) return;
        const others = g.others(p).filter(q => q.alive);
        if (!others.length) return;
        const max = Math.max(...others.map(q => g.marks(q, '夢魘')));
        if (max <= 0) return;
        const t = others.filter(q => g.marks(q, '夢魘') === max)[0];
        const jc = await g.judge(t, '武魂');
        if (jc && ['桃', '桃園結義'].includes(jc.name)) {
          g.log(`【武魂】判定為【${jc.name}】，${g.nameOf(t)} 逃過一劫`, 'skill');
          return;
        }
        g.log(`【武魂】${g.nameOf(t)} 判定失敗，隨神關羽而去`, 'skill');
        await g.killPlayer(t, p);
      },
    },
  };

    SK['無敵'] = {
    type: 'passive',
    desc: '鎖定技：其他角色計算與你的距離 +1。',
    defenseDistance() { return 1; },
  };

  /* ---- 神呂布（神話再臨·林｜5 體力）：狂暴／無謀／無前／神憤 ---- */
  SK['狂暴'] = {
    type: 'passive',
    desc: '鎖定技，遊戲開始時你獲得 2 個「暴怒」標記；當你造成或受到 1 點傷害後，你獲得 1 個「暴怒」標記。',
    events: {
      gameStart(g, ctx, p) { g.addMark(p, '暴怒', 2); },
      damaged(g, ctx, p) {
        if (ctx.target === p || ctx.source === p) g.addMark(p, '暴怒', Math.max(1, ctx.amount || 1));
      },
    },
  };

  SK['無謀'] = {
    type: 'passive',
    desc: '鎖定技，當你使用普通錦囊牌時，你棄 1 個「暴怒」或失去 1 點體力。',
    events: {
      async cardUsed(g, ctx, p) {
        if (ctx.player !== p || !ctx.card || ctx.card.type !== 'trick') return;
        if (['樂不思蜀', '兵糧寸斷', '閃電'].includes(ctx.card.name)) return;   // 延時錦囊不算
        if (g.marks(p, '暴怒') > 0) {
          g.removeMark(p, '暴怒', 1);
          g.log(`${g.nameOf(p)} 【無謀】棄 1 個「暴怒」`, 'skill');
        } else {
          g.log(`${g.nameOf(p)} 【無謀】沒有「暴怒」，失去 1 點體力`, 'skill');
          await g.loseHp(p, 1, '無謀');
        }
      },
    },
  };

  SK['無前'] = {
    type: 'active',
    desc: '出牌階段，你可以棄 2 個「暴怒」並選擇一名其他角色，然後本回合你獲得「無雙」且該角色的防具失效。',
    canUse(g, p) {
      return g.marks(p, '暴怒') >= 2 && !p.turnFlags.wuqian && g.others(p).some(q => q.alive);
    },
    async active(g, p) {
      const cand = g.others(p).filter(q => q.alive);
      if (!cand.length) return;
      const tg = await g.askTargets(p, { prompt: '【無前】選擇一名其他角色（其防具本回合失效）', candidates: cand, cancelable: true });
      if (!tg.length) return;
      p.turnFlags.wuqian = true;
      g.removeMark(p, '暴怒', 2);
      const q = tg[0];
      q.armorOff = true;
      if (!p.skills.includes('無雙')) {
        p.skills.push('無雙');
        p.granted = p.granted || [];
        p.granted.push({ name: '無雙', untilTurn: p.turnCount });
      }
      g.log(`${g.nameOf(p)} 發動【無前】：本回合獲得【無雙】，${g.nameOf(q)} 的防具失效`, 'skill');
    },
  };

  SK['神憤'] = {
    type: 'active',
    desc: '出牌階段限一次，你可以棄 6 個「暴怒」，然後對所有其他角色各造成 1 點傷害，其他角色棄置裝備區裡所有牌與四張手牌，最後你翻面。',
    canUse(g, p) { return g.marks(p, '暴怒') >= 6 && !p.usedLimit['神憤'] && g.others(p).some(q => q.alive); },
    async active(g, p) {
      p.usedLimit['神憤'] = true;
      g.removeMark(p, '暴怒', 6);
      g.log(`${g.nameOf(p)} 發動【神憤】！`, 'skill');
      for (const q of g.others(p)) {
        if (!q.alive) continue;
        await g.damage(p, q, 1, 'normal', null, { noSpread: true });
        if (!q.alive) continue;
        const equips = ['weapon', 'armor', 'horse+', 'horse-', 'treasure'].map(k => q.equips[k]).filter(Boolean);
        if (equips.length) {
          g.toDiscard(equips);
          for (const k of ['weapon', 'armor', 'horse+', 'horse-', 'treasure']) q.equips[k] = null;
          g.log(`${g.nameOf(q)} 棄置裝備區所有牌`, 'info');
        }
        const n = Math.min(4, q.hand.length);
        if (n > 0) {
          const cards = await g.askCards(q, { min: n, max: n, prompt: `【神憤】棄置 ${n} 張手牌` });
          if (cards.length) {
            for (const c of cards) { const i = q.hand.indexOf(c); if (i >= 0) q.hand.splice(i, 1); }
            g.toDiscard(cards);
          }
        }
      }
      p.flipped = !p.flipped;
      g.log(`${g.nameOf(p)} 翻面`, 'info');
      g.update();
    },
  };

/* ---- 神諸葛亮（神話再臨·火｜3 體力）：七星／狂風／大霧 ---- */
  async function swapStars(g, p, prompt) {
    if (!p.stars.length || !p.hand.length) return;
    const n = Math.min(p.hand.length, p.stars.length);
    const give = await g.askCards(p, {
      min: 0, max: n, prompt: `${prompt}（可選 0~${n} 張手牌換等量的「星」）`, cancelable: true,
    });
    if (!give || !give.length) return;
    const take = await g.askCards(p, { pool: p.stars.slice(), min: give.length, max: give.length, prompt: '選擇要換回的「星」' });
    if (!take || take.length !== give.length) return;
    for (const c of give) { const i = p.hand.indexOf(c); if (i >= 0) p.hand.splice(i, 1); }
    for (const c of take) { const i = p.stars.indexOf(c); if (i >= 0) p.stars.splice(i, 1); }
    p.hand.push(...take);
    p.stars.push(...give);
    g.log(`${g.nameOf(p)} 【七星】換 ${give.length} 張牌（剩 ${p.stars.length} 星）`, 'skill');
  }

  SK['七星'] = {
    type: 'trigger',
    desc: '遊戲開始時，你將牌堆頂七張牌扣置於武將牌上，稱為「星」，然後你可以用任意張手牌替換等量的「星」；摸牌階段結束時，你可以再次替換。',
    events: {
      async gameStart(g, ctx, p) {
        p.stars.push(...g.drawFromDeck(7));
        g.log(`${g.nameOf(p)} 【七星】獲得 ${p.stars.length} 枚「星」`, 'skill');
        await swapStars(g, p, '【七星】開局替換');
      },
      async phaseEnd(g, ctx, p) {
        if (ctx.player !== p || ctx.phase !== 'draw') return;
        await swapStars(g, p, '【七星】摸牌階段結束替換');
      },
    },
  };

  SK['狂風'] = {
    type: 'trigger',
    desc: '結束階段，你可以移去一枚「星」並選擇一名角色，直到你的下回合開始之前，該角色受到火焰傷害時傷害 +1。',
    events: {
      async turnEnd(g, ctx, p) {
        if (ctx.player !== p || !p.stars.length) return;
        const yes = await g.askSkill(p, '狂風', '【狂風】移去一枚「星」，令一名角色受到的火焰傷害 +1？');
        if (!yes) return;
        const tg = await g.askTargets(p, { prompt: '【狂風】選擇一名角色', candidates: g.alive(), cancelable: true });
        if (!tg.length) return;
        g.removeStars(p, 1);
        tg[0].qingFengBy = p;
        g.log(`${g.nameOf(p)} 【狂風】：${g.nameOf(tg[0])} 受到的火焰傷害 +1`, 'skill');
      },
      turnStart(g, ctx, p) {
        if (ctx.player !== p) return;
        for (const q of g.players) if (q.qingFengBy === p) q.qingFengBy = null;
      },
    },
  };

  SK['大霧'] = {
    type: 'trigger',
    desc: '結束階段，你可以移去任意枚「星」並選擇等量的角色，直到你的下回合開始之前，這些角色受到非雷電傷害時防止此傷害。',
    events: {
      async turnEnd(g, ctx, p) {
        if (ctx.player !== p || !p.stars.length) return;
        const n = Math.min(p.stars.length, g.alive().length);
        const yes = await g.askSkill(p, '大霧', `【大霧】移去「星」保護角色（最多 ${n} 名）？`);
        if (!yes) return;
        const tg = await g.askTargets(p, { prompt: '【大霧】選擇受保護的角色', candidates: g.alive(), min: 1, max: n, cancelable: true });
        if (!tg.length) return;
        g.removeStars(p, tg.length);
        for (const q of tg) q.daWBy = p;
        g.log(`${g.nameOf(p)} 【大霧】保護 ${tg.map(q => g.nameOf(q)).join('、')}`, 'skill');
      },
      turnStart(g, ctx, p) {
        if (ctx.player !== p) return;
        for (const q of g.players) if (q.daWBy === p) q.daWBy = null;
      },
    },
  };

SK['歸心'] = {
    type: 'trigger',
    desc: '當你受到 1 點傷害後，你可以依次獲得每名其他角色區域裡的一張牌，然後你翻面。',
    events: {
      async damaged(g, ctx, p) {
        if (ctx.target !== p) return;
        const others = g.others(p).filter(q => q.alive);
        const any = others.some(q => q.hand.length || ['weapon', 'armor', 'horse+', 'horse-', 'treasure'].some(sl => q.equips[sl]));
        if (!any) return;
        const yes = await g.askSkill(p, '歸心');
        if (!yes) return;
        let got = 0;
        for (const q of others) {
          const pool = q.hand.slice();
          for (const sl of ['weapon', 'armor', 'horse+', 'horse-', 'treasure']) if (q.equips[sl]) pool.push(q.equips[sl]);
          if (!pool.length) continue;
          const card = pool[Math.floor(g.rand() * pool.length)];
          g.removeCardFromPlayer(q, card);
          p.hand.push(card);
          got++;
        }
        p.flipped = !p.flipped;
        g.log(`${g.nameOf(p)} 發動【歸心】，獲得 ${got} 張牌並翻面`, 'skill');
      },
    },
  };

  SK['飛影'] = {
    type: 'passive',
    desc: '鎖定技：其他角色計算與你的距離 +1。',
    defenseDistance() { return 1; },
  };

  SK['絕境'] = {
    type: 'passive',
    desc: '鎖定技：你摸牌時多摸等同於你已損失體力值的牌；你的手牌上限 +2。',
    handLimit(g, p, lim) { return lim + 2; },
    drawCount(g, p, n) { return n + Math.max(0, p.maxHp - p.hp); },
  };

  // 龍魂：♡當【桃】、♢當火【殺】、♧當【閃】、♤當【無懈可擊】
  CV.push({ skill: '龍魂', to: '桃', from: { suit: '♥' } });
  CV.push({ skill: '龍魂', to: '火殺', from: { suit: '♦' } });
  CV.push({ skill: '龍魂', to: '閃', from: { suit: '♣' } });
  CV.push({ skill: '龍魂', to: '無懈可擊', from: { suit: '♠' } });

SK['忍戒'] = {
    type: 'passive',
    desc: '鎖定技，當你受到傷害後或於棄牌階段內棄置手牌後，你獲得 X 枚「忍」標記（X 為傷害值或棄置的手牌數）。',
    events: {
      async damaged(g, ctx, p) {
        if (ctx.target !== p) return;
        g.addMark(p, '忍', Math.max(1, ctx.amount || 1));
      },
      async discardPhaseEnd(g, ctx, p) {
        if (ctx.player !== p || !ctx.count) return;
        g.addMark(p, '忍', ctx.count);
      },
    },
  };

  SK['連破'] = {
    type: 'passive',
    desc: '若你殺死一名角色，你可以於此回合結束後執行一個額外的回合。',
  };

  SK['拜印'] = {
    type: 'trigger',
    desc: '覺醒技，準備階段，當「忍」的數量大於 3，你減 1 點體力上限，然後獲得「極略」。',
    events: {
      async turnStart(g, ctx, p) {
        if (ctx.player !== p || p.usedLimit['拜印']) return;
        if (g.marks(p, '忍') <= 3) return;
        p.usedLimit['拜印'] = true;
        await g.loseMaxHp(p, 1, '拜印');
        if (!p.skills.includes('極略')) p.skills.push('極略');
        if (g.attachSkillHooks) g.attachSkillHooks(p);
        g.log(`${g.nameOf(p)} 覺醒【拜印】，獲得【極略】`, 'skill');
      },
    },
  };

  SK['極略'] = {
    type: 'active',
    desc: '你可以移除 1 枚「忍」，發動「鬼才」「放逐」「集智」「制衡」「完殺」中的一項技能（獲得該技能直到回合結束；制衡立即結算）。',
    canUse(g, p) { return g.marks(p, '忍') > 0 && !p.turnFlags.jilue; },
    async active(g, p) {
      const opts = ['鬼才', '放逐', '集智', '制衡', '完殺'];
      const pick = await g.ask(p, { kind: 'choice', prompt: '【極略】選擇要發動的技能', options: opts, cancelable: true });
      if (pick == null || pick < 0) return;
      const name = opts[pick];
      p.turnFlags.jilue = true;
      g.removeMark(p, '忍', 1);
      g.log(`${g.nameOf(p)} 【極略】發動【${name}】`, 'skill');
      if (name === '制衡' && g.SK['制衡'] && g.SK['制衡'].active) {
        await g.SK['制衡'].active(g, p);
        return;
      }
      if (!p.skills.includes(name)) {
        p.skills.push(name);
        p.granted = p.granted || [];
        p.granted.push({ name, untilTurn: p.turnCount });
        if (g.attachSkillHooks) g.attachSkillHooks(p);
      }
    },
  };

  SK['完殺'] = {
    type: 'passive',
    desc: '鎖定技，你的回合內，除你以外的角色不能使用【桃】。',
  };

    SK['龍魂'] = { type: 'convert', desc: '你可以將兩張同花色的手牌當【殺】或【閃】使用。' };

  SK['涉獵'] = {
    type: 'trigger',
    desc: '摸牌階段，你可以改為亮出牌堆頂五張牌，獲得其中不同花色的牌各一張。',
    events: {
      async phaseStart(g, ctx, p) {
        if (ctx.player !== p || ctx.phase !== 'draw') return;
        const yes = await g.askSkill(p, '涉獵', '是否發動【涉獵】取代摸牌？');
        if (!yes) return;
        p.turnFlags.skipDraw = true;
        const shown = g.drawFromDeck(5);
        if (!shown.length) return;
        g.log(`【涉獵】亮出：${shown.map(C.cardText).join(' ')}`, 'skill');
        const seen = new Set();
        const gain = [];
        for (const c of shown) if (!seen.has(c.suit)) { seen.add(c.suit); gain.push(c); }
        for (const c of gain) { shown.splice(shown.indexOf(c), 1); p.hand.push(c); }
        g.toDiscard(shown);
        g.log(`${g.nameOf(p)} 獲得 ${gain.length} 張牌`, 'skill');
      },
    },
  };

  // 涉獵（官方）：摸牌階段，可改為亮出牌堆頂五張，獲得每種花色各一張
  SK['涉獵'] = {
    type: 'trigger',
    desc: '摸牌階段，你可以改為亮出牌堆頂的五張牌，然後獲得其中每種花色的牌各一張。',
    events: {
      phaseStart: async (g, ctx, p) => {
        if (ctx.phase !== 'draw' || ctx.player !== p || !p.alive) return;
        if (p.turnFlags.skipDraw) return;      // 兵糧寸斷
        if (!(await g.askSkill(p, '涉獵', '【涉獵】改為亮出牌堆頂五張，每種花色各拿一張？'))) return;
        const revealed = g.drawFromDeck(5);
        if (!revealed.length) return;
        g.log(`${g.nameOf(p)} 發動【涉獵】，亮出：${revealed.map(C.cardText).join('、')}`, 'skill');
        const suits = [];
        for (const c of revealed) if (!suits.includes(c.suit)) suits.push(c.suit);
        const taken = [];
        for (const su of suits) {
          const cand = revealed.filter(c => c.suit === su && !taken.includes(c));
          if (!cand.length) continue;
          let pick = cand[0];
          if (cand.length > 1) {
            const res = await g.askCards(p, { pool: cand, prompt: `【涉獵】選擇要獲得的 ${su} 牌` });
            if (res.length) pick = res[0];
          }
          taken.push(pick);
        }
        const rest = revealed.filter(c => !taken.includes(c));
        for (const c of taken) p.hand.push(c);
        if (rest.length) g.toDiscard(rest);
        p.turnFlags.skipDraw = true;   // 取代正常摸牌
        g.log(`${g.nameOf(p)} 獲得 ${taken.map(C.cardText).join('、') || '（無）'}`, 'skill');
        g.update();
      },
    },
  };

  // 攻心（官方）：出牌階段限一次，觀看一名其他角色手牌，可展示其中一張 ♥ 並選擇棄置或置於牌堆頂
  SK['攻心'] = {
    type: 'active',
    once: true,
    desc: '出牌階段限一次，你可以觀看一名其他角色的手牌，然後你可以展示其中一張 ♥ 牌，選擇一項：1. 棄置此牌；2. 將此牌置於牌堆頂。',
    canUse(g, p) {
      if (p.turnFlags.gongxin) return false;
      return g.others(p).some(q => q.hand.length > 0);
    },
    async active(g, p) {
      const tg = await g.askTargets(p, {
        prompt: '【攻心】選擇觀看手牌的角色',
        candidates: g.others(p).filter(q => q.hand.length > 0), cancelable: true,
      });
      if (!tg.length) return;
      p.turnFlags.gongxin = true;
      const t = tg[0];
      g.log(`${g.nameOf(p)} 觀看 ${g.nameOf(t)} 的手牌：${t.hand.map(C.cardText).join('、') || '（空）'}`, 'skill');
      const hearts = t.hand.filter(c => c.suit === '♥');
      if (!hearts.length) {
        g.log(`${g.nameOf(t)} 手上沒有 ♥ 牌，【攻心】結束`, 'skill');
        return;
      }
      const pickRes = await g.askCards(p, { pool: hearts, prompt: '【攻心】選擇要展示的 ♥ 牌', cancelable: true });
      if (!pickRes.length) return;
      const pick = pickRes[0];
      const ch = await g.ask(p, {
        kind: 'choice', prompt: `【攻心】${C.cardText(pick)} 要怎麼處理？`,
        options: ['棄置此牌', '置於牌堆頂'], cancelable: true,
      });
      t.hand.splice(t.hand.indexOf(pick), 1);
      if (ch === 1) {
        g.deck.unshift(pick);
        g.log(`${g.nameOf(p)} 發動【攻心】，將 ${C.cardText(pick)} 置於牌堆頂`, 'skill');
      } else {
        g.toDiscard([pick]);
        g.log(`${g.nameOf(p)} 發動【攻心】，棄置 ${C.cardText(pick)}`, 'skill');
      }
      g.update();
    },
  };

  SK['琴音'] = {
    type: 'trigger',
    desc: '棄牌階段結束時，若你於此階段內棄置過至少兩張手牌，你可以選擇一項：令所有角色各回復 1 點體力，或令所有角色各失去 1 點體力。',
    events: {
      async discardPhaseEnd(g, ctx, p) {
        if (ctx.player !== p || ctx.count < 2) return;
        const ch = await g.ask(p, { kind: 'choice', prompt: '【琴音】選擇效果', options: ['全體角色各回復 1 點體力', '全體角色各失去 1 點體力'], cancelable: true });
        if (ch == null) return;
        if (ch === 0) {
          for (const q of g.alive()) await g.heal(q, 1, '琴音');
          g.log(`${g.nameOf(p)} 發動【琴音】：全體回復 1 點體力`, 'skill');
        } else {
          for (const q of g.alive()) { if (q.hp > 0) await g.loseHp(q, 1, '琴音'); }
          g.log(`${g.nameOf(p)} 發動【琴音】：全體失去 1 點體力`, 'skill');
        }
      },
    },
  };

    SK['業炎'] = {
    type: 'active',
    desc: '限定技，出牌階段，你可以選擇至多三名角色，對這些角色造成共計至多 3 點火焰傷害；若要對一名角色分配 2 點以上，你須先棄置四張花色各不相同的手牌並失去 3 點體力。',
    canUse(g, p) { return g.canUseLimit(p, '業炎') && g.others(p).some(q => q.alive); },
    async active(g, p) {
      const tg = await g.askTargets(p, { prompt: '【業炎】選擇至多三名角色', candidates: g.others(p).filter(q => q.alive), min: 1, max: 3, cancelable: true });
      if (!tg.length) return;
      g.useLimit(p, '業炎');
      // 是否加碼：對其中一名分配 2 點
      let heavy = null;
      const suits = new Set(p.hand.map(c => c.suit));
      if (p.hp > 3 && p.hand.length >= 4 && suits.size === 4) {
        const ch = await g.ask(p, {
          kind: 'choice', prompt: '【業炎】要對一名角色分配 2 點火焰傷害嗎？（需棄四張不同花色的手牌並失去 3 點體力）',
          options: ['不加碼', '加碼 2 點'], cancelable: true,
        });
        if (ch === 1) {
          const pick = await g.askTargets(p, { prompt: '【業炎】選擇承受 2 點火焰傷害的角色', candidates: tg, min: 1, max: 1, cancelable: true });
          if (pick.length) {
            const four = [];
            for (const card of p.hand) {
              if (!four.some(c => c.suit === card.suit)) four.push(card);
              if (four.length === 4) break;
            }
            for (const c of four) { const i = p.hand.indexOf(c); if (i >= 0) p.hand.splice(i, 1); }
            g.toDiscard(four);
            await g.loseHp(p, 3, '業炎');
            heavy = pick[0];
          }
        }
      }
      g.log(`${g.nameOf(p)} 發動限定技【業炎】`, 'skill');
      for (const t of tg) {
        if (!t.alive) continue;
        await g.damage(p, t, heavy === t ? 2 : 1, 'fire', null);
      }
    },
  };

    SK['衝陣'] = {
    type: 'trigger',
    desc: '當你使用【殺】造成傷害後，你可以棄置目標一張牌。',
    events: {
      async damaged(g, ctx, p) {
        if (ctx.source !== p || !ctx.card || !SHA.includes(ctx.card.name)) return;
        const t = ctx.target;
        const total = t.hand.length + ['weapon', 'armor', 'horse+', 'horse-', 'treasure'].filter(s => t.equips[s]).length;
        if (!total) return;
        const yes = await g.askSkill(p, '衝陣');
        if (!yes) return;
        const card = await g.chooseCardFromPlayer(p, t, '【衝陣】棄置一張牌');
        if (!card) return;
        g.removeCardFromPlayer(t, card);
        g.toDiscard([card]);
      },
    },
  };

  SK['帷幕'] = {
    type: 'passive',
    desc: '鎖定技：你不能成為黑色錦囊牌的目標。',
    cannotBeTargeted(g, p, source, cardName, card) {
      return !!card && card.type === 'trick' && C.isBlack(card);
    },
  };

  SK['亂武'] = {
    type: 'active',
    desc: '限定技：出牌階段，你可以令所有其他角色各失去 1 點體力。',
    canUse(g, p) { return g.canUseLimit(p, '亂武') && g.others(p).length > 0; },
    async active(g, p) {
      g.useLimit(p, '亂武');
      g.log(`${g.nameOf(p)} 發動限定技【亂武】`, 'skill');
      for (const q of g.others(p)) if (q.hp > 0) await g.loseHp(q, 1, '亂武');

    },
  };

  SK['行殤'] = {
    type: 'trigger',
    desc: '當一名角色死亡時，你可以獲得其所有牌。',
    events: {
      async onDeath(g, ctx, p) {
        if (ctx.player === p) return;
        const dead = ctx.player;
        if (!dead.hand.length) return;
        const yes = await g.askSkill(p, '行殤');
        if (!yes) return;
        const cards = dead.hand.splice(0);
        p.hand.push(...cards);
        g.log(`${g.nameOf(p)} 發動【行殤】，獲得 ${cards.length} 張牌`, 'skill');
      },
    },
  };

  SK['斷糧'] = {
    type: 'trigger',
    desc: '當你使用【殺】造成傷害後，你可以令目標跳過下個摸牌階段。',
    events: {
      async damaged(g, ctx, p) {
        if (ctx.source !== p || !ctx.card || !SHA.includes(ctx.card.name)) return;
        ctx.target.turnFlags = ctx.target.turnFlags || {};
        ctx.target.turnFlags.skipDrawNext = true;
        g.log(`【斷糧】生效：${g.nameOf(ctx.target)} 下回合跳過摸牌`, 'skill');
      },
    },
  };

  SK['猛進'] = {
    type: 'trigger',
    desc: '當你使用的【殺】被【閃】抵銷時，你可以棄置目標的一張牌。',
    events: {
      async shaDodged(g, ctx, p) {
        if (ctx.source !== p) return;
        const t = ctx.target;
        const total = t.hand.length + ['weapon', 'armor', 'horse+', 'horse-', 'treasure'].filter(s => t.equips[s]).length;
        if (!total) return;
        const yes = await g.askSkill(p, '猛進');
        if (!yes) return;
        const card = await g.chooseCardFromPlayer(p, t, '【猛進】棄置一張牌');
        if (card) { g.removeCardFromPlayer(t, card); g.toDiscard([card]); }
      },
    },
  };

  SK['巧變'] = {
    type: 'trigger',
    desc: '摸牌階段，你可以少摸一張牌，改為觀看牌堆頂三張並獲得其中一張。',
    events: {
      async phaseStart(g, ctx, p) {
        if (ctx.player !== p || ctx.phase !== 'draw') return;
        const yes = await g.askSkill(p, '巧變', '是否發動【巧變】？');
        if (!yes) return;
        p.turnFlags.skipDraw = true;
        g.drawCards(p, 1);
        const top = g.deck.slice(-3).reverse();
        if (!top.length) return;
        const idx = await g.ask(p, {
          kind: 'chooseFrom', prompt: '【巧變】選擇獲得一張',
          cards: top.map(c => c.id), cardData: top.map(c => ({ id: c.id, name: c.name, suit: c.suit, rank: c.rank })),
        });
        const pick2 = top[Math.max(0, Math.min(top.length - 1, idx || 0))];
        g.deck.splice(g.deck.indexOf(pick2), 1);
        p.hand.push(pick2);
        g.log(`${g.nameOf(p)} 發動【巧變】，獲得 ${C.cardText(pick2)}`, 'skill');
      },
    },
  };

  /* =========================================================
     界將（界限突破）25 隻
     ========================================================= */
  /* ---- 界將補技能 ---- */
  SK['奮威'] = {
    type: 'trigger',
    desc: '限定技，當你使用的一張錦囊牌指定多於一個目標後，你可以令此牌對其中任意名目標角色無效。',
    events: {
      async trickTargets(g, ctx, p) {
        if (ctx.player !== p || p.usedLimit['奮威']) return;
        const others = ctx.targets.filter(q => q !== p && q.alive);
        if (!others.length) return;
        const yes = await g.askSkill(p, '奮威', '【奮威】要令此牌對部分目標無效嗎？');
        if (!yes) return;
        const pick = await g.askTargets(p, {
          prompt: '【奮威】選擇不受此牌影響的目標',
          candidates: others, min: 1, max: others.length, cancelable: true,
        });
        if (!pick.length) return;
        p.usedLimit['奮威'] = true;
        ctx.negate.push(...pick);
        g.log(`${g.nameOf(p)} 發動限定技【奮威】`, 'skill');
      },
    },
  };

  SK['利馭'] = {
    type: 'trigger',
    desc: '當你的【殺】對一名其他角色造成傷害後，你可以獲得其區域內的一張牌；若獲得的不是裝備牌，其摸一張牌；若是裝備牌，視為對其選擇的另一名角色使用【決鬥】。',
    events: {
      async damaged(g, ctx, p) {
        if (ctx.source !== p || ctx.target === p) return;
        const c = ctx.card;
        if (!c || !['殺', '火殺', '雷殺'].includes(c.name)) return;
        const t = ctx.target;
        if (!t.alive) return;
        const pool = [...t.hand, ...['weapon', 'armor', 'horse+', 'horse-', 'treasure'].map(k => t.equips[k]).filter(Boolean)];
        if (!pool.length) return;
        const yes = await g.askSkill(p, '利馭', `【利馭】獲得 ${g.nameOf(t)} 的一張牌？`);
        if (!yes) return;
        const pick = await g.askCards(p, { pool, min: 1, max: 1, prompt: '【利馭】選擇獲得一張牌' });
        const card = (pick && pick[0]) || pool[0];
        g.removeCardFromPlayer(t, card);
        p.hand.push(card);
        g.log(`${g.nameOf(p)} 【利馭】獲得 ${g.nameOf(t)} 的一張牌`, 'skill');
        if (card.type === 'equip') {
          const others = g.others(p).filter(q => q.alive && q !== t);
          if (others.length) {
            const t2 = await g.askTargets(p, { prompt: '【利馭】視為對一名角色使用【決鬥】', candidates: others, cancelable: true });
            if (t2.length) {
              const virt = { id: 'v-liyu', name: '決鬥', type: 'trick', virtual: true, suit: '♠', rank: 7 };
              await g.useTrick(p, virt, '決鬥', [t2[0]]);
            }
          }
        } else {
          g.drawCards(t, 1, '利馭');
        }
      },
    },
  };

  SK['除癘'] = {
    type: 'active',
    desc: '出牌階段限一次，你可以選擇任意名勢力各不相同的其他角色，然後你棄置你和這些角色的各一張牌。被棄置♠牌的角色各摸一張牌。',
    canUse(g, p) {
      return !p.turnFlags.chuli && p.hand.length > 0 && g.others(p).some(q => q.alive);
    },
    async active(g, p) {
      const cand = g.others(p).filter(q => q.alive);
      if (!cand.length) return;
      const pick = await g.askTargets(p, {
        prompt: '【除癘】選擇勢力各不相同的其他角色',
        candidates: cand, min: 1, max: Math.min(4, cand.length), cancelable: true,
      });
      if (!pick.length) return;
      const seen = new Set(), tgs = [];
      for (const q of pick || []) {
        const k = (q.generals[0] || {}).kingdom || '群';
        if (seen.has(k)) continue;
        seen.add(k); tgs.push(q);
      }
      if (!tgs.length) return;
      const mine = await g.askCards(p, { min: 1, max: 1, prompt: '【除癘】棄置你的一張牌', cancelable: true });
      if (!mine.length) return;
      p.turnFlags.chuli = true;
      g.consumeCards(p, mine, '除癘');
      g.log(`${g.nameOf(p)} 發動【除癘】`, 'skill');
      if (mine[0].suit === '♠') g.drawCards(p, 1, '除癘');
      for (const q of tgs) {
        const pool = [...q.hand, ...['weapon', 'armor', 'horse+', 'horse-', 'treasure'].map(k => q.equips[k]).filter(Boolean)];
        if (!pool.length) continue;
        const card = pool[Math.floor(g.rand() * pool.length)];
        g.removeCardFromPlayer(q, card);
        g.toDiscard([card]);
        g.log(`${g.nameOf(p)} 棄置 ${g.nameOf(q)} 的一張牌`, 'info');
        if (card.suit === '♠') g.drawCards(q, 1, '除癘');
      }
    },
  };

  const JIE = [
    ['劉備', '蜀', 4, 'male', ['仁德·界', '激將']],
    ['關羽', '蜀', 4, 'male', ['武聖']],
    ['張飛', '蜀', 4, 'male', ['咆哮']],
    ['趙雲', '蜀', 4, 'male', ['龍膽', '涯角']],
    ['馬超', '蜀', 4, 'male', ['馬術', '鐵騎·界']],
    ['黃月英', '蜀', 3, 'female', ['集智', '奇才']],
    ['諸葛亮', '蜀', 3, 'male', ['觀星', '空城']],
    ['曹操', '魏', 4, 'male', ['奸雄·界', '護駕']],
    ['司馬懿', '魏', 3, 'male', ['反饋', '鬼才']],
    ['夏侯惇', '魏', 4, 'male', ['剛烈']],
    ['張遼', '魏', 4, 'male', ['突襲']],
    ['許褚', '魏', 4, 'male', ['裸衣']],
    ['郭嘉', '魏', 3, 'male', ['天妒', '遺計']],
    ['甄姬', '魏', 3, 'female', ['傾國', '洛神']],
    ['孫權', '吳', 4, 'male', ['制衡·界', '救援']],
    ['甘寧', '吳', 4, 'male', ['奇襲', '奮威']],
    ['呂蒙', '吳', 4, 'male', ['克己']],
    ['黃蓋', '吳', 4, 'male', ['苦肉·界']],
    ['周瑜', '吳', 3, 'male', ['英姿·界', '反間']],
    ['大喬', '吳', 3, 'female', ['國色', '流離']],
    ['陸遜', '吳', 3, 'male', ['謙遜', '連營']],
    ['孫尚香', '吳', 3, 'female', ['結姻', '梟姬']],
    ['華佗', '群', 3, 'male', ['急救', '除癘']],
    ['呂布', '群', 4, 'male', ['無雙', '利馭']],
    ['貂蟬', '群', 3, 'female', ['離間', '閉月']],
  ];
  for (const [name, kingdom, hp, gender, skills] of JIE) {
    G['界' + name] = { name: '界' + name, base: name, kingdom, hp, gender, pack: 'jie', skills };
  }

  /* =========================================================
     神劉備（神話再臨·陰）官方技能
     ========================================================= */
  // 龍怒：轉換技，鎖定技。出牌階段開始時交替：
  //   ① 失去 1 點體力並摸一張牌，本回合紅色手牌視為火【殺】且無距離限制
  //   ② 減 1 點體力上限並摸一張牌，本回合錦囊牌視為雷【殺】且無次數限制
  SK['龍怒'] = {
    type: 'locked',
    desc: '轉換技，鎖定技，出牌階段開始時，①你失去一點體力並摸一張牌，本回合你的紅色手牌均視為火【殺】且使用火【殺】無距離限制；②你減 1 點體力上限並摸一張牌，本回合你的錦囊牌均視為雷【殺】且使用雷【殺】無次數限制。',
    events: {
      phaseStart: async (g, ctx, p) => {
        if (ctx.phase !== 'play' || ctx.player !== p || !p.alive) return;
        const mode = p.turnFlags.longnuMode === 1 ? 2 : 1;
        p.turnFlags.longnuMode = mode;
        if (mode === 1) {
          await g.loseHp(p, 1, '龍怒');
          if (!p.alive) return;
          g.drawCards(p, 1, '龍怒');
          p.turnFlags.longnuFire = true;
          g.log(`${g.nameOf(p)} 發動【龍怒】①：本回合紅色手牌視為火【殺】，且無距離限制`, 'skill');
        } else {
          p.maxHp = Math.max(1, p.maxHp - 1);
          if (p.hp > p.maxHp) p.hp = p.maxHp;
          g.drawCards(p, 1, '龍怒');
          p.turnFlags.longnuThunder = true;
          p.turnFlags.noShaLimit = true;
          g.log(`${g.nameOf(p)} 發動【龍怒】②：體力上限 -1，本回合錦囊牌視為雷【殺】，且無次數限制`, 'skill');
        }
        g.update();
      },
    },
  };

  // 結營：鎖定技，始終橫置；已橫置角色手牌上限 +2；結束階段橫置一名其他角色
  SK['結營'] = {
    type: 'locked',
    desc: '鎖定技，你始終處於橫置狀態；已橫置的角色手牌上限 +2；結束階段，你橫置一名其他角色。',
    events: {
      gameStart: async (g, ctx, p) => {
        p.chained = true;
        g.log(`${g.nameOf(p)} 的【結營】生效，始終處於橫置狀態`, 'skill');
      },
      turnStart: async (g, ctx, p) => {
        if (ctx.player !== p) return;
        if (!p.chained) {
          p.chained = true;
          g.log(`${g.nameOf(p)} 因【結營】始終橫置`, 'skill');
        }
      },
      turnEnd: async (g, ctx, p) => {
        if (ctx.player !== p || !p.alive) return;
        const cands = g.others(p).filter(q => q.alive && !q.chained);
        if (!cands.length) return;
        const t = await g.askTargets(p, {
          prompt: '【結營】選擇一名其他角色橫置',
          candidates: cands, cancelable: true,
        });
        if (t.length) {
          t[0].chained = true;
          g.log(`${g.nameOf(p)} 發動【結營】，橫置 ${g.nameOf(t[0])}`, 'skill');
          g.update();
        }
      },
    },
  };

  CV.push({ skill: '龍怒', to: '火殺', from: { color: 'red' }, when: (g, p) => !!(p.turnFlags && p.turnFlags.longnuFire) });
  CV.push({ skill: '龍怒', to: '雷殺', from: { type: 'trick' }, when: (g, p) => !!(p.turnFlags && p.turnFlags.longnuThunder) });

  /* =========================================================
     神陸遜（神話再臨·陰）官方技能
     ========================================================= */
  // 軍略：鎖定技，造成或受到 1 點傷害後獲得一個「軍略」標記
  SK['軍略'] = {
    type: 'locked',
    desc: '鎖定技，當你造成或受到 1 點傷害後，你獲得一個「軍略」標記。',
    events: {
      damaged: async (g, ctx, p) => {
        if (ctx.source !== p && ctx.target !== p) return;
        p.marks.軍略 = (p.marks.軍略 || 0) + 1;
        g.log(`${g.nameOf(p)} 獲得 1 個「軍略」標記（共 ${p.marks.軍略} 個）`, 'skill');
        g.update();
      },
    },
  };

  // 摧克：出牌階段開始時，依「軍略」數量執行
  SK['摧克'] = {
    type: 'trigger',
    desc: '出牌階段開始時，若「軍略」為奇數，你可以對一名角色造成 1 點傷害；若為偶數，你可以橫置一名角色並棄置其區域內一張牌；若「軍略」超過 7 個，你可以棄全部「軍略」並對所有其他角色造成 1 點傷害。',
    events: {
      phaseStart: async (g, ctx, p) => {
        if (ctx.phase !== 'play' || ctx.player !== p || !p.alive) return;
        const n = p.marks.軍略 || 0;
        if (n <= 0) return;

        if (n > 7 && await g.askSkill(p, '摧克', `【摧克】「軍略」${n} 個，是否棄全部標記並對所有其他角色造成 1 點傷害？`)) {
          p.marks.軍略 = 0;
          g.log(`${g.nameOf(p)} 棄全部「軍略」，對所有其他角色造成 1 點傷害`, 'skill');
          for (const q of g.others(p).filter(x => x.alive)) await g.damage(p, q, 1, 'normal', null, { reason: '摧克' });
          g.update();
          return;
        }

        if (n % 2 === 1) {
          if (await g.askSkill(p, '摧克', '【摧克】是否對一名角色造成 1 點傷害？')) {
            const t = await g.askTargets(p, {
              prompt: '【摧克】選擇受到 1 點傷害的角色',
              candidates: g.alive().filter(q => q !== p), cancelable: true,
            });
            if (t.length) {
              g.log(`${g.nameOf(p)} 發動【摧克】（奇數），對 ${g.nameOf(t[0])} 造成 1 點傷害`, 'skill');
              await g.damage(p, t[0], 1, 'normal', null, { reason: '摧克' });
            }
          }
        } else {
          if (await g.askSkill(p, '摧克', '【摧克】是否橫置一名角色並棄置其區域內一張牌？')) {
            const t = await g.askTargets(p, {
              prompt: '【摧克】選擇要橫置並棄牌的角色',
              candidates: g.alive().filter(q => q !== p), cancelable: true,
            });
            if (t.length) {
              const q = t[0];
              if (!q.chained) {
                q.chained = true;
                g.log(`${g.nameOf(p)} 發動【摧克】（偶數），橫置 ${g.nameOf(q)}`, 'skill');
              }
              const pick = await g.chooseCardFromPlayer(p, q, '【摧克】選擇要棄置的牌');
              if (pick) {
                g.removeCardFromPlayer(q, pick);
                g.toDiscard([pick]);
                g.log(`${g.nameOf(p)} 棄置了 ${g.nameOf(q)} 的 ${C.cardText(pick)}`, 'skill');
              }
              g.update();
            }
          }
        }
      },
    },
  };

  // 綻火：限定技
  SK['綻火'] = {
    type: 'active',
    limit: true,
    desc: '限定技，出牌階段，你可以棄全部「軍略」，令至多等量的已橫置角色棄置所有裝備區裡的牌，然後對其中一名角色造成 1 點火焰傷害。',
    canUse(g, p) {
      if (p.usedLimit && p.usedLimit['綻火']) return false;
      const n = p.marks.軍略 || 0;
      return n > 0 && g.alive().some(q => q.chained);
    },
    async active(g, p) {
      const n = p.marks.軍略 || 0;
      const cands = g.alive().filter(q => q.chained);
      if (!n || !cands.length) return;
      const tg = await g.askTargets(p, {
        prompt: `【綻火】選擇至多 ${n} 名已橫置角色（棄置其全部裝備）`,
        candidates: cands, min: 1, max: Math.min(n, cands.length), cancelable: true,
      });
      if (!tg.length) return;
      p.marks.軍略 = 0;
      p.usedLimit['綻火'] = true;
      g.log(`${g.nameOf(p)} 發動限定技【綻火】，棄全部「軍略」`, 'skill');
      for (const q of tg) {
        const slots = ['weapon', 'armor', 'horse+', 'horse-', 'treasure'];
        const gone = [];
        for (const sl of slots) {
          const c = q.equips[sl];
          if (c) { q.equips[sl] = null; gone.push(c); }
        }
        if (gone.length) {
          g.toDiscard(gone);
          g.log(`${g.nameOf(q)} 棄置裝備：${gone.map(C.cardText).join('、')}`, 'skill');
        }
      }
      const t2 = await g.askTargets(p, {
        prompt: '【綻火】選擇受到 1 點火焰傷害的角色',
        candidates: tg, cancelable: false,
      });
      if (t2.length) await g.damage(p, t2[0], 1, 'fire', null, { reason: '綻火' });
      g.update();
    },
  };

  /* =========================================================
     神張遼 · 三個官方版本（2020 珍藏版 / OL 版 / 神話再臨·雷）
     需要的底層機制：廢除裝備欄（g.abolishSlot / g.restoreSlot）、技能暫時無效（p.silenced）
     ========================================================= */
  const WOUNDED_IN_RANGE = (g, owner) =>
    g.others(owner).filter(q => q.alive && q.hp < q.maxHp && g.inAttackRange(owner, q));

  const pickSkillOf = async (g, p, target, prompt, filter) => {
    const cands = target.skills.filter(sn => {
      const sk = g.SK[sn];
      if (!sk) return false;
      if (sk.limit || sk.awaken || sk.lord) return false;
      return filter ? filter(sk) : true;
    });
    if (!cands.length) return null;
    if (cands.length === 1) return cands[0];
    const idx = await g.ask(p, { kind: 'choice', prompt, options: cands.map(x => '【' + x + '】'), cancelable: true });
    if (idx == null || idx < 0) return null;
    return cands[idx];
  };

  // ── 神話再臨·雷 ─────────────────────────────────────────
  SK['奪銳·雷'] = {
    type: 'trigger',
    desc: '每輪限一次，當你於出牌階段內對一名其他角色造成傷害後，你可以獲得其「出牌階段限一次」的技能直到回合結束，且該角色下回合該技能失效。若如此做，廢除你裝備區裡的一個裝備欄。',
    events: {
      damaged: async (g, ctx, p) => {
        if (ctx.source !== p || !ctx.target || ctx.target === p || !ctx.target.alive) return;
        if (g.phase !== 'play') return;
        const round = Math.floor((g.stats.turns || 0) / Math.max(1, g.players.length));
        p.usedRound = p.usedRound || {};
        if (p.usedRound['奪銳·雷'] === round) return;
        const t = ctx.target;
        const name = await pickSkillOf(g, p, t, `【奪銳】奪取 ${g.nameOf(t)} 哪個技能？`, sk => sk.once);
        if (!name) return;
        if (!(await g.askSkill(p, '奪銳·雷', `【奪銳】奪取 ${g.nameOf(t)} 的【${name}】並廢除自己一個裝備欄？`))) return;
        p.usedRound['奪銳·雷'] = round;
        t.silenced[name] = (t.turnCount || 0) + 1;
        p.skills.push(name);
        p.granted = p.granted || [];
        p.granted.push({ name, untilTurn: p.turnCount });
        g.abolishSlot(p);
        g.log(`${g.nameOf(p)} 發動【奪銳】，獲得【${name}】直到回合結束，${g.nameOf(t)} 的【${name}】下回合失效`, 'skill');
        g.update();
      },
      turnEnd: async (g, ctx, p) => {
        if (ctx.player !== p || !p.granted) return;
        for (const gr of p.granted.slice()) {
          if (gr.untilTurn <= (p.turnCount || 0)) {
            const i = p.skills.indexOf(gr.name);
            if (i >= 0) p.skills.splice(i, 1);
            p.granted.splice(p.granted.indexOf(gr), 1);
            g.log(`${g.nameOf(p)} 不再擁有【${gr.name}】`, 'skill');
          }
        }
      },
    },
  };

  SK['止啼·雷'] = {
    type: 'locked',
    desc: '鎖定技，你攻擊範圍內已受傷的角色手牌上限-1；當你和這些角色拼點或【決鬥】你贏時，你恢復一個裝備欄。',
    limitFor(g, owner, p) {
      if (p === owner) return 0;
      return (p.hp < p.maxHp && g.inAttackRange(owner, p)) ? -1 : 0;
    },
    events: {
      duelResult: async (g, ctx, p) => {
        if (ctx.winner !== p || !ctx.loser || ctx.loser.hp >= ctx.loser.maxHp) return;
        if (!g.inAttackRange(p, ctx.loser)) return;
        g.restoreSlot(p);
        g.update();
      },
    },
  };

  // ── OL 版 ───────────────────────────────────────────────
  SK['奪銳·OL'] = {
    type: 'trigger',
    desc: '當你於出牌階段內對一名角色造成傷害後，你可以選擇該角色武將牌上的一個技能。若如此做，你結束出牌階段，且你令此技能于其下個回合結束之前無效。',
    events: {
      damaged: async (g, ctx, p) => {
        if (ctx.source !== p || !ctx.target || ctx.target === p || !ctx.target.alive) return;
        if (g.phase !== 'play' || p.turnFlags.duoruiOL) return;
        const t = ctx.target;
        const name = await pickSkillOf(g, p, t, `【奪銳】令 ${g.nameOf(t)} 哪個技能無效？`);
        if (!name) return;
        if (!(await g.askSkill(p, '奪銳·OL', `【奪銳】令 ${g.nameOf(t)} 的【${name}】無效（你將結束出牌階段）？`))) return;
        p.turnFlags.duoruiOL = true;
        t.silenced[name] = (t.turnCount || 0) + 1;
        p.turnFlags.endPlay = true;
        g.log(`${g.nameOf(p)} 發動【奪銳】，${g.nameOf(t)} 的【${name}】於其下個回合結束前無效`, 'skill');
        g.update();
      },
    },
  };

  SK['止啼·OL'] = {
    type: 'locked',
    desc: '鎖定技，你攻擊範圍內已受傷角色的手牌上限-1。若場上已受傷的角色數：不小於 1，你的手牌上限+1；不小於 3，你於摸牌階段開始時令額定摸牌數+1；不小於 5，回合結束時，你隨機廢除一名角色的一個裝備欄。',
    limitFor(g, owner, p) {
      if (p === owner) return 0;
      return (p.hp < p.maxHp && g.inAttackRange(owner, p)) ? -1 : 0;
    },
    handLimit(g, p, lim) {
      const n = g.alive().filter(q => q.hp < q.maxHp).length;
      return n >= 1 ? lim + 1 : lim;
    },
    drawCount(g, p, n) {
      const hurt = g.alive().filter(q => q.hp < q.maxHp).length;
      return hurt >= 3 ? n + 1 : n;
    },
    events: {
      turnEnd: async (g, ctx, p) => {
        if (ctx.player !== p) return;
        const hurt = g.alive().filter(q => q.hp < q.maxHp).length;
        if (hurt < 5) return;
        const cands = g.alive().filter(q => Object.keys(q.deadSlots || {}).length < 4);
        if (!cands.length) return;
        const q = cands[Math.floor(g.rand() * cands.length)];
        g.abolishSlot(q);
        g.update();
      },
    },
  };

  // ── 2020 珍藏版 ─────────────────────────────────────────
  SK['奪銳·珍藏'] = {
    type: 'trigger',
    desc: '當你於出牌階段對一名其他角色造成傷害後，你可以廢除你的一個裝備欄，令其一個技能於其下個回合結束之前無效，然後你於其下個回合結束或其死亡前擁有此技能且不能發動「奪銳」。',
    events: {
      damaged: async (g, ctx, p) => {
        if (ctx.source !== p || !ctx.target || ctx.target === p || !ctx.target.alive) return;
        if (g.phase !== 'play' || p.usedLimit['奪銳·珍藏']) return;
        const t = ctx.target;
        const name = await pickSkillOf(g, p, t, `【奪銳】奪取 ${g.nameOf(t)} 哪個技能？`);
        if (!name) return;
        if (!(await g.askSkill(p, '奪銳·珍藏', `【奪銳】廢除自己一個裝備欄，奪取 ${g.nameOf(t)} 的【${name}】？`))) return;
        p.usedLimit['奪銳·珍藏'] = true;
        g.abolishSlot(p);
        t.silenced[name] = (t.turnCount || 0) + 1;
        p.skills.push(name);
        p.granted = p.granted || [];
        p.granted.push({ name, untilTarget: t, untilTurn: (t.turnCount || 0) + 1 });
        g.log(`${g.nameOf(p)} 發動【奪銳】，${g.nameOf(t)} 的【${name}】失效，自己獲得之`, 'skill');
        g.update();
      },
      turnEnd: async (g, ctx, p) => {
        if (ctx.player !== p || !p.granted) return;
        for (const gr of p.granted.slice()) {
          const target = gr.untilTarget;
          const expired = !target || !target.alive ||
            (target.turnCount || 0) > (gr.untilTurn || 0) ||
            (gr.untilTurn != null && (target.turnCount || 0) >= gr.untilTurn);
          if (expired && gr.untilTarget) {
            const i = p.skills.indexOf(gr.name);
            if (i >= 0) p.skills.splice(i, 1);
            p.granted.splice(p.granted.indexOf(gr), 1);
            g.log(`${g.nameOf(p)} 不再擁有【${gr.name}】`, 'skill');
          }
        }
      },
    },
  };

  SK['止啼·珍藏'] = {
    type: 'locked',
    desc: '鎖定技，你攻擊範圍內已受傷的角色手牌上限-1；當你與這些角色【決鬥】或拼點贏時，或你受到來源為這些角色的傷害後，你恢復一個裝備欄。',
    limitFor(g, owner, p) {
      if (p === owner) return 0;
      return (p.hp < p.maxHp && g.inAttackRange(owner, p)) ? -1 : 0;
    },
    events: {
      duelResult: async (g, ctx, p) => {
        if (ctx.winner !== p || !ctx.loser || ctx.loser.hp >= ctx.loser.maxHp) return;
        if (!g.inAttackRange(p, ctx.loser)) return;
        g.restoreSlot(p);
        g.update();
      },
      damaged: async (g, ctx, p) => {
        if (ctx.target !== p || !ctx.source || ctx.source === p) return;
        const src = ctx.source;
        if (src.hp >= src.maxHp || !g.inAttackRange(p, src)) return;
        g.restoreSlot(p);
        g.update();
      },
    },
  };

  /* =========================================================
     神將 8 隻
     ========================================================= */
  Object.assign(G, {
    '神關羽': { name: '神關羽', kingdom: '神', hp: 5, gender: 'male', pack: 'god', skills: ['武神', '武魂'] },
    '神呂布': { name: '神呂布', kingdom: '神', hp: 5, gender: 'male', pack: 'god', skills: ['狂暴', '無謀', '無前', '神憤'] },
    '神曹操': { name: '神曹操', kingdom: '神', hp: 3, gender: 'male', pack: 'god', skills: ['歸心', '飛影'] },
    '神司馬懿': { name: '神司馬懿', kingdom: '神', hp: 4, gender: 'male', pack: 'god', skills: ['忍戒', '連破', '拜印'] },
    '神諸葛亮': { name: '神諸葛亮', kingdom: '神', hp: 3, gender: 'male', pack: 'god', skills: ['七星', '狂風', '大霧'] },
    '神趙雲': { name: '神趙雲', kingdom: '神', hp: 2, gender: 'male', pack: 'god', skills: ['絕境', '龍魂'] },
    '神呂蒙': { name: '神呂蒙', kingdom: '神', hp: 3, gender: 'male', pack: 'god', skills: ['涉獵', '攻心'] },
    '神周瑜': { name: '神周瑜', kingdom: '神', hp: 4, gender: 'male', pack: 'god', skills: ['琴音', '業炎'] },
    '神劉備': { name: '神劉備', kingdom: '神', hp: 6, gender: 'male', pack: 'god', skills: ['龍怒', '結營'] },
    '神陸遜': { name: '神陸遜', kingdom: '神', hp: 4, gender: 'male', pack: 'god', skills: ['軍略', '摧克', '綻火'] },
    '神張遼·雷': { name: '神張遼·雷', kingdom: '神', hp: 4, gender: 'male', pack: 'god', base: '張遼', skills: ['奪銳·雷', '止啼·雷'] },
    '神張遼·OL': { name: '神張遼·OL', kingdom: '神', hp: 4, gender: 'male', pack: 'god', base: '張遼', skills: ['奪銳·OL', '止啼·OL'] },
    '神張遼·珍藏': { name: '神張遼·珍藏', kingdom: '神', hp: 4, gender: 'male', pack: 'god', base: '張遼', skills: ['奪銳·珍藏', '止啼·珍藏'] },
  });

  /* =========================================================
     SP 將
     ========================================================= */
  Object.assign(G, {
    'SP趙雲': { name: 'SP趙雲', kingdom: '蜀', hp: 4, gender: 'male', pack: 'sp', skills: ['龍膽', '衝陣'] },
    'SP馬超': { name: 'SP馬超', kingdom: '蜀', hp: 4, gender: 'male', pack: 'sp', skills: ['馬術', '鐵騎·界'] },
    'SP賈詡': { name: 'SP賈詡', kingdom: '群', hp: 3, gender: 'male', pack: 'sp', skills: ['帷幕', '亂武'] },
    'SP貂蟬': { name: 'SP貂蟬', kingdom: '群', hp: 3, gender: 'female', pack: 'sp', skills: ['離間', '閉月'] },
    'SP呂布': { name: 'SP呂布', kingdom: '群', hp: 4, gender: 'male', pack: 'sp', skills: ['無雙', '無敵'] },
    'SP劉備': { name: 'SP劉備', kingdom: '蜀', hp: 4, gender: 'male', pack: 'sp', skills: ['仁德', '激將'] },
  });

  /* =========================================================
     一將成名
     ========================================================= */
  Object.assign(G, {
    '曹丕': { name: '曹丕', kingdom: '魏', hp: 4, gender: 'male', pack: 'famous', skills: ['行殤', '放逐'] },
    '徐晃': { name: '徐晃', kingdom: '魏', hp: 4, gender: 'male', pack: 'famous', skills: ['斷糧'] },
    '張郃': { name: '張郃', kingdom: '魏', hp: 4, gender: 'male', pack: 'famous', skills: ['巧變'] },
    '龐德': { name: '龐德', kingdom: '魏', hp: 4, gender: 'male', pack: 'famous', skills: ['馬術', '猛進'] },
    '荀彧': { name: '荀彧', kingdom: '魏', hp: 3, gender: 'male', pack: 'famous', skills: ['節命', '驅虎'] },
    '關興': { name: '關興', kingdom: '蜀', hp: 4, gender: 'male', pack: 'famous', skills: ['武聖', '衝陣'] },
    '張苞': { name: '張苞', kingdom: '蜀', hp: 4, gender: 'male', pack: 'famous', skills: ['咆哮'] },
    '孫魯班': { name: '孫魯班', kingdom: '吳', hp: 3, gender: 'female', pack: 'famous', skills: ['國色', '流離'] },
  });

  // 放逐 / 節命 / 驅虎（一將成名用）
  SK['放逐'] = {
    type: 'trigger',
    desc: '當你受到傷害後，你可以令一名角色摸 X 張牌（X 為你已損失的體力）。',
    events: {
      async damaged(g, ctx, p) {
        if (ctx.target !== p) return;
        const yes = await g.askSkill(p, '放逐');
        if (!yes) return;
        const tg = await g.askTargets(p, { prompt: '【放逐】選擇摸牌的角色', candidates: g.alive(), cancelable: true });
        if (!tg.length) return;
        const n = Math.max(1, p.maxHp - p.hp);
        g.drawCards(tg[0], n, '放逐');
      },
    },
  };

  SK['節命'] = {
    type: 'trigger',
    desc: '摸牌階段，你可以多摸 X 張牌（X 為你已損失的體力），然後將這些牌交給任意角色。',
    events: {
      async phaseStart(g, ctx, p) {
        if (ctx.player !== p || ctx.phase !== 'draw') return;
        const x = p.maxHp - p.hp;
        if (x <= 0) return;
        const yes = await g.askSkill(p, '節命', `是否發動【節命】多摸 ${x} 張並分給他人？`);
        if (!yes) return;
        const cards = g.drawCards(p, x, '節命');
        for (const c of cards) {
          const tg = await g.askTargets(p, { prompt: `【節命】將 ${C.cardText(c)} 交給一名角色（選自己保留）`, candidates: g.alive(), cancelable: true });
          if (!tg.length) break;
          if (tg[0] === p) continue;
          const i = p.hand.indexOf(c);
          if (i >= 0) { p.hand.splice(i, 1); tg[0].hand.push(c); }
        }
      },
    },
  };

  SK['驅虎'] = {
    type: 'active',
    desc: '出牌階段，你可以棄置一張牌，令一名角色失去 1 點體力。',
    canUse(g, p) {
      const total = p.hand.length + ['weapon', 'armor', 'horse+', 'horse-', 'treasure'].filter(s => p.equips[s]).length;
      return total > 0 && g.others(p).length > 0;
    },
    async active(g, p) {
      const card = await g.askCard(p, { prompt: '【驅虎】棄置一張牌', from: 'any', cancelable: true });
      if (!card) return;
      const tg = await g.askTargets(p, { prompt: '【驅虎】選擇一名角色', candidates: g.others(p), cancelable: true });
      if (!tg.length) return;
      g.consumeCards(p, [card], '驅虎');
      await g.loseHp(tg[0], 1, '驅虎');
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
