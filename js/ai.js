/* 三國殺 · AI 對手
   AI 只看公開資訊 + 自己的敵意紀錄（誰打過我、誰打過主公），不會偷看身份。
*/
(function (root) {
  'use strict';
  const C = root.SGS_CARDS;

  const VALUE = (c) => {
    if (!c) return 0;
    switch (c.name) {
      case '桃': return 6;
      case '閃': return 5;
      case '無懈可擊': return 4.2;
      case '殺': case '火殺': case '雷殺': return 3.6;
      case '無中生有': return 4.0;
      case '決鬥': return 3.2;
      case '順手牽羊': return 3.4;
      case '過河拆橋': return 3.0;
      case '樂不思蜀': return 3.1;
      case '兵糧寸斷': return 2.6;
      case '萬箭齊發': return 3.0;
      case '南蠻入侵': return 3.0;
      case '五穀豐登': return 2.4;
      case '桃園結義': return 2.8;
      case '借刀殺人': return 2.2;
      case '酒': return 2.6;
      case '火攻': return 2.8;
      case '鐵索連環': return 1.8;
      case '閃電': return 1.2;
      default:
        if (c.type === 'equip') return 2.2 + (c.range || 0) * 0.2;
        return 1.5;
    }
  };

  class AIController {
    constructor(seed, delayMs) { this.seed = seed || Math.random(); this.delayMs = delayMs || 0; }

    /* ---------------- 敵我判斷 ---------------- */
    threat(g, p, q) {
      if (q === p) return -99;
      let score = 0;
      if (p.identity === 'none') score += 3;   // 單挑：對手就是敵人
      const myHate = (p.hostility && p.hostility[q.id]) || 0;      // 我對他的敵意（他打過我）
      const hisHate = (q.hostility && q.hostility[p.id]) || 0;     // 他對我的敵意
      score += myHate * 1.2 + hisHate * 0.8;
      // 後期提速：拖太久時 AI 主動收縮，避免全部縮著打的無限拉鋸
      if (g.turnNo > 150) score += 1.2;
      if (g.turnNo > 260) score += 1.2;

      const lord = g.players.find(x => x.identity === 'lord');
      const lordHate = lord ? ((q.hostility && q.hostility[lord.id]) || 0) : 0;

      if (p.identity === 'rebel') {
        if (q.identity === 'lord') score += 6;
        if (q.identity === 'loyal' && q.identityRevealed) score += 3;
        score -= lordHate * 0.4;            // 打主公的人可能是同伴
      } else if (p.identity === 'loyal') {
        score += lordHate * 1.6;
        if (q.identity === 'rebel' && q.identityRevealed) score += 4;
        if (q.identity === 'lord') score -= 99;
      } else if (p.identity === 'lord') {
        score += lordHate * 1.8;
        if (q.identity === 'rebel' && q.identityRevealed) score += 4;
        if (q.identity === 'loyal' && q.identityRevealed) score -= 6;
      } else if (p.identity === 'spy') {
        if (q.identity === 'lord') score -= 5;      // 內奸要留主公
        score += lordHate * 0.8;
      }
      // 後期沒得混：剩三人以內，未確認的都要打
      if (g.alive().length <= 3) {
        if (p.identity === 'spy' && g.alive().length <= 2) score += 8;
        else score += 1.2;
      }
      // 弱的人優先打
      score += (q.maxHp - q.hp) * 0.2;
      return score;
    }

    isFriend(g, p, q) { return this.threat(g, p, q) < 0.6; }

    enemies(g, p) {
      return g.alive().filter(q => q !== p)
        .map(q => ({ q, s: this.threat(g, p, q) }))
        .sort((a, b) => b.s - a.s)
        .filter(x => x.s > 0.6)
        .map(x => x.q);
    }

    pickTarget(g, p, list) {
      if (!list || !list.length) return null;
      let best = null, bs = -1e9;
      for (const q of list) {
        const s = this.threat(g, p, q);
        if (s > bs) { bs = s; best = q; }
      }
      return best;
    }

    /* ---------------- 主入口 ---------------- */
    respond(g, p, req) {
      if (!this.delayMs) return this.decide(g, p, req);
      return new Promise((resolve) => {
        setTimeout(() => resolve(this.decide(g, p, req)), this.delayMs);
      });
    }

    decide(g, p, req) {
      switch (req.kind) {
        case 'play': return this.onPlay(g, p, req);
        case 'response': return this.onResponse(g, p, req);
        case 'targets': return this.onTargets(g, p, req);
        case 'choice': return this.onChoice(g, p, req);
        case 'discard': return this.onDiscard(g, p, req);
        case 'cards': return this.onCards(g, p, req);
        case 'chooseFrom': return this.onChooseFrom(g, p, req);
        case 'chooseZone': return this.onZone(g, p, req);
        default: return null;
      }
    }

    /* ---------------- 出牌階段 ---------------- */
    onPlay(g, p, req) {
      const opts = (req.cards || []).map(o => {
        const c = g.findCard(p, o.id);
        return c ? Object.assign({ card: c }, o) : null;
      }).filter(Boolean);
      const nameOf = (o) => o.asName || o.card.name;

      // 1. 瀕死/低血先補
      if (p.hp < p.maxHp) {
        const tao = opts.find(o => nameOf(o) === '桃');
        if (tao) return { cardId: tao.card.id };
      }

      // 2. 主動技（依優先順序）
      const sk = this.pickSkill(g, p, req.skills || []);
      if (sk) return { skill: sk };

      // 3. 裝備（有更好武器/防具就換）
      const equip = opts.find(o => o.card.type === 'equip' && this.wantsEquip(g, p, o.card));
      if (equip) return { cardId: equip.card.id };

      // 4. 無中生有
      const wuzhong = opts.find(o => nameOf(o) === '無中生有');
      if (wuzhong) return { cardId: wuzhong.card.id };

      // 5. 攻擊性錦囊
      const enemies = this.enemies(g, p);
      if (enemies.length) {
        const order = ['決鬥', '順手牽羊', '過河拆橋', '樂不思蜀', '兵糧寸斷', '萬箭齊發', '南蠻入侵', '火攻', '借刀殺人'];
        for (const want of order) {
          const o = opts.find(x => nameOf(x) === want);
          if (!o) continue;
          if (want === '萬箭齊發' || want === '南蠻入侵') {
            // 會打到隊友就別用
            const hurtFriends = g.others(p).some(q => this.isFriend(g, p, q));
            if (hurtFriends && g.alive().length > 2) continue;
          }
          return { cardId: o.card.id };
        }
      }

      // 6. 殺
      const sha = opts.find(o => ['殺', '火殺', '雷殺'].includes(nameOf(o)));
      if (sha) {
        const inRange = g.others(p).filter(q => g.inAttackRange(p, q) && !this.isFriend(g, p, q));
        if (inRange.length) return { cardId: sha.card.id };
      }

      // 7. 滿血時桃園結義 / 五穀豐登
      const heal = opts.find(o => nameOf(o) === '桃園結義');
      if (heal) return { cardId: heal.card.id };
      const wugu = opts.find(o => nameOf(o) === '五穀豐登');
      if (wugu && p.hand.length <= 3) return { cardId: wugu.card.id };

      return { end: true };
    }

    wantsEquip(g, p, card) {
      const cur = p.equips[card.slot];
      if (!cur) return true;
      if (card.slot === 'weapon') return (card.range || 0) > (cur.range || 0);
      return false;
    }

    pickSkill(g, p, skills) {
      const has = (n) => skills.includes(n);
      // 綻火（神陸遜）：有人被橫置就燒
      if (has('綻火') && g.alive().some(q => q.chained)) return '綻火';
      // 界仁德：手牌多就給隊友
      if (has('仁德·界') && p.hand.length >= 3 && g.others(p).some(q => this.isFriend(g, p, q))) return '仁德·界';
      // 除癘：能棄對手牌就用
      if (has('除癘') && !p.turnFlags.chuli && p.hand.length > 1) return '除癘';
      // 極略：有忍就用（拿制衡／集智等於賺）
      if (has('極略') && (p.marks['忍'] || 0) > 0 && !p.turnFlags.jilue) return '極略';
      // 神憤：暴怒滿 6 就開
      if (has('神憤') && (p.marks['暴怒'] || 0) >= 6 && !p.usedLimit['神憤']) return '神憤';
      // 無前：暴怒夠就搶一次無雙
      if (has('無前') && (p.marks['暴怒'] || 0) >= 2 && !p.turnFlags.wuqian) return '無前';
      // 苦肉：血多才用
      if (has('苦肉') && p.hp >= 3) return '苦肉';
      // 制衡：把爛牌換掉
      if (has('制衡') && !p.turnFlags.zhiheng) {
        const junk = p.hand.filter(c => VALUE(c) <= 1.6).length;
        if (junk >= 2) return '制衡';
      }
      // 仁德：手牌多且能回血
      if (has('仁德') && p.hp < p.maxHp && p.hand.length >= 3) return '仁德';
      // 青囊
      if (has('青囊') && p.hp < p.maxHp && p.hand.length > 1) return '青囊';
      // 結姻
      if (has('結姻') && p.hand.length >= 4) return '結姻';
      // 離間：對兩名敵人
      if (has('離間')) {
        const males = g.others(p).filter(q => q.generals.some(x => x.gender === 'male') && !this.isFriend(g, p, q));
        if (males.length >= 2) return '離間';
      }
      // 拜印 / 七星 / 大霧
      if (has('拜印') && g.marks(p, '忍') >= 1) return '拜印';
      if (has('七星') && g.marks(p, '星') >= 3 && p.hand.length <= 2) return '七星';
      if (has('大霧') && g.marks(p, '星') >= 1 && p.hp < p.maxHp) return '大霧';
      // 琴音：血少時全體回血
      if (has('琴音') && p.hp <= 2 && p.hand.length >= 4) return '琴音';
      // 業炎 / 亂武：限定技，看到就用
      if (has('業炎') && g.canUseLimit(p, '業炎')) return '業炎';
      if (has('亂武') && g.canUseLimit(p, '亂武') && g.others(p).filter(q => q.hp <= 1).length >= 1) return '亂武';
      // 攻心
      if (has('攻心') && p.hand.length > 2) return '攻心';
      // 反間
      if (has('反間') && !p.turnFlags.fanjian && p.hand.length >= 2) {
        const t = this.pickTarget(g, p, g.others(p).filter(q => !this.isFriend(g, p, q)));
        if (t) return '反間';
      }
      return null;
    }

    /* ---------------- 打出牌 ---------------- */
    onResponse(g, p, req) {
      const opts = req.options || [];
      if (!opts.length) return null;
      const need = req.need;
      const meta = req.meta || {};

      // 桃：只救自己或隊友
      if (need === '桃') {
        const target = meta.target ? g.playerById(meta.target) : p;
        if (target && !this.isFriend(g, p, target)) return null;
        if (target === p && p.hp <= 0) {
          const o = opts.find(o => o.cards.length === 1);
          return o ? { cards: o.cards } : null;
        }
        if (target && p.hp > 1) {
          const o = opts.find(o => o.cards.length === 1);
          return o ? { cards: o.cards } : null;
        }
        return null;
      }

      // 無懈可擊：只保護隊友，且不要太常丟
      if (need === '無懈可擊') {
        const t = meta.target ? g.playerById(meta.target) : null;
        if (meta.negated) {
          if (t && this.isFriend(g, p, t)) { const o = opts[0]; return { cards: o.cards, skill: o.skill }; }
          return null;
        }
        if (!t) return null;
        if (!this.isFriend(g, p, t)) return null;
        if (p.hand.length <= 2 && p.hp <= 2) return null;
        const o = opts[opts.length - 1];
        return { cards: o.cards, skill: o.skill };
      }

      // 閃 / 殺：直接出（保留兩張殺的判斷：手牌少時也出）
      const o = opts[0];
      if (!o) return null;
      if (need === '閃') {
        // 沒有必要就別用技能轉化浪費牌
        return { cards: o.cards, skill: o.skill };
      }
      if (need === '殺') {
        return { cards: o.cards, skill: o.skill };
      }
      return { cards: o.cards, skill: o.skill };
    }

    /* ---------------- 選目標 ---------------- */
    onTargets(g, p, req) {
      const ids = req.candidates || [];
      const cands = ids.map(id => g.playerById(id)).filter(Boolean);
      if (!cands.length) return null;
      const want = req.max || 1;
      const sorted = cands.slice().sort((a, b) => this.threat(g, p, b) - this.threat(g, p, a));
      // 需要兩個目標（借刀殺人 / 離間）時，取敵意最高的兩個
      const out = sorted.slice(0, want).map(q => q.id);
      return out;
    }

    /* ---------------- 選項 ---------------- */
    onChoice(g, p, req) {
      const prompt = req.prompt || '';
      // 剛烈：手牌少就吃傷害
      if (prompt.includes('剛烈')) {
        return p.hand.length >= 3 ? 0 : 1;
      }
      // 反間猜花色
      if (prompt.includes('反間')) return Math.floor(g.rand() * 4);
      // 技能詢問：大多發動
      if (req.skill) {
        if (req.skill === '洛神' && p.hp <= 1) return 1;
        return 0;
      }
      return 0;
    }

    /* ---------------- 棄牌 ---------------- */
    onDiscard(g, p, req) {
      const n = req.count || 1;
      const sorted = p.hand.slice().sort((a, b) => VALUE(a) - VALUE(b));
      return sorted.slice(0, n).map(c => c.id);
    }

    /* ---------------- 選牌 ---------------- */
    onCards(g, p, req) {
      const pool = (req.cards || []).map(id => g.findCard(p, id)).filter(Boolean);
      if (!pool.length) return [];
      const min = req.min == null ? 1 : req.min;
      const max = req.max == null ? min : req.max;
      // 需要棄牌 → 丟最沒用的；需要交出 → 也丟最沒用的
      const sorted = pool.slice().sort((a, b) => VALUE(a) - VALUE(b));
      const out = sorted.slice(0, Math.max(min, Math.min(max, min))).map(c => c.id);
      return out;
    }

    onChooseFrom(g, p, req) {
      const data = req.cardData || [];
      if (!data.length) return 0;
      let best = 0, bv = -1;
      data.forEach((c, i) => {
        const v = VALUE(c) + (c.suit === '♥' ? 0.2 : 0);
        if (v > bv) { bv = v; best = i; }
      });
      return best;
    }

    onZone(g, p, req) {
      // 優先拆裝備與判定區
      if (req.equip) return 1;
      if (req.judge) return 2;
      return 0;
    }
  }

  root.SGS_AI = { AIController, VALUE };
})(typeof window !== 'undefined' ? window : globalThis);
