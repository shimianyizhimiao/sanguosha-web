/* 三國殺 · 核心引擎（回合流程、出牌結算、傷害、瀕死、判定）
   純邏輯，不含 DOM。所有「問玩家」都走 controller.respond() 的 Promise 介面，
   所以同一套引擎可以跑 AI、跑真人 UI、也可以拿來在 Node 裡做大量模擬。
*/
(function (root) {
  'use strict';

  const C = root.SGS_CARDS;
  const isRed = C.isRed, isBlack = C.isBlack;

  const rnd = (a, b) => a + Math.random() * (b - a);

  class Game {
    constructor(opts) {
      opts = opts || {};
      this.mode = opts.mode || 'id5';
      this.players = [];
      this.deck = [];
      this.discardPile = [];
      this.logs = [];
      this.turnNo = 0;
      this.winner = null;
      this.over = false;
      this.current = null;
      this.phase = null;
      this.eventQueue = [];
      this.seedInfo = opts.seed || null;
      this.rand = opts.rand || Math.random;
      this.onLog = opts.onLog || null;
      this.onUpdate = opts.onUpdate || null;
      this.doubleGeneral = !!opts.doubleGeneral;
      this.maxTurns = opts.maxTurns || 400;
      this.stats = { turns: 0, cards: 0 };
      // 技能表由 generals.js 註冊
      this.SK = root.SGS_SKILLS || {};
      this.GENERALS = root.SGS_GENERALS || {};
    }

    /* ============================ 基礎 ============================ */
    log(msg, kind) {
      const entry = { t: ++this.logSeq || (this.logSeq = 1), msg, kind: kind || 'info' };
      entry.n = this.logs.length + 1;
      this.logs.push(entry);
      if (this.logs.length > 600) this.logs.shift();
      if (this.onLog) this.onLog(entry);
      return entry;
    }
    update() { if (this.onUpdate) this.onUpdate(this); }
    emit(type, data) { if (this.onEvent) this.onEvent(type, data || {}); }
    alive() { return this.players.filter(p => p.alive); }
    aliveCount() { return this.alive().length; }
    others(p) { return this.players.filter(x => x !== p && x.alive); }
    nextAlive(p) {
      const n = this.players.length;
      let i = (p.seat + 1) % n;
      for (let k = 0; k < n; k++) {
        const q = this.players[i];
        if (q.alive) return q;
        i = (i + 1) % n;
      }
      return null;
    }
    playerById(id) { return this.players.find(p => p.id === id); }
    wait(ms) { return new Promise(r => setTimeout(r, ms)); }

    /* ============================ 牌堆 ============================ */
    drawFromDeck(n) {
      const out = [];
      for (let i = 0; i < n; i++) {
        if (this.deck.length === 0) {
          if (this.discardPile.length === 0) break;
          this.deck = C.shuffle(this.discardPile.splice(0), this.rand);
          this.log('牌堆用盡，棄牌堆重新洗入牌堆');
        }
        out.push(this.deck.pop());
      }
      return out;
    }
    peekDeck(n) { return this.deck.slice(-n).reverse(); }
    putOnDeckTop(cards) { this.deck.push(...cards); }

    drawCards(p, n, reason) {
      let cards;
      if (p.skills && p.skills.includes('寸目') && !this.isSilenced(p, '寸目')) {
        cards = [];
        for (let i = 0; i < n && this.deck.length; i++) cards.push(this.deck.shift());   // 寸目：從牌堆底摸
      } else cards = this.drawFromDeck(n);
      p.hand.push(...cards);
      if (reason) this.log(`${this.nameOf(p)} 摸 ${cards.length} 張牌（${reason}）`, 'draw');
      else this.log(`${this.nameOf(p)} 摸了 ${cards.length} 張牌`, 'draw');
      this.emit('draw', { player: p, n: cards.length });
      return cards;
    }

    toDiscard(cards) {
      for (const c of cards) {
        if (!c) continue;
        if (C.isRed(c)) this.turnRedCount = (this.turnRedCount || 0) + 1;
        // 虛擬牌（技能合成、沒有實體子牌）不進棄牌堆，否則牌數會多出來
        if (c.virtual && !(c.subcards && c.subcards.length)) continue;
        this.discardPile.push(c);
      }
    }

    /* 從角色任一區域移除卡（手牌/裝備/判定區） */
    removeCardFromPlayer(p, card) {
      let i = p.hand.indexOf(card);
      if (i >= 0) {
        p.hand.splice(i, 1);
        if (p.hand.length === 0 && p.alive && p.skills.includes('連營')) this.drawCards(p, 1, '連營');
        return { zone: 'hand', card };
      }
      for (const slot of ['weapon', 'armor', 'horse+', 'horse-', 'treasure']) {
        if (p.equips[slot] === card) {
          const old = p.equips[slot];
          p.equips[slot] = null;
          if (old && old.name === '白銀獅子') { p.hp = Math.min(p.maxHp, p.hp + 1); this.log('白銀獅子離場，回復 1 點體力', 'heal'); }
          if (p.alive && p.skills.includes('梟姬')) this.drawCards(p, 2, '梟姬');
          this.onEquipChange(p, old, null);
          return { zone: 'equip', slot, card: old };
        }
      }
      i = p.judge.indexOf(card);
      if (i >= 0) { p.judge.splice(i, 1); return { zone: 'judge', card }; }
      return null;
    }

    /* 取得角色區域內所有可見卡片（用於過河拆橋等） */
    cardsInArea(p) {
      const out = [];
      for (const c of p.hand) out.push({ card: c, zone: 'hand' });
      for (const slot of ['weapon', 'armor', 'horse+', 'horse-', 'treasure']) {
        if (p.equips[slot]) out.push({ card: p.equips[slot], zone: 'equip', slot });
      }
      for (const c of p.judge) out.push({ card: c, zone: 'judge' });
      return out;
    }

    onEquipChange(p, oldCard, newCard) {
      // 棄牌由呼叫端負責，這裡只記錄
      if (newCard) this.log(`${this.nameOf(p)} 裝備了 ${C.cardText(newCard)}`, 'equip');
    }

    /* ============================ 距離 / 範圍 ============================ */
    seatDistance(a, b) {
      if (a === b) return 0;
      const alive = this.alive();
      const n = alive.length;
      const ia = alive.indexOf(a), ib = alive.indexOf(b);
      if (ia < 0 || ib < 0) return 99;
      let d = Math.abs(ia - ib);
      return Math.min(d, n - d);
    }
    armorOf(p) {
      if (p.armorOff) return null;
      if (p.equips.armor) return p.equips.armor;
      // 八陣（鎖定技）：裝備區沒有防具時視為裝備【八卦陣】
      if (p.skills && p.skills.includes('八陣') && !this.isSilenced(p, '八陣')) {
        if (!this._baguaVirtual) this._baguaVirtual = { name: '八卦陣', slot: 'armor', virtual: true, id: 'v八陣' };
        return this._baguaVirtual;
      }
      return null;
    }

    distance(a, b) {
      if (a === b) return 0;
      if (a.turnFlags && a.turnFlags.noDistance) return 1;   // 決堰：本回合使用牌無距離限制
      let d = this.seatDistance(a, b);
      d += a.equips['horse-'] ? -1 : 0;   // 自己 -1 馬
      d += b.equips['horse+'] ? 1 : 0;    // 對方 +1 馬
      d += (a.modDistance ? a.modDistance(b) : 0);
      d -= (a.turnFlags && a.turnFlags.distX ? a.turnFlags.distX : 0);
      d += (b.modDefenseDistance ? b.modDefenseDistance(a) : 0);
      d = Math.max(1, d);
      return d;
    }
    attackRange(p) {
      const w = p.equips.weapon;
      let r = w && w.range ? w.range : 1;
      if (p.modAttackRange) r += p.modAttackRange();
      return r;
    }
    inAttackRange(a, b) { return this.distance(a, b) <= this.attackRange(a); }
    // 使用【殺】時是否構得到（部分技能可無視距離）
    shaReachable(a, b) {
      if (a.turnFlags && a.turnFlags.shaNoRange) return true;
      return this.inAttackRange(a, b);
    }
    canTargetByDistance(a, b) { return a === b ? false : true; }

    /* ============================ 詢問玩家 ============================ */
    async ask(p, req) {
      req.player = p;
      req.game = this;
      this.update();
      const ctrl = p.controller;
      if (!ctrl) throw new Error('玩家 ' + p.name + ' 沒有 controller');
      const res = await ctrl.respond(this, p, req);
      this.update();
      return res;
    }

    /* 詢問是否發動技能 */
    async askSkill(p, skillName, prompt) {
      const yes = await this.ask(p, {
        kind: 'choice', prompt: prompt || `是否發動【${skillName}】？`,
        options: ['發動', '取消'], skill: skillName, cancelable: true,
      });
      if (yes === 0) this.emit('skill', { player: p, skill: skillName });
      return yes === 0;
    }

    /* 選擇一名角色 */
    async askTargets(p, opt) {
      const cands = (opt.candidates || this.others(p)).filter(q => q.alive)
        .filter(q => !opt.cardName || this.canBeTargeted(p, q, opt.cardName));
      if (cands.length === 0) return [];
      const res = await this.ask(p, {
        kind: 'targets', prompt: opt.prompt || '選擇目標',
        candidates: cands.map(q => q.id), min: opt.min || 1, max: opt.max || 1,
        cancelable: !!opt.cancelable,
      });
      if (!res) return [];
      return res.map(id => this.playerById(id)).filter(Boolean);
    }

    /* 需要打出一張指定名稱的牌；回傳 {card, name, skill} 或 null */
    async askForCard(p, name, ctx) {
      ctx = ctx || {};
      const opts = this.responseOptions(p, name, ctx);
      if (opts.length === 0) return null;
      const res = await this.ask(p, {
        kind: 'response', need: name, prompt: ctx.prompt || `請打出一張【${name}】`,
        options: opts.map(o => ({ cards: o.cards.map(c => c.id), skill: o.skill || null, label: o.label })),
        cancelable: !!ctx.cancelable,
      });
      if (!res) return null;
      if (res.assist) {
        const sk = this.SK[res.skill];
        const got = sk && sk.assist.provide ? await sk.assist.provide(this, p, ctx) : null;
        if (got) return { cards: [got], name, skill: res.skill, fromAssist: true };
        return null;
      }
      const cards = (res.cards || []).map(id => this.findCard(p, id)).filter(Boolean);
      if (cards.length === 0) return null;
      return { cards, name, skill: res.skill || null, label: res.label || null };
    }

    findCard(p, id) {
      const all = [...p.hand];
      for (const slot of ['weapon', 'armor', 'horse+', 'horse-', 'treasure']) if (p.equips[slot]) all.push(p.equips[slot]);
      if (p.judge) all.push(...p.judge);
      return all.find(c => c.id === id) || null;
    }

    /* 從手牌/裝備區選牌 */
    async askCards(p, opt) {
      opt = opt || {};
      const from = opt.from || 'hand';
      let pool = [];
      if (opt.pool) pool = opt.pool.slice();
      else if (from === 'hand' || from === 'any') pool.push(...p.hand);
      if (from === 'equip' || from === 'any') {
        for (const slot of ['weapon', 'armor', 'horse+', 'horse-', 'treasure']) if (p.equips[slot]) pool.push(p.equips[slot]);
      }
      if (opt.filter) pool = pool.filter(c => this.matchFilter(c, opt.filter));
      const min = opt.min == null ? 1 : opt.min;
      if (pool.length < min) return [];
      const res = await this.ask(p, {
        kind: 'cards', prompt: opt.prompt || '選擇手牌',
        cards: pool.map(c => c.id),
        cardData: pool.map(c => ({ id: c.id, name: c.name, suit: c.suit, rank: c.rank, color: c.color })),
        min, max: opt.max == null ? min : opt.max, cancelable: !!opt.cancelable,
      });
      if (!res || res.length < min) return [];
      return res.slice(0, opt.max == null ? min : opt.max).map(id => pool.find(c => c.id === id)).filter(Boolean);
    }

    async askCard(p, opt) {
      const arr = await this.askCards(p, Object.assign({}, opt, { min: 1, max: 1 }));
      return arr[0] || null;
    }

    /* 一名角色能否成為使用者的目標（含空城等限制） */
    canBeTargeted(source, target, cardName, card) {
      if (source && source.turnFlags && source.turnFlags['不能對' + target.id]) return false;   // 拒戰：本回合不能再對其使用牌
      if (source && source.skills && source.skills.includes('掣政') && !this.isSilenced(source, '掣政')
          && !this.inAttackRange(target, source)) return false;                                // 掣政
      if (!target || !target.alive) return false;
      for (const skName of target.skills) {
        const sk = this.SK[skName];
        if (sk && sk.cannotBeTargeted && sk.cannotBeTargeted(this, target, source, cardName, card)) return false;
      }
      return true;
    }

    /* 回傳「可以拿來當 name 用」的選項（含技能轉化） */
    responseOptions(p, name, ctx) {
      const out = [];
      if (p.silentHand != null && p.silentHand === p.turnCount) return out;   // 雄亂：不能打出手牌
      for (const c of p.hand) {
        if (c.name === name || (name === '殺' && C.isSha(c))) out.push({ cards: [c], label: C.cardText(c) });
      }
      // 技能轉化
      const convs = (root.SGS_CONVERT || []).filter(cv => cv.to === name);
      for (const cv of convs) {
        const sk = p.skills.includes(cv.skill) ? cv : null;
        if (!sk) continue;
        if (cv.when && !cv.when(this, p, ctx)) continue;
        if (ctx.noSkill && ctx.noSkill.includes(cv.skill)) continue;
        for (const c of p.hand) {
          if (this.matchFilter(c, sk.from) && !out.some(o => o.cards[0] === c && o.skill === sk.skill)) {
            out.push({ cards: [c], skill: cv.skill, label: `${C.cardText(c)} 當【${name}】` });
          }
        }
      }
      // 主公技協助（激將 / 護駕）
      for (const skName of p.skills) {
        const sk = this.SK[skName];
        if (sk && sk.assist && sk.assist.need === name) {
          out.push({ cards: [], skill: skName, assist: true, label: `發動【${skName}】` });
        }
      }
      // 龍魂：兩張同花色手牌當【殺】或【閃】
      if ((name === '殺' || name === '閃') && p.skills.includes('龍魂') && p.hand.length >= 2) {
        for (let i = 0; i < p.hand.length; i++) {
          for (let j = i + 1; j < p.hand.length; j++) {
            if (p.hand[i].suit === p.hand[j].suit) {
              out.push({ cards: [p.hand[i], p.hand[j]], skill: '龍魂', label: `兩張${p.hand[i].suit}當【${name}】` });
            }
          }
        }
      }
      // 丈八蛇矛
      if (name === '殺' && p.equips.weapon && p.equips.weapon.name === '丈八蛇矛' && p.hand.length >= 2) {
        for (let i = 0; i < p.hand.length; i++) {
          for (let j = i + 1; j < p.hand.length; j++) {
            out.push({ cards: [p.hand[i], p.hand[j]], skill: '丈八蛇矛', label: `兩張手牌當【殺】` });
          }
        }
      }
      return out;
    }

    matchFilter(card, f) {
      if (!f) return true;
      if (f.color === 'red' && !isRed(card)) return false;
      if (f.color === 'black' && !isBlack(card)) return false;
      if (f.suit && card.suit !== f.suit) return false;
      if (f.names && !f.names.includes(card.name)) return false;
      if (f.type && card.type !== f.type) return false;
      return true;
    }

    /* ============================ 標記 / 限定技 ============================ */
    addMark(p, name, n) {
      p.marks[name] = (p.marks[name] || 0) + (n == null ? 1 : n);
      this.log(`${this.nameOf(p)} 獲得「${name}」×${n == null ? 1 : n}（共 ${p.marks[name]}）`, 'skill');
      return p.marks[name];
    }
    marks(p, name) { return (p.marks && p.marks[name]) || 0; }

    /* 七星：「星」移去時進棄牌堆 */
    removeStars(p, n) {
      const k = Math.min(n || 1, (p.stars || []).length);
      if (!k) return 0;
      const cards = p.stars.splice(0, k);
      this.toDiscard(cards);
      return k;
    }
    removeMark(p, name, n) {
      const k = n == null ? 1 : n;
      p.marks[name] = Math.max(0, this.marks(p, name) - k);
      return p.marks[name];
    }
    canUseLimit(p, key) { return !(p.usedLimit && p.usedLimit[key]); }
    useLimit(p, key) { p.usedLimit[key] = true; }

    /* ============================ 傷害 / 體力 ============================ */
    async heal(p, n, reason) {
      const before = p.hp;
      p.hp = Math.min(p.maxHp, p.hp + n);
      if (p.hp !== before) {
        this.log(`${this.nameOf(p)} 回復 ${p.hp - before} 點體力（${p.hp}/${p.maxHp}）${reason ? ' · ' + reason : ''}`, 'heal');
        this.emit('heal', { target: p, amount: p.hp - before });
      }
      return p.hp - before;
    }

    async loseMaxHp(p, n, reason) {
      p.maxHp = Math.max(0, p.maxHp - (n || 1));
      if (p.hp > p.maxHp) p.hp = p.maxHp;
      this.log(`${this.nameOf(p)} 減少 ${n || 1} 點體力上限（${p.maxHp}）` + (reason ? ' · ' + reason : ''), 'info');
      this.update();
      if (p.hp <= 0 && p.alive) await this.dying(p, null);
    }

    gainMaxHp(p, n) {
      p.maxHp = (p.maxHp || 0) + n;
      this.log(`${this.nameOf(p)} 體力上限 +${n}（${p.maxHp}）`, 'info');
      this.update();
    }

    async loseHp(p, n, reason) {
      p.hp -= n;
      this.log(`${this.nameOf(p)} 失去 ${n} 點體力（${Math.max(0, p.hp)}/${p.maxHp}）${reason ? ' · ' + reason : ''}`, 'damage');
      if (p.hp <= 0) await this.dying(p, null);
    }

    async damage(source, target, amount, nature, card, opt) {
      if (!target.alive || amount <= 0) return 0;
      const ctx = { source, target, amount, nature: nature || 'normal', card, canceled: false };
      await this.trigger('beforeDamaged', ctx);
      if (ctx.canceled || !target.alive) return 0;
      let amt = ctx.amount;
      // 技能傷害覆寫／加成（蠻刃、威嚴…）
      for (const q of this.alive()) {
        for (const sk of q.skills || []) {
          const def = (root.SGS_SKILLS || {})[sk];
          if (!def || this.isSilenced(q, sk)) continue;
          if (def.damageOverride) {
            const v = def.damageOverride(this, { source, target, card, amount: amt, nature }, q);
            if (v > 0) amt = v;
          }
          if (def.damageBonus) amt += def.damageBonus(this, { source, target, card, amount: amt, nature }, q);
        }
      }
      // 藤甲：火焰傷害 +1
      if (nature === 'fire' && this.armorOf(target) && this.armorOf(target).name === '藤甲') amt += 1;
      // 滅殺（鎖定技）：對體力值為 1 的角色傷害 +1
      if (source && source.skills && source.skills.includes('滅殺') && target.hp === 1) {
        amt += 1;
        this.log(`【滅殺】對體力 1 的 ${this.nameOf(target)} 傷害 +1`, 'skill');
      }
      // 禍首（鎖定技）：南蠻入侵造成的傷害由禍首代為來源
      if (card && card.name === '南蠻入侵') {
        const huo = this.alive().find(q => q.skills && q.skills.includes('禍首') && !this.isSilenced(q, '禍首'));
        if (huo && huo !== target) {
          source = huo;
          this.log(`【禍首】：傷害來源轉為 ${this.nameOf(huo)}`, 'skill');
        }
      }
      // 狂風：受到火焰傷害 +1
      if (nature === 'fire' && target.qingFengBy) {
        amt += 1;
        this.log(`${this.nameOf(target)} 受【狂風】影響，火焰傷害 +1`, 'info');
      }
      // 大霧：防止非雷電傷害
      if (target.daWBy && nature !== 'thunder') {
        this.log(`${this.nameOf(target)} 受【大霧】保護，傷害被防止`, 'info');
        return 0;
      }
      // 白銀獅子：防止超過 1 點的傷害
      if (this.armorOf(target) && this.armorOf(target).name === '白銀獅子' && amt > 1) amt = 1;
      // 白銀獅子之類不在標準版
      target.hp -= amt;
      this.log(`${this.nameOf(target)} 受到 ${amt} 點${nature === 'fire' ? '火焰' : nature === 'thunder' ? '雷電' : ''}傷害` +
        `${source ? '（來源：' + this.nameOf(source) + '）' : ''} → ${Math.max(0, target.hp)}/${target.maxHp}`, 'damage');
      this.emit('damage', { source, target, amount: amt, nature });
      if (source && source.hostility) source.hostility[target.id] = (source.hostility[target.id] || 0) + amt;
      if (target.hostility && source) target.hostility[source.id] = (target.hostility[source.id] || 0) + amt * 0.5;
      this.update();
      await this.trigger('damaged', { source, target, amount: amt, nature, card });
      if (target.hp <= 0) await this.dying(target, source);
      // 鐵索連環：屬性傷害傳導
      const spread = !(opt && opt.noSpread) && target.chained && (nature === 'fire' || nature === 'thunder');
      if (spread && target.alive) {
        for (const q of this.alive()) {
          if (q === target || !q.chained) continue;
          this.log(`鐵索連環傳導 → ${this.nameOf(q)}`);
          await this.damage(source, q, amt, nature, card, { noSpread: true });
        }
      }
      return amt;
    }

    /* 瀕死求桃 */
    async dying(p, source) {
      if (p.hp > 0 || !p.alive) return;
      await this.trigger('dying', { player: p, source });
      if (p.hp > 0) return;
      this.log(`${this.nameOf(p)} 進入瀕死狀態！`, 'warn');
      let guard = 0;
      while (p.hp <= 0 && p.alive && guard++ < 30) {
        let saved = false;
        const order = [p, ...this.players.filter(x => x.alive && x !== p)
          .sort((a, b) => this.seatDistance(p, a) - this.seatDistance(p, b))];
        for (const q of order) {
          if (p.hp > 0) break;
          if (!q.alive) continue;
          if (q === p) {
            const r = await this.askForCard(p, '桃', { prompt: '你處於瀕死狀態，是否使用【桃】自救？', cancelable: true });
            if (r) { this.consumeCards(p, r.cards, '桃'); await this.heal(p, 1, '自救'); saved = true; }
          } else {
            if (this.current && this.current !== q && this.current.skills.includes('完殺')) {
              this.log(`【完殺】：${this.nameOf(q)} 不能使用【桃】`, 'info');
              continue;
            }
            const r = await this.askForCard(q, '桃', { prompt: `${this.nameOf(p)} 瀕死，是否使用【桃】救援？`, cancelable: true });
            if (r) { this.consumeCards(q, r.cards, '桃'); await this.heal(p, 1, '救援'); saved = true; }
          }
          if (saved) break;
        }
        if (!saved) break;
      }
      if (p.hp <= 0 && p.alive) await this.trySaveSkills(p, source);
      if (p.hp <= 0) await this.killPlayer(p, source);
    }

    /* 瀕死時能把人救回來的技能：涅槃（限定技）、不屈（鎖定技） */
    async trySaveSkills(p, source) {
      // 涅槃：棄置所有牌，體力回复至 3，摸三張
      if (p.skills.includes('涅槃') && !p.usedNirvana && !this.isSilenced(p, '涅槃')) {
        const yes = await this.askSkill(p, '涅槃', '【涅槃】是否棄置所有牌、回复至 3 點體力並摸三張牌？');
        if (yes) {
          p.usedNirvana = true;
          const all = p.hand.slice();
          for (const slot of ['weapon', 'armor', 'horse+', 'horse-', 'treasure']) {
            if (p.equips[slot]) { all.push(p.equips[slot]); p.equips[slot] = null; }
          }
          if (p.judge && p.judge.length) all.push(...p.judge.splice(0));
          p.hand.length = 0;
          this.toDiscard(all);
          p.hp = Math.min(3, p.maxHp);
          this.drawCards(p, 3);
          this.log(`${this.nameOf(p)} 發動【涅槃】：棄置所有牌、回复至 ${p.hp} 點體力並摸三張牌`, 'skill');
          this.emit('heal', { target: p, amount: p.hp });
          this.update();
          return;
        }
      }
      // 不屈：牌堆頂一張置於武將牌上，點數互異則回复至 1 點
      if (p.skills.includes('不屈') && !this.isSilenced(p, '不屈')) {
        p.buqu = p.buqu || [];
        const c = this.drawFromDeck(1)[0];
        if (!c) return;
        p.buqu.push(c);
        const ranks = p.buqu.map(x => String(x.rank));
        const distinct = new Set(ranks).size === ranks.length;
        if (distinct) {
          p.hp = 1;
          this.log(`${this.nameOf(p)} 發動【不屈】：${C.cardText(c)}（不屈牌 ${ranks.join('、')}）→ 回复至 1 點體力`, 'skill');
          this.emit('heal', { target: p, amount: 1 });
        } else {
          this.log(`${this.nameOf(p)} 的【不屈】點數重複（${ranks.join('、')}），瀕死未解除`, 'warn');
        }
        this.update();
      }
    }

    consumeCards(p, cards, asName) {
      const real = [];
      for (const c of cards) {
        const r = this.removeCardFromPlayer(p, c);
        if (r) real.push(r.card);
        else if (c.virtual && c.subcards) real.push(...c.subcards);
      }
      this.toDiscard(real);
      return real;
    }

    async killPlayer(p, source) {
      if (source && source.alive && source.skills.includes('連破')) {
        source.extraTurn = true;
        this.log(`${this.nameOf(source)} 擊殺 ${this.nameOf(p)}，【連破】將獲得額外回合`, 'skill');
      }
      p.alive = false;
      p.hp = 0;
      p.identityRevealed = true;
      this.toDiscard(p.hand.splice(0));
      for (const slot of ['weapon', 'armor', 'horse+', 'horse-', 'treasure']) {
        if (p.equips[slot]) { this.toDiscard([p.equips[slot]]); p.equips[slot] = null; }
      }
      this.toDiscard(p.judge.splice(0));
      if (p.stars && p.stars.length) this.toDiscard(p.stars.splice(0));   // 七星：星也要進棄牌堆
      if (p.buqu && p.buqu.length) this.toDiscard(p.buqu.splice(0));       // 不屈牌：死亡時一併棄置
      if (p.ren) { this.toDiscard([p.ren]); p.ren = null; }                // 明任的「任」
      if (p.qianhuan && p.qianhuan.length) this.toDiscard(p.qianhuan.splice(0));   // 千幻牌
      if (p.kongsheng && p.kongsheng.length) this.toDiscard(p.kongsheng.splice(0)); // 箜聲牌
      if (p.rong && p.rong.length) this.toDiscard(p.rong.splice(0));                 // 榮牌
      this.log(`${this.nameOf(p)}（${p.identityName}）陣亡`, 'death');
      this.emit('death', { player: p, source });
      this.update();
      await this.trigger('onDeath', { player: p, source });
      // 獎懲
      if (source && source.alive) {
        if (p.identity === 'rebel') { this.drawCards(source, 3, '擊殺反賊'); await this.trigger('onKill', { killer: source, victim: p }); }
        else if (p.identity === 'loyal' && source.identity === 'lord') {
          this.log(`${this.nameOf(source)} 誤殺忠臣，棄置所有牌`, 'warn');
          this.toDiscard(source.hand.splice(0));
          for (const slot of ['weapon', 'armor', 'horse+', 'horse-', 'treasure']) {
            if (source.equips[slot]) { this.toDiscard([source.equips[slot]]); source.equips[slot] = null; }
          }
        }
      }
      this.checkWin();
    }

    checkWin() {
      if (this.over) return;
      if (this.mode === 'duel') {
        const alive = this.alive();
        if (alive.length <= 1) this.setWinner(alive[0] || null, 'duel');
        return;
      }
      const lord = this.players.find(p => p.identity === 'lord');
      if (!lord.alive) {
        const alive = this.alive();
        const rebels = alive.filter(p => p.identity === 'rebel');
        const spies = alive.filter(p => p.identity === 'spy');
        if (alive.length === 1 && spies.length === 1) this.setWinner(spies[0], 'spy');
        else if (rebels.length > 0) this.setWinner(rebels[0], 'rebel');
        else this.setWinner(alive[0] || null, 'spy');
        return;
      }
      const bad = this.alive().filter(p => p.identity === 'rebel' || p.identity === 'spy');
      if (bad.length === 0) this.setWinner(lord, 'lord');
    }

    setWinner(p, side) {
      this.over = true;
      this.winner = { player: p, side };
      const names = { lord: '主公陣營', rebel: '反賊陣營', spy: '內奸', duel: '單挑' };
      this.log(`遊戲結束：${names[side] || side} 勝利！`, 'end');
      this.update();
    }

    /* ============================ 技能觸發 ============================ */
    // 技能是否正被暫時無效（存「到第幾個自己的回合結束前」）
    isSilenced(p, skName) {
      if (p.skills && p.skills.includes('纏怨') && skName !== '纏怨' && p.hp === 1) return true;   // 纏怨：體力 1 時其他技能失效
      const until = p.silenced && p.silenced[skName];
      if (until == null) return false;
      if ((p.turnCount || 0) >= until) { delete p.silenced[skName]; return false; }
      return true;
    }

    // 廢除裝備欄：丟棄該欄裝備並封鎖
    abolishSlot(p, preferSlot) {
      const slots = ['weapon', 'armor', 'horse+', 'horse-', 'treasure'];
      const free = slots.filter(sl => !p.deadSlots[sl]);
      if (!free.length) return null;
      const slot = (preferSlot && free.includes(preferSlot)) ? preferSlot : free[0];
      const card = p.equips[slot];
      if (card) { p.equips[slot] = null; this.toDiscard([card]); }
      p.deadSlots[slot] = true;
      this.log(`${this.nameOf(p)} 的「${C.SLOT_NAME[slot] || slot}」欄被廢除`, 'skill');
      return slot;
    }

    // 恢復裝備欄
    restoreSlot(p) {
      const slots = ['weapon', 'armor', 'horse+', 'horse-', 'treasure'];
      const dead = slots.filter(sl => p.deadSlots[sl]);
      if (!dead.length) return null;
      const slot = dead[0];
      delete p.deadSlots[slot];
      this.log(`${this.nameOf(p)} 恢復了「${C.SLOT_NAME[slot] || slot}」欄`, 'skill');
      return slot;
    }

    async trigger(event, ctx) {
      ctx.event = event;
      ctx.game = this;
      for (const p of this.players) {
        if (!p.alive && event !== 'onDeath') continue;   // 陣亡技（武魂等）要能觸發
        for (const skName of p.skills) {
          const sk = this.SK[skName];
          if (!sk || !sk.events || !sk.events[event]) continue;
          if (this.isSilenced(p, skName)) continue;
          await sk.events[event](this, ctx, p);
        }
      }
    }

    /* 紅顏等「花色視為」的統一入口 */
    suitOf(p, c) {
      if (!c) return null;
      if (p && p.skills && p.skills.includes('紅顏') && c.suit === '♠' && !this.isSilenced(p, '紅顏')) return '♥';
      return c.suit;
    }

    /* 拼點：雙方各出一張手牌比點數，回傳 { win, cp, cq }（cp/cq 已進棄牌堆） */
    async pindian(p, q, reason) {
      if (!p.hand.length || !q.hand.length) return null;
      const cp = await this.askCard(p, { prompt: `【${reason}】選擇一張手牌拼點`, pool: p.hand.slice() });
      if (!cp) return null;
      // 酣戰：與你拼點的角色隨機出手牌
      const randomQ = (p.skills && p.skills.includes('酣戰') && !this.isSilenced(p, '酣戰')) ||
                      (q.skills && q.skills.includes('酣戰') && !this.isSilenced(q, '酣戰'));
      const cq = randomQ
        ? q.hand[Math.floor(Math.random() * q.hand.length)]
        : await this.askCard(q, { prompt: `【${reason}】選擇一張手牌拼點`, pool: q.hand.slice() });
      if (!cq) return null;
      if (randomQ) this.log(`【酣戰】${this.nameOf(q)} 隨機出了 ${C.cardText(cq)} 拼點`, 'skill');
      const rankVal = c => (c.rank === 1 ? 14 : (typeof c.rank === 'number' ? c.rank : parseInt(c.rank, 10) || 0));
      if (cp.rank === 1) { /* A 最大 */ }
      const rp = rankVal(cp), rq = rankVal(cq);
      const ip = p.hand.indexOf(cp), iq = q.hand.indexOf(cq);
      if (ip >= 0) p.hand.splice(ip, 1);
      if (iq >= 0) q.hand.splice(iq, 1);
      this.toDiscard([cp, cq]);
      this.log(`【${reason}】拼點：${this.nameOf(p)} ${C.cardText(cp)} vs ${this.nameOf(q)} ${C.cardText(cq)} → ${rp > rq ? this.nameOf(p) + ' 贏' : rp < rq ? this.nameOf(q) + ' 贏' : '平手（沒贏）'}`, 'skill');
      await this.trigger('pindianEnd', { p, q, cp, cq, win: rp > rq });
      return { win: rp > rq, tie: rp === rq, cp, cq, rp, rq };
    }

    /* ============================ 判定 ============================ */
    async judge(p, reason, card) {
      const jc = this.drawFromDeck(1)[0];
      if (!jc) return null;
      this.log(`${this.nameOf(p)} 判定（${reason}）：${C.cardText(jc)}`, 'judge');
      this.emit('judge', { player: p, card: jc, reason });
      const ctx = { player: p, card: jc, reason, replaced: false, gain: null };
      await this.trigger('judge', ctx);
      if (ctx.replaced && ctx.old) this.toDiscard([ctx.old]);
      if (ctx.gain) ctx.gain.hand.push(ctx.card);
      else this.toDiscard([ctx.card]);
      this.update();
      return ctx.card;
    }

    /* ============================ 回合流程 ============================ */
    async runGame() {
      this.logGameStart();
      await this.trigger('gameStart', {});
      let guard = 0;
      while (!this.over && guard++ < this.maxTurns) {
        const p = this.players[this.turnNo % this.players.length];
        if (!p.alive) { this.turnNo++; continue; }
        this.turnNo++;
        this.stats.turns++;
        await this.runTurn(p);
        if (this.over) break;
        if (p.extraTurn && p.alive && !this.over) {
          p.extraTurn = false;
          this.stats.turns++;
          await this.runTurn(p);
          if (this.over) break;
        }
      }
      if (!this.over) this.log('回合數上限，判定為平局', 'warn');
      return this.winner;
    }

    logGameStart() {
      const ids = this.players.map(p => `${this.nameOf(p)}`).join(' / ');
      this.log('牌局開始：' + ids, 'end');
    }

    nameOf(p) {
      if (!p) return '？';
      const g = p.generals.map(x => x.name).join('&');
      return `${p.label || ''}${g}`;
    }

    async runTurn(p) {
      this.current = p;
      p.turnCount = (p.turnCount || 0) + 1;
      p.turnFlags = {};
      this.log(`── ${this.nameOf(p)} 的回合 ──`, 'turn');
      if (p.flipped) {
        p.flipped = false;
        this.log(`${this.nameOf(p)} 翻回正面，跳過本回合`, 'info');
        await this.trigger('flip', { player: p });
        this.update();
        return;
      }
      this.update();
      this.turnRedCount = 0;
      await this.trigger('turnStart', { player: p });
      if (!p.alive || this.over) return;

      // 判定階段（神速等技能可跳過判定＋摸牌階段）
      if (p.turnFlags.skipJudgeDraw) {
        this.log(`${this.nameOf(p)} 跳過判定階段與摸牌階段`, 'info');
      } else {
      this.phase = 'judge';
      await this.trigger('phaseStart', { player: p, phase: 'judge' });
      await this.judgePhase(p);
      }
      if (!p.alive || this.over) return;

      // 摸牌階段
      if (p.turnFlags.skipJudgeDraw) { /* 已隨判定階段一起跳過 */ }
      else {
      this.phase = 'draw';
      await this.trigger('phaseStart', { player: p, phase: 'draw' });
      if (p.turnFlags.skipDrawNext) {
        p.turnFlags.skipDrawNext = false;
        this.log(`${this.nameOf(p)} 因【斷糧】跳過摸牌階段`);
      } else if (!p.turnFlags.skipDraw) {
        let n = 2;
        if (p.modDrawCount) n = p.modDrawCount(n);
        this.drawCards(p, n);
      } else {
        this.log(`${this.nameOf(p)} 跳過摸牌階段`);
      }
      await this.trigger('phaseEnd', { player: p, phase: 'draw' });
      }
      if (!p.alive || this.over) return;

      // 出牌階段
      this.phase = 'play';
      await this.trigger('phaseStart', { player: p, phase: 'play' });
      if (!p.turnFlags.skipPlay) await this.playPhase(p);
      await this.trigger('phaseEnd', { player: p, phase: 'play' });
      if (!p.alive || this.over) return;

      // 棄牌階段
      this.phase = 'discard';
      await this.discardPhase(p);
      this.phase = 'end';
      await this.trigger('turnEnd', { player: p });
      // 回合結束：清掉「本回合」狀態（無前的防具失效、臨時技能）
      for (const q of this.players) q.armorOff = false;
      if (p.granted && p.granted.length) {
        p.granted = p.granted.filter(g0 => {
          if (g0.untilTurn != null && p.turnCount > g0.untilTurn) {
            const i = p.skills.indexOf(g0.name);
            if (i >= 0) p.skills.splice(i, 1);
            return false;
          }
          if (g0.untilTarget && (!g0.untilTarget.alive || g0.untilTarget.turnCount >= g0.untilTurn)) {
            const i = p.skills.indexOf(g0.name);
            if (i >= 0) p.skills.splice(i, 1);
            return false;
          }
          return true;
        });
      }
      this.update();
    }

    async judgePhase(p) {
      // 觀星等技能先處理
      await this.trigger('beforeJudgePhase', { player: p });
      const list = p.judge.slice();
      for (const jc of list) {
        if (!p.alive) return;
        if (!p.judge.includes(jc)) continue;
        p.judge.splice(p.judge.indexOf(jc), 1);
        if (jc.name === '樂不思蜀') {
          const res = await this.judge(p, '樂不思蜀');
          if (res && this.suitOf(p, res) !== '♥') {
            p.turnFlags.skipPlay = true;
            this.log(`樂不思蜀生效：${this.nameOf(p)} 跳過出牌階段`, 'warn');
          }
          this.toDiscard([jc]);
        } else if (jc.name === '兵糧寸斷') {
          const res = await this.judge(p, '兵糧寸斷');
          if (res && this.suitOf(p, res) !== '♣') {
            p.turnFlags.skipDraw = true;
            this.log(`兵糧寸斷生效：${this.nameOf(p)} 跳過摸牌階段`, 'warn');
          }
          this.toDiscard([jc]);
        } else if (jc.name === '閃電') {
          const res = await this.judge(p, '閃電');
          if (res && this.suitOf(p, res) === '♠' && res.rank >= 2 && res.rank <= 9) {
            this.toDiscard([jc]);
            await this.damage(null, p, 3, 'thunder', jc);
          } else {
            this.log('閃電未命中，傳給下一位角色');
            const nxt = this.nextAlive(p);
            if (nxt) nxt.judge.push(jc);
            else p.judge.push(jc);
          }
        } else {
          this.toDiscard([jc]);
        }
      }
    }

    async discardPhase(p) {
      const limit = this.handLimit(p);
      if (p.hand.length > limit) {
        const n = p.hand.length - limit;
        const res = await this.ask(p, {
          kind: 'discard', count: n, prompt: `棄牌階段：請棄置 ${n} 張手牌（手牌上限 ${limit}）`,
        });
        const cards = (res || []).map(id => p.hand.find(c => c.id === id)).filter(Boolean);
        for (const c of cards) { p.hand.splice(p.hand.indexOf(c), 1); }
        this.toDiscard(cards);
        if (cards.length) this.log(`${this.nameOf(p)} 棄置了 ${cards.length} 張牌`);
        if (cards.length) await this.trigger('discardPhaseEnd', { player: p, count: cards.length, cards });
      }
    }

    handLimit(p) {
      let lim = Math.max(0, p.hp);
      // 結營：已橫置的角色手牌上限 +2
      if (p.chained && this.players.some(q => q.alive && q.skills.includes('結營'))) lim += 2;
      // 其他技能的手牌上限光環（例如止啼）
      for (const q of this.players) {
        if (!q.alive) continue;
        for (const skName of q.skills) {
          const sk = this.SK[skName];
          if (sk && sk.limitFor && !this.isSilenced(q, skName)) lim += sk.limitFor(this, q, p) || 0;
        }
      }
      if (p.turnFlags && p.turnFlags.limitToMax) lim = p.maxHp;      // 放權
      if (p.turnFlags && p.turnFlags.handLimitX) lim += p.turnFlags.handLimitX;
      if (p.modHandLimit) lim = p.modHandLimit(lim);
      return lim;
    }

    shaLimit(p) {
      let lim = 1;
      if (p.equips.weapon && p.equips.weapon.name === '諸葛連弩') lim = 99;
      if (p.turnFlags && p.turnFlags.noShaLimit) lim = 99;
      if (p.turnFlags && p.turnFlags.extraSha) lim += p.turnFlags.extraSha;
      if (p.modShaLimit) lim = p.modShaLimit(lim);
      return lim;
    }

    /* ============================ 出牌階段 ============================ */
    async playPhase(p) {
      if (p.turnFlags && p.turnFlags.skipPlay) {
        this.log(`${this.nameOf(p)} 跳過出牌階段`, 'info');
        return;
      }
      let guard = 0;
      while (p.alive && !this.over && guard++ < 60) {
        if (p.turnFlags.endPlay) break;
        const usable = this.usableCards(p);
        const skills = this.usableSkills(p);
        if (usable.length === 0 && skills.length === 0) break;
        const act = await this.ask(p, {
          kind: 'play', prompt: '出牌階段',
          cards: usable.map(u => ({ id: u.card.id, name: u.asName || u.card.name, asName: u.asName || null, skill: u.skill || null })),
          skills, canEnd: true,
        });
        if (!act || act.end) break;
        if (act.skill) {
          const sk = this.SK[act.skill];
          if (sk && sk.active) await sk.active(this, p, act);
          continue;
        }
        if (act.cardId) {
          const vc = usable.find(u => u.card.id === act.cardId && (u.asName || null) === (act.asName || null))
            || usable.find(u => u.card.id === act.cardId);
          if (!vc) continue;
          await this.playCard(p, vc.card, act.targets ? act.targets.map(id => this.playerById(id)) : null,
            act.asName || vc.asName || null, act.skill || vc.skill || null);
        }
      }
    }

    usableSkills(p) {
      const out = [];
      for (const name of p.skills) {
        const sk = this.SK[name];
        if (!sk || !sk.active) continue;
        if (this.isSilenced(p, name)) continue;
        if (!sk.canUse || sk.canUse(this, p)) out.push(name);
      }
      return out;
    }

    /* 計算現在能主動使用的牌（含技能轉化） */
    usableCards(p) {
      const out = [];
      if (p.silentHand != null && p.silentHand === p.turnCount) return out;   // 雄亂：不能使用手牌
      const add = (card, skill, asName) => out.push({ card, skill: skill || null, asName: asName || null });

      if (p.turnFlags && p.turnFlags.noMoreCards) return out;          // 往烈
      const noSha = p.turnFlags && p.turnFlags.noSha;
      for (const c of p.hand) {
        if (c.name === '閃' || c.name === '無懈可擊') continue;
        if (C.isSha(c) && (noSha || p.turnFlags.shaUsed >= this.shaLimit(p))) continue;
        if (!this.hasValidTarget(p, c)) continue;
        add(c);
      }
      // 龍魂：兩張同花色當【殺】
      if (p.skills.includes('龍魂') && p.turnFlags.shaUsed < this.shaLimit(p)) {
        outer: for (let i = 0; i < p.hand.length; i++) {
          for (let j = i + 1; j < p.hand.length; j++) {
            if (p.hand[i].suit === p.hand[j].suit) { add(p.hand[i], '龍魂', '殺'); break outer; }
          }
        }
      }
      // 技能轉化當牌用（武聖/龍膽等：只處理「殺」這類可使用牌）
      for (const cv of (root.SGS_CONVERT || [])) {
        if (!p.skills.includes(cv.skill)) continue;
        if (cv.to === '閃' || cv.to === '無懈可擊') continue;
        if (cv.activeOnly === false) continue;
        if (cv.when && !cv.when(this, p, null)) continue;
        const fake = { id: 'cv-' + cv.skill, name: cv.to, type: 'basic', virtual: true };
        if (cv.to === '殺' && p.turnFlags.shaUsed >= this.shaLimit(p)) continue;
        for (const c of p.hand) {
          if (this.matchFilter(c, cv.from) && this.hasValidTarget(p, fake)) {
            add(c, cv.skill, cv.to);
            break;
          }
        }
      }
      return out;
    }

    hasValidTarget(p, card) {
      if (card.type === 'equip') return true;
      if (card.name === '桃') return p.hp < p.maxHp;
      if (card.name === '無中生有') return true;
      if (card.name === '閃電') return !p.judge.some(c => c.name === '閃電');
      if (card.name === '樂不思蜀' || card.name === '兵糧寸斷') {
        return this.others(p).some(q => !q.judge.some(c => c.name === card.name));
      }
      if (card.name === '桃園結義') return p.hp < p.maxHp || this.others(p).some(q => q.hp < q.maxHp);
      if (card.name === '五穀豐登') return true;
      if (card.name === '萬箭齊發' || card.name === '南蠻入侵') return this.others(p).length > 0;
      if (card.name === '借刀殺人') return this.others(p).some(q => q.equips.weapon);
      if (card.type === 'trick') return this.others(p).length > 0;
      if (C.isSha(card) || card.name === '殺') return this.others(p).some(q => this.shaReachable(p, q));
      if (card.name === '酒') return p.hp < p.maxHp || !p.turnFlags.drunk;
      if (card.name === '火攻') return this.others(p).some(q => q.hand.length > 0);
      if (card.name === '鐵索連環') return this.alive().length > 1;
      return true;
    }

    /* ============================ 打出 / 使用牌 ============================ */
    async playCard(p, card, targets, asName, skill) {
      const name = asName || card.name;
      // 供 UI 在牌桌中央顯示「剛剛打出的牌」（仿官方）
      this.lastPlay = { name, suit: card.suit, rank: card.rank, by: p.id, at: Date.now() };
      const vcard = (name === card.name) ? card : this.virtualCard(card, name, skill);

      if (name === '裝備' || card.type === 'equip') {
        this.equipCard(p, card);
        return;
      }
      if (name === '桃') {
        this.consumeCards(p, [card], '桃');
        await this.heal(p, 1);
        return;
      }
      if (name === '酒') {
        const dying = p.hp <= 0;
        this.consumeCards(p, [card], '酒');
        if (dying) { await this.heal(p, 1, '酒'); }
        else {
          p.turnFlags.drunk = (p.turnFlags.drunk || 0) + 1;
          this.log(`${this.nameOf(p)} 使用【酒】，本回合下一張【殺】傷害 +1`, 'use');
        }
        return;
      }
      if (name === '樂不思蜀' || name === '兵糧寸斷' || name === '閃電') {
        await this.useDelayTrick(p, card, name, targets);
        return;
      }
      if (name === '殺' || name === '火殺' || name === '雷殺') {
        const tgt = targets && targets.length ? targets : (await this.askTargets(p, {
          prompt: '選擇【殺】的目標', max: this.shaTargets(p, card),
          candidates: this.others(p).filter(q => this.shaReachable(p, q)),
        }));
        if (!tgt.length) return;
        this.consumeCards(p, [card], '殺');
        p.turnFlags.shaUsed = (p.turnFlags.shaUsed || 0) + 1;
        this.stats.cards++;
        this.log(`${this.nameOf(p)} 使用 ${C.cardText(card)}${asName ? '（' + asName + '）' : ''} → ${tgt.map(t => this.nameOf(t)).join('、')}`, 'use');
        this.emit('sha', { source: p, targets: tgt, card });
        await this.trigger('cardUsed', { player: p, card, name, targets: tgt });
        for (const t of tgt) {
          if (!t.alive) continue;
          await this.useShaOn(p, t, vcard);
        }
        return;
      }
      if (card.type === 'trick' || ['決鬥', '過河拆橋', '順手牽羊', '無中生有', '萬箭齊發', '南蠻入侵', '桃園結義', '五穀豐登', '借刀殺人'].includes(name)) {
        await this.useTrick(p, card, name, targets);
        return;
      }
      this.log(`（未知牌 ${name}）`);
    }

    virtualCard(card, name, skill) {
      return {
        id: 'v' + card.id, name, suit: card.suit, rank: card.rank,
        type: 'basic', virtual: true, subcards: [card], skill: skill || null,
        color: card.color,
      };
    }

    equipCard(p, card) {
      const slot = card.slot;
      if (p.deadSlots && p.deadSlots[slot]) {
        this.log(`${this.nameOf(p)} 的「${C.SLOT_NAME[slot] || slot}」欄已被廢除，${C.cardText(card)} 無法裝備`, 'warn');
        return;
      }
      const old = p.equips[slot];
      const hi = p.hand.indexOf(card);
      if (hi < 0) {
        this.log(`[BUG] ${this.nameOf(p)} 裝備了不在手牌的 ${C.cardText(card)}`, 'warn');
        return;
      }
      p.hand.splice(hi, 1);
      p.equips[slot] = card;
      if (old) this.toDiscard([old]);
      this.log(`${this.nameOf(p)} 裝備 ${C.cardText(card)}`, 'equip');
      this.update();
    }

    async useDelayTrick(p, card, name, targets) {
      if (name === '閃電') {
        p.hand.splice(p.hand.indexOf(card), 1);
        p.judge.push(card);
        this.log(`${this.nameOf(p)} 將【閃電】置入判定區`, 'use');
        return;
      }
      const t = (targets && targets[0]) || (await this.askTargets(p, {
        prompt: `選擇【${name}】的目標`,
        candidates: this.others(p).filter(q => !q.judge.some(c => c.name === name)),
      }))[0];
      if (!t) return;
      if (await this.wuxieWindow(p, t, card, name)) { this.toDiscard([card]); return; }
      p.hand.splice(p.hand.indexOf(card), 1);
      t.judge.push(card);
      this.log(`${this.nameOf(p)} 對 ${this.nameOf(t)} 使用【${name}】，置入其判定區`, 'use');
    }

    async useTrick(p, card, name, targets) {
      // 決定目標
      if (Array.isArray(name) && targets === undefined) { targets = name; name = card && card.name; }   // 容錯：舊呼叫方式
      let tgts = [];
      const cands = this.others(p);
      if (name === '無中生有') tgts = [p];
      else if (name === '桃園結義') tgts = this.players.filter(q => q.alive);
      else if (name === '萬箭齊發' || name === '南蠻入侵') tgts = cands;
      else if (name === '五穀豐登') tgts = this.alive();
      else if (name === '借刀殺人') {
        if (targets && targets.length === 2) tgts = targets;
        else if (targets && targets.length === 1) tgts = [targets[0]];
        if (tgts.length < 2) {
          const armed = cands.filter(q => q.equips.weapon);
          const a = await this.askTargets(p, { prompt: '【借刀殺人】選擇持有武器的角色', candidates: armed });
          if (!a.length) return;
          const b = await this.askTargets(p, { prompt: '選擇被【殺】的目標', candidates: cands.filter(q => q !== a[0] && this.inAttackRange(a[0], q)) });
          if (!b.length) return;
          tgts = [a[0], b[0]];
        }
      } else {
        if (targets && targets.length) tgts = targets;
        else {
          let cs = cands.filter(q => this.canBeTargeted(p, q, name, card));
          if (name === '順手牽羊') cs = cs.filter(q => this.distance(p, q) <= 1 && this.cardsInArea(q).length > 0);
          else if (name === '決鬥' || name === '過河拆橋') cs = cs.filter(q => this.cardsInArea(q).length > 0 || name === '決鬥');
          if (cs.length === 0) return;
          tgts = await this.askTargets(p, { prompt: `選擇【${name}】的目標`, candidates: cs, cancelable: true });
        }
      }
      if (!tgts.length) return;

      const hi = p.hand.indexOf(card);
      if (hi >= 0) p.hand.splice(hi, 1);            // 實體牌：從手牌移除
      else if (card.subcards && card.subcards.length) {
        for (const sc of card.subcards.slice()) this.removeCardFromPlayer(p, sc);
      }
      // 虛擬牌不在手牌裡：不要動到手牌（以前 indexOf=-1 會誤刪最後一張）
      this.stats.cards++;
      this.log(`${this.nameOf(p)} 使用 ${C.cardText(card)}${tgts[0] !== p || name !== '無中生有' ? ' → ' + tgts.map(t => this.nameOf(t)).join('、') : ''}`, 'use');
      this.lastPlay = { name, suit: card.suit, rank: card.rank, by: p.id, at: Date.now() };
      this.emit('trick', { player: p, name, targets: tgts, card });
      // 錦囊多目標時，允許技能令其中部分目標無效（例：界甘寧【奮威】）
      if (tgts.length >= 1) {
        const ctx2 = { player: p, card, name, targets: tgts.slice(), negate: [] };
        await this.trigger('trickTargets', ctx2);
        if (ctx2.negate.length) {
          for (const q of ctx2.negate) {
            const i = tgts.indexOf(q);
            if (i >= 0) tgts.splice(i, 1);
            this.log(`${this.nameOf(q)} 因【奮威】不受【${name}】影響`, 'skill');
          }
          if (!tgts.length) { this.toDiscard([card]); return; }
        }
      }
      await this.trigger('cardUsed', { player: p, card, name, targets: tgts });

      // 無懈可擊
      if (name !== '無懈可擊') {
        const negated = await this.wuxieWindow(p, tgts[0] || p, card, name);
        if (negated) { this.toDiscard([card]); this.log(`【${name}】被【無懈可擊】抵銷`); return; }
      }

      switch (name) {
        case '無中生有':
          this.drawCards(p, 2);
          break;
        case '過河拆橋': {
          const t = tgts[0];
          const pick = await this.chooseCardFromPlayer(p, t, '選擇要棄置的牌');
          if (pick) { this.removeCardFromPlayer(t, pick); this.toDiscard([pick]); this.log(`${this.nameOf(p)} 棄置了 ${this.nameOf(t)} 的 ${C.cardText(pick)}`); }
          break;
        }
        case '順手牽羊': {
          const t = tgts[0];
          const pick = await this.chooseCardFromPlayer(p, t, '選擇要獲得的牌');
          if (pick) { this.removeCardFromPlayer(t, pick); p.hand.push(pick); this.log(`${this.nameOf(p)} 獲得 ${this.nameOf(t)} 的一張牌`, 'draw'); }
          break;
        }
        case '決鬥': {
          const t = tgts[0];
          let atk = p, def = t;
          let guard2 = 0;
          while (guard2++ < 24) {
            const need = (def.skills.includes('無雙') ? 2 : 1);
            let ok = 0;
            for (let i = 0; i < need; i++) {
              const r = await this.askForCard(def, '殺', {
                prompt: need > 1 ? `【決鬥】：請打出一張【殺】（共需 ${need} 張）` : `【決鬥】：請打出一張【殺】`,
                cancelable: true,
              });
              if (!r) break;
              this.consumeCards(def, r.cards, '殺');
              this.log(`${this.nameOf(def)} 打出【殺】`);
              ok++;
            }
            if (ok < need) {
              await this.damage(atk, def, 1 + (atk.turnFlags && atk.turnFlags.luoyi ? 1 : 0), 'normal', card);
              await this.trigger('duelResult', { winner: atk, loser: def, initiator: p });
              break;
            }
            const tmp = atk; atk = def; def = tmp;
          }
          break;
        }
        case '萬箭齊發': {
          for (const t of tgts) {
            if (!t.alive) continue;
            if (this.armorBlocks(t, card, name)) continue;
            const r = await this.askForCard(t, '閃', { prompt: '【萬箭齊發】：請打出一張【閃】', cancelable: true });
            if (r) { this.consumeCards(t, r.cards, '閃'); this.log(`${this.nameOf(t)} 打出【閃】`); }
            else await this.damage(p, t, 1, 'normal', card);
          }
          break;
        }
        case '南蠻入侵': {
          for (const t of tgts) {
            if (!t.alive) continue;
            if (this.armorBlocks(t, card, name)) continue;
            const r = await this.askForCard(t, '殺', { prompt: '【南蠻入侵】：請打出一張【殺】', cancelable: true });
            if (r) { this.consumeCards(t, r.cards, '殺'); this.log(`${this.nameOf(t)} 打出【殺】`); }
            else await this.damage(p, t, 1, 'normal', card);
          }
          break;
        }
        case '桃園結義':
          for (const t of tgts) if (t.hp < t.maxHp) await this.heal(t, 1);
          break;
        case '五穀豐登': {
          const list = tgts.map(q => q).filter(q => q.alive);
          const shown = this.drawFromDeck(list.length);
          if (!shown.length) break;
          this.log(`五穀豐登亮出：${shown.map(C.cardText).join(' ')}`);
          for (const q of list) {
            if (!shown.length) break;
            const idx = await this.ask(q, {
              kind: 'chooseFrom', prompt: '【五穀豐登】選擇一張獲得',
              cards: shown.map(c => c.id), cardData: shown.map(c => ({ id: c.id, name: c.name, suit: c.suit, rank: c.rank })),
            });
            const i = Math.max(0, Math.min(shown.length - 1, idx || 0));
            const got = shown.splice(i, 1)[0];
            q.hand.push(got);
            this.log(`${this.nameOf(q)} 獲得 ${C.cardText(got)}`);
          }
          this.toDiscard(shown);
          break;
        }
        case '火攻': {
          const t = tgts[0];
          if (!t.hand.length) break;
          const idx = await this.ask(t, {
            kind: 'chooseFrom', prompt: '【火攻】：選擇一張手牌展示',
            cards: t.hand.map(c => c.id),
            cardData: t.hand.map(c => ({ id: c.id, name: c.name, suit: c.suit, rank: c.rank })),
          });
          const shown = t.hand[Math.max(0, Math.min(t.hand.length - 1, idx || 0))];
          this.log(`${this.nameOf(t)} 展示了 ${C.cardText(shown)}`, 'judge');
          const same = p.hand.filter(c => c.suit === shown.suit);
          if (!same.length || !p.hand.length) { this.log('沒有同花色手牌，火攻失敗'); break; }
          const pick = await this.ask(p, {
            kind: 'chooseFrom', prompt: '是否棄一張同花色手牌，造成 1 點火焰傷害？',
            cards: same.map(c => c.id),
            cardData: same.map(c => ({ id: c.id, name: c.name, suit: c.suit, rank: c.rank })),
            cancelable: true,
          });
          if (pick == null) break;
          const d = same[Math.max(0, Math.min(same.length - 1, pick))];
          p.hand.splice(p.hand.indexOf(d), 1);
          this.toDiscard([d]);
          await this.damage(p, t, 1, 'fire', card);
          break;
        }
        case '鐵索連環': {
          const chosen = await this.askTargets(p, {
            prompt: '【鐵索連環】選擇至多兩名角色（橫置 / 重置）',
            candidates: this.alive(), min: 1, max: 2, cancelable: true,
          });
          for (const q of chosen) {
            if (q.chained && q.skills.includes('結營')) {
              this.log(`${this.nameOf(q)} 因【結營】始終橫置，無法重置`);
              continue;
            }
            q.chained = !q.chained;
            this.log(`${this.nameOf(q)} ${q.chained ? '被橫置' : '被重置'}`);
          }
          break;
        }
        case '借刀殺人': {
          const [a, b] = tgts;
          if (!a || !b || !a.alive || !b.alive) break;
          const r = await this.askForCard(a, '殺', { prompt: `【借刀殺人】：請對 ${this.nameOf(b)} 打出一張【殺】`, cancelable: true });
          if (r) {
            this.consumeCards(a, r.cards, '殺');
            this.log(`${this.nameOf(a)} 打出【殺】→ ${this.nameOf(b)}`);
            await this.useShaOn(a, b, r.cards[0]);
          } else if (a.equips.weapon) {
            const w = a.equips.weapon;
            a.equips.weapon = null;
            p.hand.push(w);
            this.log(`${this.nameOf(a)} 未出【殺】，${this.nameOf(p)} 獲得其武器 ${C.cardText(w)}`);
          }
          break;
        }
        default:
          this.log(`（未實作錦囊 ${name}）`, 'warn');
      }
      // 巨象：其他角色使用的【南蠻入侵】結算後由持有者獲得
      if (name === '南蠻入侵') {
        const jx = this.alive().find(q => q !== p && q.skills && q.skills.includes('巨象') && !this.isSilenced(q, '巨象'));
        if (jx && card && !card.virtual) {
          jx.hand.push(card);
          this.log(`【巨象】：${this.nameOf(jx)} 獲得【南蠻入侵】`, 'skill');
          return;
        }
      }
      this.toDiscard([card]);
    }

    /* 兩名角色互相【決鬥】（供技能使用） */
    async juedou(a, b, card) {
      let atk = a, def = b, guard = 0;
      while (guard++ < 24 && atk.alive && def.alive) {
        const need = def.skills.includes('無雙') ? 2 : 1;
        let ok = 0;
        for (let i = 0; i < need; i++) {
          const r = await this.askForCard(def, '殺', {
            prompt: need > 1 ? `【決鬥】：請打出一張【殺】（共需 ${need} 張）` : '【決鬥】：請打出一張【殺】',
            cancelable: true,
          });
          if (!r) break;
          this.consumeCards(def, r.cards, '殺');
          this.log(`${this.nameOf(def)} 打出【殺】`);
          ok++;
        }
        if (ok < need) { await this.damage(atk, def, 1, 'normal', card || null); break; }
        const tmp = atk; atk = def; def = tmp;
      }
    }

    /* 無懈可擊窗口：回傳是否被抵銷 */
    async wuxieWindow(source, target, card, name) {
      let negated = false;
      let guard = 0;
      while (guard++ < 8) {
        let played = false;
        for (const q of this.players) {
          if (!q.alive) continue;
          const has = q.hand.some(c => c.name === '無懈可擊') ||
            (q.skills.includes('看破') && q.hand.some(c => isBlack(c)));
          if (!has) continue;
          const r = await this.askForCard(q, '無懈可擊', {
            prompt: `${negated ? '是否再【無懈可擊】抵銷上一次無懈？' : `【${name}】${negated ? '' : '指定了 ' + this.nameOf(target)}，是否使用【無懈可擊】？`}`,
            cancelable: true,
          });
          if (r) {
            this.consumeCards(q, r.cards, '無懈可擊');
            this.log(`${this.nameOf(q)} 使用【無懈可擊】${negated ? '反制' : ''}`, 'use');
            negated = !negated;
            played = true;
            break;
          }
        }
        if (!played) break;
      }
      return negated;
    }

    /* 讓 source 選一張目標區域的牌 */
    async chooseCardFromPlayer(chooser, target, prompt) {
      const list = this.cardsInArea(target);
      if (!list.length) return null;
      // 手牌是暗的：先選區域
      const zoneChoice = await this.ask(chooser, {
        kind: 'chooseZone', prompt: prompt || '選擇區域',
        hand: target.hand.length, equip: ['weapon', 'armor', 'horse+', 'horse-', 'treasure'].filter(s => target.equips[s]).length,
        judge: target.judge.length, cancelable: false,
      });
      let pool = list;
      if (zoneChoice === 1) pool = list.filter(x => x.zone === 'equip');
      else if (zoneChoice === 2) pool = list.filter(x => x.zone === 'judge');
      else pool = list.filter(x => x.zone === 'hand');
      if (!pool.length) pool = list;
      // 手牌隨機抽一張（不可看）
      if (pool[0].zone === 'hand') {
        return pool[Math.floor(this.rand() * pool.length)].card;
      }
      const idx = await this.ask(chooser, {
        kind: 'chooseFrom', prompt: '選擇一張牌',
        cards: pool.map(x => x.card.id),
        cardData: pool.map(x => ({ id: x.card.id, name: x.card.name, suit: x.card.suit, rank: x.card.rank, zone: x.zone })),
      });
      return pool[Math.max(0, Math.min(pool.length - 1, idx || 0))].card;
    }

    /* 防具判定 */
    armorBlocks(target, card, name) {
      const armor = this.armorOf(target);
      if (!armor) return false;
      if (armor.name === '藤甲' && (name === '南蠻入侵' || name === '萬箭齊發' || (name === '殺' && card && card.nature !== 'fire' && card.nature !== 'thunder'))) return true;
      if (armor.name === '仁王盾' && name === '殺' && card && isBlack(card)) return true;
      return false;
    }

    /* 【殺】的最大目標數 */
    shaTargets(p, card) {
      let n = 1;
      if (p.turnFlags && p.turnFlags.shaExtraTarget) n += p.turnFlags.shaExtraTarget;
      if (p.equips.weapon && p.equips.weapon.name === '方天畫戟' && p.hand.length === 1) n = 2;
      if (p.modShaTargets) n = p.modShaTargets(n);
      return n;
    }

    /* 一名角色對另一名角色使用【殺】的結算 */
    async useShaOn(source, target, card) {
      if (!target.alive) return;
      const tctx = { source, target, card, noShan: false };
      await this.trigger('shaTargeted', tctx);
      target = tctx.target || target;
      if (!target || !target.alive || this.over) return;
      if (target.skills && target.skills.includes('無懼') && card && (card.color === 'red' || card.suit === '♥' || card.suit === '♦')) {
        this.log(`【無懼】：紅色【殺】對 ${this.nameOf(target)} 無效`, 'skill');
        return;
      }
      if (tctx.noEffect) { this.log(`【${tctx.effectSkill || '技能'}】令此【殺】對 ${this.nameOf(target)} 無效`, 'skill'); return; }
      if (!this.canBeTargeted(source, target, '殺', card)) { this.log(`${this.nameOf(target)} 不受此【殺】影響`); return; }
      if (this.armorBlocks(target, card, '殺')) {
        this.log(`${this.nameOf(target)} 的防具使【殺】無效`);
        return;
      }
      const need = 1;
      // 先詢問技能/八卦陣/閃
      const evade = await this.tryEvade(target, source, card, tctx.noShan);
      if (evade) {
        this.log(`${this.nameOf(target)} 抵擋了【殺】`);
        await this.trigger('shaDodged', { source, target, card });
        return;
      }
      let dmg = need;
      if (source && source.turnFlags && source.turnFlags.drunk) {
        dmg += 1; source.turnFlags.drunk = 0;
        this.log(`${this.nameOf(source)} 的酒使【殺】傷害 +1`);
      }
      if (source && source.equips.weapon && source.equips.weapon.name === '古錠刀' && target.hand.length === 0) {
        dmg += 1; this.log('古錠刀生效，傷害 +1');
      }
      if (source && source.turnFlags && source.turnFlags.luoyi) {
        dmg += 1; this.log('裸衣生效，傷害 +1');
      }
      await this.damage(source, target, dmg, card.nature || 'normal', card);
    }

    /* 是否成功閃避（含八卦陣、技能轉化） */
    async tryEvade(target, source, card, noShan) {
      if (noShan) { this.log(`${this.nameOf(target)} 因【鐵騎】不能使用【閃】`); return false; }
      // 八卦陣
      const armor = this.armorOf(target);
      if (armor && armor.name === '八卦陣') {
        // 八卦陣：裝備自帶判定，需【閃】時自動判定，不再詢問（使用者要求照官方手感）
        const jc = await this.judge(target, '八卦陣');
        if (jc && isRed(jc)) { this.log('八卦陣生效，視為出【閃】'); return true; }
        this.log('八卦陣判定失敗');
      }
      const need = source && source.skills && source.skills.includes('無雙') ? 2 : 1;
      for (let i = 0; i < need; i++) {
        const r = await this.askForCard(target, '閃', {
          prompt: need > 1 ? `【無雙】：請打出一張【閃】（共需 ${need} 張，已出 ${i} 張）` : '請打出一張【閃】',
          cancelable: true,
        });
        if (!r) return false;
        this.consumeCards(target, r.cards, '閃');
        this.log(`${this.nameOf(target)} 打出【閃】`);
      }
      return true;
    }

    /* ============================ 建立牌局 ============================ */
    createPlayer(seat, generals, identity, controller, label) {
      // 雙將：體力取兩名武將中最高者（使用者指定規則）
      let maxHp = generals.reduce((a, g) => Math.max(a, g.hp), 0);
      const p = {
        id: 'p' + seat, seat, generals, skills: [], hp: maxHp, maxHp,
        hand: [], equips: { weapon: null, armor: null, 'horse+': null, 'horse-': null, treasure: null },
        judge: [], alive: true, chained: false, marks: {}, usedLimit: {}, identity, identityRevealed: false,
        stars: [], armorOff: false, qingFengBy: null, daWuBy: null, extraTurn: false,
        deadSlots: {}, silenced: {}, turnCount: 0,
        controller, label: label || '', hostility: {}, turnFlags: {},
      };
      for (const g of generals) for (const s of g.skills) if (!p.skills.includes(s)) p.skills.push(s);
      p.identityName = { lord: '主公', loyal: '忠臣', rebel: '反賊', spy: '內奸', none: '單挑' }[identity] || '';
      // 技能被動掛勾
      this.attachSkillHooks(p);
      return p;
    }

    attachSkillHooks(p) {
      p.modHandLimit = null; p.modDistance = null; p.modDrawCount = null;
      p.modShaLimit = null; p.modAttackRange = null;
      for (const sk of p.skills) {
        const s = this.SK[sk];
        if (!s) continue;
        if (s.handLimit) p.modHandLimit = (lim) => s.handLimit(this, p, lim);
        if (s.distance) p.modDistance = (other) => s.distance(this, p, other);
        if (s.drawCount) p.modDrawCount = (n) => s.drawCount(this, p, n);
        if (s.shaLimit) p.modShaLimit = (lim) => s.shaLimit(this, p, lim);
        if (s.attackRange) p.modAttackRange = () => s.attackRange(this, p);
        if (s.defenseDistance) p.modDefenseDistance = (other) => s.defenseDistance(this, p, other);
        if (s.shaTargets) p.modShaTargets = (n) => s.shaTargets(this, p, n);
      }
    }

    dealInitial(p, n) {
      const cards = this.drawFromDeck(n);
      p.hand.push(...cards);
    }
  }

  root.SGS = { Game, rnd };
})(typeof window !== 'undefined' ? window : globalThis);
