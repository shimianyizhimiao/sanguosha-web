/* 三國殺 · 牌庫（官方牌表）
   std：標準版 108 張（每花色 13 點各 2 張 = 104，加 4 張 EX）
   ex ：軍爭 52 張
   花色／點數完全照官方牌表，判定（閃電、八卦陣、樂不思蜀…）才對得上。
*/
(function (root) {
  'use strict';

  const SUITS = ['♠', '♥', '♣', '♦'];
  const isRed = (c) => c.suit === '♥' || c.suit === '♦';
  const isBlack = (c) => c.suit === '♠' || c.suit === '♣';

  /* ---------------- 標準版 108 張（官方牌表） ---------------- */
  const STD = [
    ['♥', 1, '桃園結義'], ['♥', 1, '萬箭齊發'],
    ['♥', 2, '閃'], ['♥', 2, '閃'],
    ['♥', 3, '桃'], ['♥', 3, '五穀豐登'],
    ['♥', 4, '桃'], ['♥', 4, '五穀豐登'],
    ['♥', 5, '麒麟弓'], ['♥', 5, '赤兔'],
    ['♥', 6, '桃'], ['♥', 6, '樂不思蜀'],
    ['♥', 7, '桃'], ['♥', 7, '無中生有'],
    ['♥', 8, '桃'], ['♥', 8, '無中生有'],
    ['♥', 9, '桃'], ['♥', 9, '無中生有'],
    ['♥', 10, '殺'], ['♥', 10, '殺'],
    ['♥', 11, '殺'], ['♥', 11, '無中生有'],
    ['♥', 12, '桃'], ['♥', 12, '過河拆橋'],
    ['♥', 13, '閃'], ['♥', 13, '爪黃飛電'],

    ['♠', 1, '決鬥'], ['♠', 1, '閃電'],
    ['♠', 2, '雌雄雙股劍'], ['♠', 2, '八卦陣'],
    ['♠', 3, '過河拆橋'], ['♠', 3, '順手牽羊'],
    ['♠', 4, '過河拆橋'], ['♠', 4, '順手牽羊'],
    ['♠', 5, '青龍偃月刀'], ['♠', 5, '絕影'],
    ['♠', 6, '樂不思蜀'], ['♠', 6, '青釭劍'],
    ['♠', 7, '殺'], ['♠', 7, '南蠻入侵'],
    ['♠', 8, '殺'], ['♠', 8, '殺'],
    ['♠', 9, '殺'], ['♠', 9, '殺'],
    ['♠', 10, '殺'], ['♠', 10, '殺'],
    ['♠', 11, '順手牽羊'], ['♠', 11, '無懈可擊'],
    ['♠', 12, '過河拆橋'], ['♠', 12, '丈八蛇矛'],
    ['♠', 13, '南蠻入侵'], ['♠', 13, '大宛'],

    ['♦', 1, '諸葛連弩'], ['♦', 1, '決鬥'],
    ['♦', 2, '閃'], ['♦', 2, '閃'],
    ['♦', 3, '閃'], ['♦', 3, '順手牽羊'],
    ['♦', 4, '閃'], ['♦', 4, '順手牽羊'],
    ['♦', 5, '閃'], ['♦', 5, '貫石斧'],
    ['♦', 6, '殺'], ['♦', 6, '閃'],
    ['♦', 7, '殺'], ['♦', 7, '閃'],
    ['♦', 8, '殺'], ['♦', 8, '閃'],
    ['♦', 9, '殺'], ['♦', 9, '閃'],
    ['♦', 10, '殺'], ['♦', 10, '閃'],
    ['♦', 11, '閃'], ['♦', 11, '閃'],
    ['♦', 12, '桃'], ['♦', 12, '方天畫戟'],
    ['♦', 13, '殺'], ['♦', 13, '紫騂'],

    ['♣', 1, '決鬥'], ['♣', 1, '諸葛連弩'],
    ['♣', 2, '殺'], ['♣', 2, '八卦陣'],
    ['♣', 3, '殺'], ['♣', 3, '過河拆橋'],
    ['♣', 4, '殺'], ['♣', 4, '過河拆橋'],
    ['♣', 5, '殺'], ['♣', 5, '的盧'],
    ['♣', 6, '殺'], ['♣', 6, '樂不思蜀'],
    ['♣', 7, '殺'], ['♣', 7, '南蠻入侵'],
    ['♣', 8, '殺'], ['♣', 8, '殺'],
    ['♣', 9, '殺'], ['♣', 9, '殺'],
    ['♣', 10, '殺'], ['♣', 10, '殺'],
    ['♣', 11, '殺'], ['♣', 11, '殺'],
    ['♣', 12, '借刀殺人'], ['♣', 12, '無懈可擊'],
    ['♣', 13, '借刀殺人'], ['♣', 13, '無懈可擊'],

    // EX 牌（四花色各 1 張，共 4 張）
    ['♥', 12, '閃電'],
    ['♠', 2, '寒冰劍'],
    ['♦', 12, '無懈可擊'],
    ['♣', 2, '仁王盾'],
  ];

  /* ---------------- 軍爭 52 張（官方牌表） ---------------- */
  const EX = [
    ['♠', 1, '古錠刀'],
    ['♠', 2, '藤甲'],
    ['♠', 3, '酒'],
    ['♠', 4, '雷殺'], ['♠', 5, '雷殺'], ['♠', 6, '雷殺'], ['♠', 7, '雷殺'], ['♠', 8, '雷殺'],
    ['♠', 9, '酒'],
    ['♠', 10, '兵糧寸斷'],
    ['♠', 11, '鐵索連環'], ['♠', 12, '鐵索連環'],
    ['♠', 13, '無懈可擊'],

    ['♥', 1, '無懈可擊'],
    ['♥', 2, '火攻'], ['♥', 3, '火攻'],
    ['♥', 4, '火殺'],
    ['♥', 5, '桃'], ['♥', 6, '桃'],
    ['♥', 7, '火殺'],
    ['♥', 8, '閃'], ['♥', 9, '閃'],
    ['♥', 10, '火殺'],
    ['♥', 11, '閃'], ['♥', 12, '閃'],
    ['♥', 13, '無懈可擊'],

    ['♣', 1, '白銀獅子'],
    ['♣', 2, '藤甲'],
    ['♣', 3, '酒'],
    ['♣', 4, '兵糧寸斷'],
    ['♣', 5, '雷殺'], ['♣', 6, '雷殺'], ['♣', 7, '雷殺'], ['♣', 8, '雷殺'],
    ['♣', 9, '酒'],
    ['♣', 10, '鐵索連環'], ['♣', 11, '鐵索連環'], ['♣', 12, '鐵索連環'], ['♣', 13, '鐵索連環'],

    ['♦', 1, '朱雀羽扇'],
    ['♦', 2, '桃'], ['♦', 3, '桃'],
    ['♦', 4, '火殺'], ['♦', 5, '火殺'],
    ['♦', 6, '閃'], ['♦', 7, '閃'], ['♦', 8, '閃'],
    ['♦', 9, '酒'],
    ['♦', 10, '閃'], ['♦', 11, '閃'],
    ['♦', 12, '火攻'],
    ['♦', 13, '驊騮'],
  ];

  /* ---------------- 牌面屬性 ---------------- */
  const SLOT_NAME = { weapon: '武器', armor: '防具', 'horse+': '+1 馬', 'horse-': '-1 馬', treasure: '寶物' };

  const PROPS = {
    '殺': { type: 'basic', nature: 'normal', desc: '出牌階段，對攻擊範圍內一名角色造成 1 點傷害（每回合限一次）' },
    '火殺': { type: 'basic', nature: 'fire', desc: '造成 1 點火焰傷害' },
    '雷殺': { type: 'basic', nature: 'thunder', desc: '造成 1 點雷電傷害' },
    '閃': { type: 'basic', desc: '抵擋一張【殺】' },
    '桃': { type: 'basic', desc: '回復 1 點體力（自己的出牌階段）或救人（有人瀕死時）' },
    '酒': { type: 'basic', desc: '出牌階段使用：本回合下一張【殺】傷害 +1；或於瀕死時回復 1 點體力' },

    '決鬥': { type: 'trick', target: 'one', desc: '指定一名角色，輪流打出【殺】，先不出者受到 1 點傷害' },
    '過河拆橋': { type: 'trick', target: 'one', desc: '棄置一名角色區域內的一張牌' },
    '順手牽羊': { type: 'trick', target: 'one', dist: 1, desc: '獲得距離 1 以內角色區域內的一張牌' },
    '無中生有': { type: 'trick', target: 'self', desc: '摸兩張牌' },
    '萬箭齊發': { type: 'trick', target: 'allOther', desc: '其他角色各需打出一張【閃】，否則受到 1 點傷害' },
    '南蠻入侵': { type: 'trick', target: 'allOther', desc: '其他角色各需打出一張【殺】，否則受到 1 點傷害' },
    '桃園結義': { type: 'trick', target: 'all', desc: '所有角色各回復 1 點體力' },
    '五穀豐登': { type: 'trick', target: 'all', desc: '亮出等同人數的牌，每人依序選一張獲得' },
    '借刀殺人': { type: 'trick', target: 'two', desc: '令有武器的角色對另一名角色出【殺】，否則你獲得其武器' },
    '無懈可擊': { type: 'trick', target: 'none', desc: '抵銷一張錦囊牌的效果' },
    '樂不思蜀': { type: 'trick', target: 'one', delay: true, desc: '延時錦囊：判定不為紅桃則跳過出牌階段' },
    '兵糧寸斷': { type: 'trick', target: 'one', delay: true, desc: '延時錦囊：判定不為梅花則跳過摸牌階段' },
    '閃電': { type: 'trick', target: 'none', delay: true, desc: '延時錦囊：判定為♠2~9 則受到 3 點雷電傷害，否則傳給下家' },
    '火攻': { type: 'trick', target: 'one', desc: '目標展示一張手牌，你可棄一張同花色手牌，對其造成 1 點火焰傷害' },
    '鐵索連環': { type: 'trick', target: 'one', reforge: true, desc: '橫置或重置至多兩名角色（也可棄置此牌摸一張牌）' },

    '諸葛連弩': { type: 'equip', slot: 'weapon', range: 1, desc: '攻擊範圍 1；出牌階段使用【殺】無次數限制' },
    '青釭劍': { type: 'equip', slot: 'weapon', range: 2, desc: '攻擊範圍 2；使用【殺】時無視目標防具' },
    '雌雄雙股劍': { type: 'equip', slot: 'weapon', range: 2, desc: '攻擊範圍 2；使用【殺】指定異性目標時，其需棄一張牌或你摸一張牌' },
    '青龍偃月刀': { type: 'equip', slot: 'weapon', range: 3, desc: '攻擊範圍 3；【殺】被【閃】抵銷時可再對同一目標使用一張【殺】' },
    '丈八蛇矛': { type: 'equip', slot: 'weapon', range: 3, desc: '攻擊範圍 3；可將兩張手牌當【殺】使用' },
    '貫石斧': { type: 'equip', slot: 'weapon', range: 3, desc: '攻擊範圍 3；【殺】造成傷害時可棄兩張牌令傷害 +1' },
    '方天畫戟': { type: 'equip', slot: 'weapon', range: 4, desc: '攻擊範圍 4；使用【殺】時若為最後手牌，可額外指定一個目標' },
    '麒麟弓': { type: 'equip', slot: 'weapon', range: 5, desc: '攻擊範圍 5；【殺】造成傷害時可棄置目標一匹馬' },
    '寒冰劍': { type: 'equip', slot: 'weapon', range: 2, desc: '攻擊範圍 2；【殺】造成傷害時可防止傷害並棄目標兩張牌' },
    '古錠刀': { type: 'equip', slot: 'weapon', range: 2, desc: '攻擊範圍 2；【殺】造成傷害時，若目標沒有手牌，傷害 +1' },
    '朱雀羽扇': { type: 'equip', slot: 'weapon', range: 4, desc: '攻擊範圍 4；你可將普通【殺】當【火殺】使用' },

    '八卦陣': { type: 'equip', slot: 'armor', desc: '需要出【閃】時可判定，若為紅色則視為出【閃】' },
    '仁王盾': { type: 'equip', slot: 'armor', desc: '黑色的【殺】對你無效' },
    '藤甲': { type: 'equip', slot: 'armor', desc: '【南蠻入侵】【萬箭齊發】及普通【殺】對你無效；受到火焰傷害 +1' },
    '白銀獅子': { type: 'equip', slot: 'armor', desc: '防止你受到超過 1 點的傷害；此牌離開裝備區時回復 1 點體力' },

    '的盧': { type: 'equip', slot: 'horse+', desc: '+1 馬：其他角色與你的距離 +1' },
    '絕影': { type: 'equip', slot: 'horse+', desc: '+1 馬：其他角色與你的距離 +1' },
    '爪黃飛電': { type: 'equip', slot: 'horse+', desc: '+1 馬：其他角色與你的距離 +1' },
    '赤兔': { type: 'equip', slot: 'horse-', desc: '-1 馬：你與其他角色的距離 -1' },
    '大宛': { type: 'equip', slot: 'horse-', desc: '-1 馬：你與其他角色的距離 -1' },
    '紫騂': { type: 'equip', slot: 'horse-', desc: '-1 馬：你與其他角色的距離 -1' },
    '驊騮': { type: 'equip', slot: 'horse-', desc: '-1 馬：你與其他角色的距離 -1' },
  };

  function makeCard(name, suit, rank, id, pack) {
    const p = PROPS[name];
    if (!p) throw new Error('未定義的牌：' + name);
    const c = {
      id: 'c' + id,
      name,
      type: p.type,
      subtype: p.type,
      slot: p.slot || null,
      slotName: p.slot ? SLOT_NAME[p.slot] : '',
      range: p.range || 0,
      nature: p.nature || 'normal',
      delay: !!p.delay,
      reforge: !!p.reforge,
      target: p.target || 'one',
      dist: p.dist || 0,
      pack,
      desc: p.desc || '',
      suit,
      rank,
    };
    c.color = isRed(c) ? 'red' : 'black';
    c.damage = (name === '殺' || !!p.nature) ? 1 : 0;
    return c;
  }

  function buildDeck(packs) {
    const use = packs || ['std'];
    let id = 0;
    const deck = [];
    if (use.includes('std')) for (const [s, r, n] of STD) deck.push(makeCard(n, s, r, ++id, 'std'));
    if (use.includes('ex')) for (const [s, r, n] of EX) deck.push(makeCard(n, s, r, ++id, 'ex'));
    return deck;
  }

  function shuffle(arr, rand) {
    const rnd = rand || Math.random;
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  const RANK_TXT = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };
  function rankText(r) { return RANK_TXT[r] || String(r); }
  function cardText(c) { return c.suit + rankText(c.rank) + '【' + c.name + '】'; }
  const isSha = (c) => !!c && (c.name === '殺' || c.name === '火殺' || c.name === '雷殺');

  const DEFS = Object.keys(PROPS).map(name => Object.assign({ name }, PROPS[name], {
    count: STD.filter(x => x[2] === name).length + EX.filter(x => x[2] === name).length,
  }));

  root.SGS_CARDS = {
    DEFS, SUITS, SLOT_NAME, PROPS, buildDeck, shuffle, isRed, isBlack, cardText, rankText, isSha,
    packs: ['std', 'ex'],
    STD_COUNT: STD.length,
    EX_COUNT: EX.length,
    total: (packs) => (packs || ['std']).reduce((a, p) => a + (p === 'std' ? STD.length : p === 'ex' ? EX.length : 0), 0),
  };
})(typeof window !== 'undefined' ? window : globalThis);
