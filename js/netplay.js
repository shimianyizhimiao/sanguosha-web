/* 三國殺 · 連線對戰（房主權威）
   房主跑引擎；客人只送決策、收狀態快照。 */
window.SGS_NETPLAY = (function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

  let role = null;                 // 'host' | 'guest'
  let mySeat = 0;
  let seatCount = 0;               // 房主：已分配的座位數（0 是房主自己）
  let guests = [];                 // { conn, seat, name, picked, ctrl }
  let hostGame = null;             // 房主的引擎
  let fakeGame = null;             // 客人的畫面資料
  let guestSeat = 0;
  let picks = new Map();           // seat -> [general names]
  let logSent = 0;
  let started = false;

  const ui = () => window.__sgsUI && window.__sgsUI.net;
  const NET = () => window.SGS_NET;

  function toast(msg) { try { ui().toast(msg); } catch (e) { console.log(msg); } }

  /* ---------------- 大廳 UI ---------------- */
  function panel() { return $('#netPanel'); }
  function showPanel(html) { const p = panel(); if (p) { p.classList.remove('hidden'); p.innerHTML = html; } }
  function hidePanel() { const p = panel(); if (p) { p.classList.add('hidden'); p.innerHTML = ''; } }

  function roomHTML(code) {
    return `<div class="net-title">房間已建立</div>
      <div class="net-code">${code}</div>
      <div class="net-hint">把這 4 個字母告訴同學，他們在大廳輸入後按「加入房間」</div>
      <div class="net-list" id="netList"></div>
      <div class="net-row">
        <button class="btn-primary" id="netStart">開 始 遊 戲</button>
        <button class="opt" id="netClose">關閉房間</button>
      </div>`;
  }

  function renderGuestList() {
    const box = $('#netList');
    if (!box) return;
    box.innerHTML = '';
    box.appendChild(el('div', 'net-item', `我（房主）· 座位 1`));
    guests.forEach((g, i) => box.appendChild(el('div', 'net-item', `${g.name || '客人'} · 座位 ${i + 2}`)));
    if (!guests.length) box.appendChild(el('div', 'net-item dim', '還沒有人加入…'));
    const btn = $('#netStart');
    if (btn) btn.disabled = guests.length === 0;
  }

  /* ---------------- 房主 ---------------- */
  function createRoom() {
    role = 'host';
    NET().destroy();
    NET().host().then((code) => {
      showPanel(roomHTML(code));
      bindHostButtons();
      renderGuestList();
    }).catch((err) => toast('開房失敗：' + err.message));

    NET().on('guest', (conn) => {
      const maxSeats = seatsNeeded() - 1;
      if (guests.length >= maxSeats) {
        NET().send(conn, { t: 'full' });
        try { conn.close(); } catch (e) {}
        return;
      }
      const seat = guests.length + 1;
      const g = { conn, seat, name: '客人 ' + seat, picked: null };
      guests.push(g);
      NET().send(conn, { t: 'welcome', seat, cfg: publicCfg() });
      renderGuestList();
    });

    NET().on('guestLeave', (conn) => {
      const i = guests.findIndex((g) => g.conn === conn);
      if (i < 0) return;
      const g = guests[i];
      guests.splice(i, 1);
      toast(`${g.name} 離線了`);
      // 對局中：把該座位換成 AI，遊戲不會卡住
      if (hostGame && hostGame.players[g.seat]) {
        const p = hostGame.players[g.seat];
        p.controller = new window.SGS_AI.AIController(null, 300);
        NET().broadcast({ t: 'sys', text: `${g.name} 離線，改由 AI 接手` });
      }
      renderGuestList();
    });

    NET().on('data', ({ conn, msg }) => onHostData(conn, msg));
  }

  function bindHostButtons() {
    const start = $('#netStart');
    if (start) start.onclick = () => startOnlineGame();
    const close = $('#netClose');
    if (close) close.onclick = () => { NET().destroy(); guests = []; role = null; hidePanel(); toast('房間已關閉'); };
  }

  function publicCfg() {
    const cfg = ui().cfg;
    return { mode: cfg.mode, packs: cfg.packs.slice(), generalPacks: cfg.generalPacks.slice(), double: !!cfg.double };
  }
  function seatsNeeded() {
    const m = ui().cfg.mode;
    return m === 'duel' ? 2 : (m === 'id3' ? 3 : 5);
  }

  function onHostData(conn, msg) {
    if (!msg || !msg.t) return;
    const g = guests.find((x) => x.conn === conn);
    if (!g) return;
    if (msg.t === 'hello') {
      g.name = String(msg.name || '').slice(0, 12) || g.name;
      renderGuestList();
    } else if (msg.t === 'picked') {
      picks.set(g.seat, msg.names || []);
      g.picked = msg.names || [];
      tryStart();
    } else if (msg.t === 'answer') {
      const ctrl = g.ctrl;
      if (ctrl && ctrl.resolve) { const r = ctrl.resolve; ctrl.resolve = null; r(msg.res); }
      else if (ctrl && ctrl.queue && ctrl.queue.length) { const r = ctrl.queue.shift(); r(msg.res); }
    }
  }

  /* 房主的引擎每跑一步就把狀態推給所有客人 */
  function broadcastState() {
    if (!hostGame || !guests.length) return;
    // 日誌增量
    const logs = hostGame.logs || [];
    while (logSent < logs.length) {
      NET().broadcast({ t: 'log', entry: logs[logSent++] });
    }
    for (const g of guests) {
      NET().send(g.conn, { t: 'state', snap: snapshotFor(hostGame, g.seat) });
    }
  }

  function cardSnap(c) {
    if (!c) return null;
    return { id: c.id, name: c.name, suit: c.suit, rank: c.rank, type: c.type, color: c.color, slot: c.slot || null };
  }

  function snapshotFor(g, seat) {
    const eqSlots = ['weapon', 'armor', 'horse+', 'horse-', 'treasure'];
    return {
      mode: g.mode, phase: g.phase, over: !!g.over, turnNo: g.turnNo || 0,
      currentId: g.current ? g.current.id : null,
      winner: g.winner ? { team: g.winner.team, playerId: g.winner.player ? g.winner.player.id : null } : null,
      lastPlay: g.lastPlay ? Object.assign({}, g.lastPlay) : null,
      deckCount: (g.deck || []).length,
      discardCount: (g.discardPile || []).length,
      players: g.players.map((p) => {
        const own = p.seat === seat;
        return {
          id: p.id, seat: p.seat, label: p.label || '', name: p.name || '',
          generals: (p.generals || []).map((x) => ({ name: x.name, kingdom: x.kingdom, hp: x.hp, skills: (x.skills || []).slice(), pack: x.pack })),
          hp: p.hp, maxHp: p.maxHp, alive: !!p.alive,
          handCount: (p.hand || []).length,
          hand: own
            ? (p.hand || []).map(cardSnap)
            : Array.from({ length: (p.hand || []).length }, (_, i) => ({ id: 'hid' + p.id + '_' + i, name: '', suit: '', rank: '', hidden: true })),
          equips: eqSlots.reduce((o, s) => { o[s] = cardSnap(p.equips && p.equips[s]); return o; }, {}),
          judge: (p.judge || []).map(cardSnap),
          identity: p.identity, identityName: p.identityName || '',
          identityRevealed: !!p.identityRevealed,
          skills: (p.skills || []).slice(),
          flipped: !!p.flipped, chained: !!p.chained,
          marks: p.marks ? Object.assign({}, p.marks) : {},
          deadSlots: p.deadSlots ? Object.assign({}, p.deadSlots) : null,
        };
      }),
    };
  }

  /* ---------------- 開始對局 ---------------- */
  function startOnlineGame() {
    const cfg = ui().cfg;
    const nP = seatsNeeded();
    const humans = 1 + guests.length;
    if (humans < 2) return toast('至少要有一位同學加入');
    picks = new Map();

    const need = cfg.double ? 2 : 1;
    const pool = Object.values(window.SGS_GENERALS).filter((x) => cfg.generalPacks.includes(x.pack));
    const sample = () => pool.slice().sort(() => Math.random() - 0.5).slice(0, cfg.double ? 5 : 3);

    started = false;
    // 客人先拿到候選武將
    for (const g of guests) {
      const cands = sample();
      g.cands = cands;
      NET().send(g.conn, { t: 'pick', cands: cands.map((x) => x.name), need });
    }
    // 房主自己選
    const myCands = sample();
    ui().pickNet(myCands, need, (names) => {
      picks.set(0, names.map((x) => x.name));
      tryStart();
    });
  }

  function tryStart() {
    if (started) return;
    const humans = 1 + guests.length;
    for (let s = 0; s < humans; s++) if (!picks.has(s)) return;
    started = true;

    const cfg = ui().cfg;
    const nP = seatsNeeded();
    const controllers = [];
    for (let i = 0; i < nP; i++) {
      if (i === 0) controllers.push(ui().makeHuman(0));
      else {
        const g = guests.find((x) => x.seat === i);
        controllers.push(g ? makeRemote(g) : new window.SGS_AI.AIController(null, cfg.speed));
      }
    }
    const forced = [];
    for (let i = 0; i < humans; i++) {
      const names = picks.get(i) || [];
      forced.push(names.map((n) => window.SGS_GENERALS[n]).filter(Boolean));
    }

    ui().startGameWith(controllers, forced, 0);
    hostGame = window.__sgs.game;
    logSent = 0;
    started = true;
    hidePanel();
    // 每次狀態變化就推給客人
    const origUpdate = hostGame.update.bind(hostGame);
    hostGame.update = function () {
      const r = origUpdate();
      broadcastState();
      return r;
    };
    // 引擎的 ask 也會觸發 update，但保險起見在每個 log 後同步
    const origLog = hostGame.log.bind(hostGame);
    hostGame.log = function (msg, kind) {
      const r = origLog(msg, kind);
      broadcastState();
      return r;
    };
    broadcastState();
  }

  function makeRemote(g) {
    const ctrl = {
      isHuman: true, remote: true, seat: g.seat, queue: [], resolve: null,
      respond(game, p, req) {
        return new Promise((resolve) => {
          const payload = cleanReq(req);
          if (ctrl.resolve) ctrl.queue.push(ctrl.resolve);
          ctrl.resolve = resolve;
          NET().send(g.conn, { t: 'ask', req: payload });
        });
      },
    };
    g.ctrl = ctrl;
    return ctrl;
  }

  function cleanReq(req) {
    const out = { kind: req.kind, prompt: req.prompt || '' };
    for (const k of ['cards', 'candidates', 'min', 'max', 'count', 'cancelable', 'options', 'cardData', 'skippable']) {
      if (req[k] !== undefined) out[k] = JSON.parse(JSON.stringify(req[k]));
    }
    return out;
  }

  /* ---------------- 客人 ---------------- */
  function joinRoom(code) {
    role = 'guest';
    NET().destroy();
    toast('連線中…');
    NET().join(code).then(() => {
      NET().sendHost({ t: 'hello', name: '玩家' });
      showPanel(`<div class="net-title">已連上房間 ${code}</div>
        <div class="net-hint">等房主按「開始遊戲」…</div>`);
    }).catch((err) => toast('加入失敗：' + err.message));

    NET().on('data', ({ msg }) => onGuestData(msg));
    NET().on('closed', () => { toast('與房主的連線斷了'); ui().backToLobby(); });
    NET().on('error', (err) => toast('連線錯誤：' + (err.message || err.type)));
  }

  function onGuestData(msg) {
    if (!msg || !msg.t) return;
    if (msg.t === 'welcome') {
      guestSeat = msg.seat;
      if (msg.cfg && ui()) Object.assign(ui().cfg, msg.cfg);
      showPanel(`<div class="net-title">你是座位 ${msg.seat + 1}</div>
        <div class="net-hint">等房主按「開始遊戲」…</div>`);
    } else if (msg.t === 'pick') {
      hidePanel();
      const cands = (msg.cands || []).map((n) => window.SGS_GENERALS[n]).filter(Boolean);
      ui().pickNet(cands, msg.need || 1, (glist) => {
        NET().sendHost({ t: 'picked', names: glist.map((x) => x.name) });
        showPanel(`<div class="net-title">已選好武將</div><div class="net-hint">等其他人選完…</div>`);
      });
    } else if (msg.t === 'state') {
      fakeGame = buildFake(msg.snap, guestSeat);
      if (fakeGame.pendingAsk) delete fakeGame.pendingAsk;
      ui().refreshView ? ui().refreshView(fakeGame, guestSeat) : ui().setView(fakeGame, guestSeat);
    } else if (msg.t === 'log') {
      ui().appendLog(msg.entry);
    } else if (msg.t === 'ask') {
      if (!fakeGame) return;
      ui().showAsk(fakeGame, guestSeat, msg.req, (value) => {
        NET().sendHost({ t: 'answer', res: value });
      });
    } else if (msg.t === 'sys') {
      toast(msg.text);
    } else if (msg.t === 'full') {
      toast('房間滿了');
      ui().backToLobby();
    }
  }

  function buildFake(snap, seat) {
    if (!snap) return null;
    const players = (snap.players || []).map((ps) => {
      const clone = Object.assign({}, ps);
      clone.hand = (ps.hand || []).map((c) => Object.assign({}, c));
      clone.equips = Object.assign({}, ps.equips);
      clone.judge = (ps.judge || []).map((c) => Object.assign({}, c));
      clone.controller = { isHuman: ps.seat === seat, remote: ps.seat !== seat };
      return clone;
    });
    const g = {
      mode: snap.mode, phase: snap.phase, over: snap.over, winner: snap.winner || null,
      current: players.find((p) => p.id === snap.currentId) || null,
      lastPlay: snap.lastPlay || null,
      deck: new Array(snap.deckCount || 0),
      discardPile: new Array(snap.discardCount || 0),
      players,
      turnNo: snap.turnNo || 0,
      playerById(id) { return players.find((p) => p.id === id) || null; },
      nameOf(p) { return p ? (p.generals || []).map((x) => x.name).join('&') : '？'; },
    };
    return g;
  }

  /* ---------------- 對外 ---------------- */
  return {
    createRoom, joinRoom,
    get role() { return role; },
    get mySeat() { return guestSeat; },
    isOnline() { return role === 'host' || role === 'guest'; },
  };
})();
