/* 三國殺 · 開局建立（身份分配、武將選擇、發牌）
*/
(function (root) {
  'use strict';
  const C = root.SGS_CARDS;
  const AI = root.SGS_AI;

  const IDENTITY_SETS = {
    2: ['lord', 'rebel'],
    3: ['lord', 'rebel', 'spy'],
    4: ['lord', 'loyal', 'rebel', 'spy'],
    5: ['lord', 'loyal', 'rebel', 'rebel', 'spy'],
    6: ['lord', 'loyal', 'rebel', 'rebel', 'rebel', 'spy'],
    7: ['lord', 'loyal', 'loyal', 'rebel', 'rebel', 'rebel', 'spy'],
    8: ['lord', 'loyal', 'loyal', 'rebel', 'rebel', 'rebel', 'rebel', 'spy'],
  };

  const MODE_INFO = {
    id3: { name: '3 人身份局', n: 3, desc: '主公 · 反賊 · 內奸' },
    id5: { name: '5 人身份局', n: 5, desc: '主公 · 忠臣 · 反賊×2 · 內奸' },
    duel: { name: '1v1 單挑', n: 2, desc: '兩名武將單挑，先倒下者輸' },
    hotseat: { name: '同機多人', n: 5, desc: '同一螢幕輪流操作' },
  };

  function pickGenerals(pool, used, n) {
    const out = [];
    for (let k = 0; k < n; k++) {
      const avail = pool.filter(g => !used.has(g.name));
      if (!avail.length) break;
      const g = avail[Math.floor(Math.random() * avail.length)];
      used.add(g.name);
      out.push(g);
    }
    return out;
  }

  function makeGame(opts) {
    opts = opts || {};
    const packs = opts.packs || ['std'];
    const generalPacks = opts.generalPacks || ['std'];
    const mode = opts.mode || 'id5';
    const nPlayers = opts.nPlayers || (MODE_INFO[mode] ? MODE_INFO[mode].n : 5);
    const doubleGeneral = !!opts.doubleGeneral;

    const game = new root.SGS.Game({
      mode, packs, doubleGeneral,
      onLog: opts.onLog, onUpdate: opts.onUpdate,
      maxTurns: opts.maxTurns || 400,
    });
    game.packs = packs;

    // 身份
    let ids;
    if (mode === 'duel') ids = ['none', 'none'];
    else ids = (IDENTITY_SETS[nPlayers] || IDENTITY_SETS[5]).slice();
    if (mode !== 'duel' && ids[0] === 'lord') {
      // 主公永遠坐 0 號位
      for (let i = ids.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [ids[i], ids[j]] = [ids[j], ids[i]];
      }
      const li = ids.indexOf('lord');
      [ids[0], ids[li]] = [ids[li], ids[0]];
    }

    // 武將池
    const allGen = Object.values(root.SGS_GENERALS);
    const pool = allGen.filter(g => generalPacks.includes(g.pack));
    const used = new Set();

    // 玩家建立
    for (let i = 0; i < nPlayers; i++) {
      const ctrl = (opts.controllers && opts.controllers[i]) || new AI.AIController();
      const gens = (opts.forcedGenerals && opts.forcedGenerals[i]) || pickGenerals(pool, used, doubleGeneral ? 2 : 1);
      const p = game.createPlayer(i, gens, ids[i], ctrl, opts.labels ? opts.labels[i] : '');
      p.nickname = (opts.names && opts.names[i]) || `${i + 1}號`;
      if (ids[i] === 'lord' && mode !== 'duel') { p.maxHp += 1; p.hp = p.maxHp; }
      game.players.push(p);
    }

    // 牌堆
    game.deck = C.shuffle(C.buildDeck(packs), game.rand);

    // 發牌：主公 4 張，其他人 4 張
    for (const p of game.players) game.dealInitial(p, 4);

    return game;
  }

  root.SGS_SETUP = { makeGame, IDENTITY_SETS, MODE_INFO, pickGenerals };
})(typeof window !== 'undefined' ? window : globalThis);
