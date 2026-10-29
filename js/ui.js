/* 三國殺 · 介面層（大廳 / 選將 / 對局 / 操作） */
(function () {
  'use strict';
  const C = window.SGS_CARDS, SETUP = window.SGS_SETUP, AI = window.SGS_AI;
  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, txt) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  };

  const PHASE_TXT = { judge: '判定階段', draw: '摸牌階段', play: '出牌階段', discard: '棄牌階段', end: '結束階段' };
  const KINGDOM_TXT = { 蜀: '蜀', 魏: '魏', 吳: '吳', 群: '群', 神: '神' };
  const ROLE_TXT = { lord: '主公', loyal: '忠臣', rebel: '反賊', spy: '內奸', none: '單挑' };

  const cfg = {
    mode: 'id5', packs: ['std'], generalPacks: ['std'], double: false,
    nPlayers: 5, speed: 220,
  };

  let game = null;
  let pending = null;         // 目前等待玩家回應的請求
  let sel = { cards: [], targets: [] };
  let pickState = null;       // 選將
  let mySeat = 0;
  let logCursor = 0;
  let rafQueued = false;
  const seatPos = {};          // playerId -> {x,y}（相對棋盤）
  const FX = window.SGS_FX;
  const AUDIO = window.SGS_AUDIO;
  const VOICE = window.SGS_VOICE;

  /* ================= 大廳 ================= */
  const MODES = [
    { key: 'id5', label: '5 人身份局', sub: '主公·忠臣·反賊×2·內奸' },
    { key: 'id3', label: '3 人身份局', sub: '主公·反賊·內奸' },
    { key: 'duel', label: '1v1 單挑', sub: '先倒下者輸' },
    { key: 'hotseat', label: '同機多人', sub: '5 人輪流操作' },
  ];
  const CARD_PACKS = [
    { key: 'std', label: '標準', sub: '108 張' },
    { key: 'ex', label: '軍爭', sub: '火殺·雷殺·酒·鐵索' },
  ];
  const GEN_PACKS = [
    { key: 'std', label: '標將', sub: '25 隻' },
    { key: 'jie', label: '界將', sub: '界限突破' },
    { key: 'god', label: '神將', sub: '神話再臨' },
    { key: 'sp', label: 'SP 將', sub: '' },
    { key: 'famous', label: '一將成名', sub: '' },
    { key: 'windfire', label: '風林火山', sub: '神話再臨' },
    { key: 'menfa', label: '門閥士族', sub: '' },
    { key: 'mo', label: '魔', sub: '魔將' },
    { key: 'mou', label: '謀', sub: '謀攻篇' },
    { key: 'guozhan', label: '國戰', sub: '國戰將池' },
    { key: 'other', label: '其他', sub: '' },
    { key: 'custom', label: '自定義', sub: '' },
  ];

  function buildLobby() {
    const mo = $('#modeOpts');
    mo.innerHTML = '';
    MODES.forEach(m => {
      const b = el('button', 'opt' + (cfg.mode === m.key ? ' on' : ''));
      b.innerHTML = `${m.label}<small>${m.sub}</small>`;
      b.onclick = () => { cfg.mode = m.key; cfg.nPlayers = m.key === 'id3' ? 3 : 5; buildLobby(); };
      mo.appendChild(b);
    });

    const po = $('#packOpts');
    po.innerHTML = '';
    CARD_PACKS.forEach(p => {
      const on = cfg.packs.includes(p.key);
      const b = el('button', 'opt' + (on ? ' on' : ''));
      b.innerHTML = `${p.label}<small>${p.sub}</small>`;
      b.onclick = () => {
        if (on) { if (cfg.packs.length > 1) cfg.packs = cfg.packs.filter(x => x !== p.key); }
        else cfg.packs.push(p.key);
        buildLobby();
      };
      po.appendChild(b);
    });

    const go = $('#gpackOpts');
    go.innerHTML = '';
    GEN_PACKS.forEach(p => {
      const count = Object.values(window.SGS_GENERALS).filter(g => g.pack === p.key).length;
      const on = cfg.generalPacks.includes(p.key);
      const b = el('button', 'opt' + (on ? ' on' : '') + (count === 0 ? ' dis' : ''));
      b.innerHTML = `${p.label}<small>${count ? count + ' 隻' : '待加入'}</small>`;
      if (count === 0) { b.style.opacity = '.35'; b.style.cursor = 'not-allowed'; return; }
      b.onclick = () => {
        if (on) { if (cfg.generalPacks.length > 1) cfg.generalPacks = cfg.generalPacks.filter(x => x !== p.key); }
        else cfg.generalPacks.push(p.key);
        buildLobby();
      };
      go.appendChild(b);
    });

    document.querySelectorAll('#genOpts .opt').forEach(b => {
      b.classList.toggle('on', (b.dataset.double === '1') === cfg.double);
      b.onclick = () => { cfg.double = b.dataset.double === '1'; buildLobby(); };
    });

    const totalPicks = Object.values(window.SGS_GENERALS).filter(g => cfg.generalPacks.includes(g.pack)).length;
    $('#lobbyFoot').innerHTML =
      `牌庫 ${C.total(cfg.packs)} 張 · 武將 ${totalPicks} 隻 · ${cfg.double ? '雙將模式（體力取最高）' : '單將模式'}<br>` +
      `單人對 AI：你操控 1 號位，其餘由電腦操作。`;
    $('#btnStart').disabled = totalPicks < (cfg.double ? 2 : 1);
  }

  /* ================= 選將 ================= */
  function beginPick() {
    const pool = Object.values(window.SGS_GENERALS).filter(g => cfg.generalPacks.includes(g.pack));
    const need = cfg.double ? 2 : 1;
    const nShow = cfg.double ? 5 : 3;
    const shuffled = pool.slice().sort(() => Math.random() - 0.5).slice(0, Math.min(nShow, pool.length));
    pickState = { pool, cands: shuffled, need, picked: [] };
    $('#pickTitle').textContent = cfg.double ? '選 擇 兩 名 武 將（體力取最高）' : '選 擇 你 的 武 將';
    $('#pickHint').textContent = need > 1 ? `已選 ${pickState.picked.length} / ${need}` : '';
    renderPick();
    $('#lobby').classList.add('hidden');
    $('#pick').classList.remove('hidden');
  }

  function renderPick() {
    const box = $('#pickCards');
    box.innerHTML = '';
    for (const g of pickState.cands) {
      const card = el('div', 'gcard' + (pickState.picked.includes(g) ? ' sel' : ''));
      const skills = g.skills.map(s => {
        const sk = window.SGS_SKILLS[s];
        return `<div>【${s}】</div><div class="desc">${sk ? sk.desc : ''}</div>`;
      }).join('');
      const todoN = g.skills.filter(x => (window.SGS_SKILLS[x] || {}).todo).length;
      const allTodo = todoN === g.skills.length && todoN > 0;
      card.classList.toggle('untested', allTodo);
      card.innerHTML = `
        <div class="gport"><img alt=""></div>
        ${allTodo ? '<div class="gtodo">技能未實作 · 只有基本牌</div>' : ''}
        <div class="kingdom">${KINGDOM_TXT[g.kingdom] || g.kingdom} · ${(window.SGS_PACK_NAMES[g.pack] || g.pack)}</div>
        <div class="gname">${g.name}</div>
        <div class="hprow"></div>
        <div class="skills">${skills}</div>`;
      const img = card.querySelector('.gport img');
      img.addEventListener('error', () => {
        const stage = Number(img.dataset.stage || 0);
        if (stage === 0 && /^(界|神|SP)/.test(String(g.name))) {
          img.dataset.stage = '1';
          img.src = 'assets/portraits/' + baseName(g.name) + '.jpg';
        } else {
          img.src = fallbackAvatar(g.name, g.kingdom);
        }
      });
      img.src = portraitURL(g.name);
      const hr = card.querySelector('.hprow');
      for (let i = 0; i < g.hp; i++) hr.appendChild(magatama(true));
      const more = el('div', 'gmore', '技能詳情');
      more.onclick = (ev) => { ev.stopPropagation(); showGenSheet([g], `${g.hp} 體力`); };
      card.appendChild(more);
      card.onclick = (ev) => { if (ev.target === more) return; chooseGeneral(g); };
      box.appendChild(card);
    }
  }

  function chooseGeneral(g) {
    const i = pickState.picked.indexOf(g);
    if (i >= 0) pickState.picked.splice(i, 1);
    else {
      if (pickState.picked.length >= pickState.need) pickState.picked.shift();
      pickState.picked.push(g);
    }
    renderPick();
    $('#pickHint').textContent = `已選 ${pickState.picked.length} / ${pickState.need}`;
    if (pickState.picked.length === pickState.need) setTimeout(() => startGame(), 180);
  }

  /* ================= 開始對局 ================= */
  function makeHuman(seat) {
    const ctrl = {
      isHuman: true,
      respond(g, p, req) {
        return new Promise((resolve) => {
          pending = { g, p, req, resolve };
          sel = { cards: [], targets: [] };
          scheduleRender();
        });
      },
    };
    return ctrl;
  }

  function startGame() {
    $('#pick').classList.add('hidden');
    $('#lobby').classList.add('hidden');
    $('#table').classList.remove('hidden');
    $('#result').classList.add('hidden');
    $('#log').innerHTML = '';
    logCursor = 0;

    const nP = cfg.mode === 'duel' ? 2 : (cfg.mode === 'id3' ? 3 : 5);
    cfg.nPlayers = nP;

    const controllers = [];
    for (let i = 0; i < nP; i++) {
      const human = (cfg.mode === 'hotseat') || i === 0;
      controllers.push(human ? makeHuman(i) : new AI.AIController(null, cfg.speed));
    }

    game = SETUP.makeGame({
      mode: cfg.mode,
      packs: cfg.packs,
      generalPacks: cfg.generalPacks,
      doubleGeneral: cfg.double,
      controllers,
      forcedGenerals: [pickState.picked],
      onLog: (entry) => appendLog(entry),
      onUpdate: () => scheduleRender(),
      onEvent: (type, data) => handleEvent(type, data),
    });
    mySeat = 0;
    $('#phaseLabel').textContent = '';
    $('#promptLabel').textContent = '';

    setTimeout(() => FX && FX.resize(), 30);
    window.__sgs = { game, cfg };
    game.runGame().then(() => showResult()).catch(err => {
      console.error(err);
      toast('引擎錯誤：' + err.message);
    });
    scheduleRender();
  }

  /* ================= 日誌 ================= */
  function appendLog(entry) {
    const box = $('#log');
    const line = el('div', 'l ' + (entry.kind || ''), entry.msg);
    box.appendChild(line);
    while (box.children.length > 400) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
    if (entry.kind === 'skill') speakFromLog(entry.msg);
  }

  /* 技能日誌 → 角色語音：日誌形如「劉備 發動【仁德】…」或「…的【剛烈】」
     引擎只有少數地方發 skill 事件，靠日誌補齊，讓技能語音真的會響 */
  function speakFromLog(msg) {
    if (!VOICE || !VOICE.playSkill || !game) return;
    const m = /【([^】]+)】/.exec(msg || '');
    if (!m) return;
    const sk = m[1];
    // 只認「日誌開頭就是某位武將名」的情況，避免張冠李戴播錯人的語音
    const who = game.players.find(p => p.alive && p.generals.some(g => msg.startsWith(g.name + ' ')));
    if (!who) return;
    const g = who.generals.find(x => (x.skills || []).includes(sk)) || who.generals[0];
    const all = who.generals.flatMap(x => x.skills || []);
    const idx = all.indexOf(sk);
    if (idx < 0 || idx > 5) return;      // 官方每隻最多 5 個技能語音檔
    VOICE.playSkill(g.name, sk, all);
  }

  /* ================= 事件 → 特效 / 音效 ================= */
  function posOf(p) {
    return (p && seatPos[p.id]) || { x: (FX.W || 600) / 2, y: (FX.H || 400) / 2 };
  }

  function handleEvent(type, d) {
    if (!FX || !FX.ctx) return;
    switch (type) {
      case 'sha': {
        const s = posOf(d.source);
        (d.targets || []).forEach(t => {
          const a = posOf(t);
          FX.slash(a.x, a.y, '#ffd9a0', Math.atan2(a.y - s.y, a.x - s.x) + 1.2);
          FX.burst(a.x, a.y, '#ffcf8a', 8, 200);
        });
        AUDIO.play('sha');
        break;
      }
      case 'damage': {
        const t = posOf(d.target);
        FX.burst(t.x, t.y, d.nature === 'fire' ? '#ff8a3d' : d.nature === 'thunder' ? '#8ab4ff' : '#ff5470', 26, 330);
        FX.text(t.x, t.y - 46, '-' + d.amount, '#ff8a9c', 26);
        FX.shake(10 + d.amount * 3);
        AUDIO.play('hit');
        break;
      }
      case 'heal': {
        const t = posOf(d.target);
        FX.burst(t.x, t.y, '#63ffa0', 20, 190);
        FX.text(t.x, t.y - 44, '+' + d.amount, '#63ffa0', 24);
        AUDIO.play('heal');
        break;
      }
      case 'judge': {
        const t = posOf(d.player);
        FX.ring(t.x, t.y, '#d9b46a', 10, 80);
        FX.text(t.x, t.y - 56, (d.card.suit || '') + C.rankText(d.card.rank), '#f2d79a', 22);
        AUDIO.play('judge');
        break;
      }
      case 'draw': {
        const t = posOf(d.player);
        FX.fly({ x: FX.W / 2, y: FX.H / 2 }, { x: t.x, y: t.y }, '牌');
        AUDIO.play('draw');
        break;
      }
      case 'trick': {
        (d.targets || []).forEach(q => {
          const t = posOf(q);
          FX.ring(t.x, t.y, '#b06bff', 8, 70);
        });
        AUDIO.play('play');
        break;
      }
      case 'skill': {
        const t = posOf(d.player);
        FX.ring(t.x, t.y, '#6fd3ff', 14, 64);
        FX.text(t.x, t.y - 50, '【' + d.skill + '】', '#9fe8ff', 16);
        AUDIO.play('skill');
        if (VOICE && d.player) {
          const g0 = d.player.generals[0] || {};
          const all = d.player.generals.flatMap(x => x.skills || []);
          VOICE.playSkill(g0.name, d.skill, all);
        }
        break;
      }
      case 'death': {
        const t = posOf(d.player);
        FX.burst(t.x, t.y, '#ff5470', 60, 420);
        FX.ring(t.x, t.y, '#ff5470', 12, 160);
        FX.text(t.x, t.y - 40, '陣亡', '#ff8a9c', 24);
        FX.shake(16);
        AUDIO.play('death');
        if (VOICE && d.player) {
          const g0 = d.player.generals[0] || {};
          VOICE.play(g0.name, 'dead');
        }
        break;
      }
      default: break;
    }
  }

  /* ================= 繪製 ================= */
  function scheduleRender() {
    if (rafQueued) return;
    rafQueued = true;
    requestAnimationFrame(() => { rafQueued = false; render(); });
  }

  function viewer() {
    if (!game) return null;
    if (pending && pending.p && pending.p.controller.isHuman) return pending.p;
    if (cfg.mode === 'hotseat') return game.current || game.players[0];
    return game.players[mySeat];
  }

  function render() {
    if (!game) return;
    renderSeats();
    try { renderRoleBar(); renderDeckInfo(); renderPlayArea(); } catch (e) {}
    renderCenter();
    renderHand();
    renderActions();
    if (game.phase) $('#phaseLabel').textContent = PHASE_TXT[game.phase] || '';
  }

  function renderCenter() {
    const lbl = $('#promptLabel');
    const phaseTxt = PHASE_TXT[game.phase] || '';
    if (pending) {
      const pr = pending.req.prompt || '';
      // 提示只是階段名時不要跟階段標籤重複
      lbl.textContent = (pr && pr !== phaseTxt) ? pr : '';
    } else if (game.current) lbl.textContent = `${nameOf(game.current)} 的回合`;
    else lbl.textContent = '';
  }

  const KINGDOM_COLOR = { 蜀: '#3f7d5b', 魏: '#3a5c8f', 吳: '#8f3a45', 群: '#6b6250', 神: '#8a6a2a' };

  function baseName(n) { return String(n).replace(/^(界|神|SP)/, ''); }

  function fallbackAvatar(name, kingdom) {
    const color = KINGDOM_COLOR[kingdom] || '#555';
    const ch = baseName(name)[0] || '?';
    const svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>" +
      "<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>" +
      "<stop offset='0' stop-color='" + color + "'/><stop offset='1' stop-color='#0b0e14'/>" +
      "</linearGradient></defs><rect width='100' height='100' fill='url(#g)'/>" +
      "<text x='50' y='70' font-size='54' text-anchor='middle' fill='#efe3c8' opacity='.9' " +
      "font-family='PingFang TC,serif'>" + ch + "</text></svg>";
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function portraitURL(name) {
    const pre = String(name).match(/^(界|神|SP)/);
    if (pre) return 'assets/portraits/variants/' + pre[1] + baseName(name) + '.jpg';
    return 'assets/portraits/' + baseName(name) + '.jpg';
  }

  // 版本專用圖 → 本名圖 → 圖章頭像（三段退路，不會破圖）
  function avatarEl(name, kingdom, cls) {
    const img = el('img', 'avatar ' + (cls || ''));
    img.alt = baseName(name);
    img.dataset.stage = '0';
    img.onerror = () => {
      const stage = Number(img.dataset.stage || 0);
      if (stage === 0 && /^(界|神|SP)/.test(String(name))) {
        img.dataset.stage = '1';
        img.src = 'assets/portraits/' + baseName(name) + '.jpg';
      } else {
        img.onerror = null;
        img.src = fallbackAvatar(name, kingdom);
      }
    };
    img.src = portraitURL(name, kingdom);
    return img;
  }

  const MAG_PATH = 'M9.2 1.1C12.5 1.1 14.9 3.6 14.9 6.8C14.9 10.5 12.2 13.3 7.5 15.2C9 12.9 9.5 10.9 9 8.9C8.4 6.4 6.1 5.2 5.3 3.8C4.6 2.7 5.5 1.1 9.2 1.1Z';

  function magatama(on) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('class', 'mag' + (on ? ' on' : ''));
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', MAG_PATH);
    svg.appendChild(p);
    return svg;
  }

  function hpJade(hp, maxHp) {
    const row = el('div', 'hprow');
    const m = Math.max(maxHp, hp);
    for (let i = 0; i < m; i++) row.appendChild(magatama(i < hp));
    return row;
  }

  function nameOf(p) {
    const g = p.generals.map(x => x.name).join('&');
    return (p.identity === 'lord' ? '👑 ' : '') + g;
  }


  /* 左上：身份人數統計（仿官方 主x1 忠x1 反x2 內x1） */
  function renderRoleBar() {
    const bar = document.getElementById('roleBar');
    if (!bar || !game) return;
    if (game.mode === 'duel' || game.mode === 'hotseat' && game.players.length === 2) {
      bar.textContent = game.mode === 'duel' ? '1v1 單挑' : '';
      return;
    }
    const alive = game.players.filter(p => p.alive);
    const cnt = { lord: 0, loyal: 0, rebel: 0, spy: 0 };
    game.players.forEach(p => { if (cnt[p.identity] !== undefined) cnt[p.identity]++; });
    const aliveCnt = { lord: 0, loyal: 0, rebel: 0, spy: 0 };
    alive.forEach(p => { if (aliveCnt[p.identity] !== undefined) aliveCnt[p.identity]++; });
    const txt = [
      ['主', 'lord'], ['忠', 'loyal'], ['反', 'rebel'], ['內', 'spy'],
    ].filter(([, k]) => cnt[k]).map(([label, k]) => `${label} ${aliveCnt[k]}/${cnt[k]}`).join('　');
    bar.textContent = txt;
  }

  /* 右上：牌堆／棄牌堆 */
  function renderDeckInfo() {
    const d = document.getElementById('deckInfo');
    if (!d || !game) return;
    const deck = (game.deck || []).length;
    const dis = (game.discardPile || []).length;
    d.innerHTML = `<span>牌堆 <b>${deck}</b></span><span>棄 <b>${dis}</b></span>`;
  }

  /* 中央：剛剛打出的牌 */
  function renderPlayArea() {
    const box = document.getElementById('playArea');
    if (!box || !game) return;
    const lp = game.lastPlay;
    if (!lp || Date.now() - (lp.at || 0) > 6000) { box.innerHTML = ''; return; }
    const who = game.playerById && game.playerById(lp.by);
    const mine = who && who.seat === mySeat;
    box.innerHTML = `<div class="playcard ${C.isRed({ suit: lp.suit }) ? 'red' : 'black'}">
        <div class="suit">${lp.suit || ''}</div><div class="num">${C.rankText(lp.rank)}</div>
        <div class="cname">${lp.name}</div></div>
      <div class="playby">${mine ? '你' : (who ? who.generals.map(g => g.name).join('&') : '')} 打出</div>`;
  }


  /* 技能詳情：點自己的武將卡才開，對手的卡不給點 */
  function showSkillSheet(p) {
    showGenSheet(p.generals, `${p.hp}/${p.maxHp}`);
  }

  /* generals: 武將物件陣列；hpText: 右上顯示的體力文字 */
  function showGenSheet(generals, hpText) {
    const sheet = document.getElementById('sheet');
    const body = document.getElementById('sheetBody');
    const title = document.getElementById('sheetTitle');
    if (!sheet || !body) return;
    title.textContent = generals.map(g => g.name).join(' & ') + (hpText ? `（${hpText}）` : '');
    body.innerHTML = '';
    generals.forEach(g => {
      const head = el('div', 'sheet-gen');
      head.textContent = `${g.name} · ${KINGDOM_TXT[g.kingdom] || g.kingdom} · ${g.hp} 體力`;
      body.appendChild(head);
      g.skills.forEach(name => {
        const sk = (window.SGS_SKILLS || {})[name] || {};
        const row = el('div', 'sheet-skill');
        const nmEl = el('div', 'sk-name', `【${name}】`);
        if (sk.todo) nmEl.appendChild(el('span', 'sk-todo', '未實作'));
        else if (sk.noop) nmEl.appendChild(el('span', 'sk-todo', '國戰專用'));
        row.appendChild(nmEl);
        row.appendChild(el('div', 'sk-desc', sk.desc || '（尚無說明）'));
        body.appendChild(row);
      });
    });
    const extra = el('div', 'sheet-note', '遊戲中主動技按鈕在手牌上方；觸發技會在時機到了自動詢問你。');
    body.appendChild(extra);
    sheet.classList.remove('hidden');
  }

  function renderSeats() {
    const seats = $('#seats');
    const me = viewer() || game.players[0];
    const n = game.players.length;
    const W = seats.clientWidth || window.innerWidth;
    const H = seats.clientHeight || (window.innerHeight - 200);
    const small = window.innerWidth <= 720;
    const cx = W / 2, cy = H / 2 + (small ? 10 : -10);
    // 座位是立繪卡（112×158），環半徑要扣掉卡片高度，否則自己的卡會被下方手牌區切掉
    const rx = Math.min(W * (small ? 0.30 : 0.38), 400);
    const ry = Math.min(H * (small ? 0.26 : 0.34), 240) - (small ? 6 : 18);

    seats.innerHTML = '';
    for (let k = 0; k < n; k++) {
      const p = game.players[(me.seat + k) % n];
      const ang = (90 + k * (360 / n)) * Math.PI / 180;
      const seat = el('div', 'seat');
      if (p === game.current) seat.classList.add('current');
      if (p === me) seat.classList.add('me');
      if (!p.alive) seat.classList.add('dead');
      if (isTargetable(p)) seat.classList.add('targetable');
      if (sel.targets.includes(p.id)) seat.classList.add('chosen');
      const px = cx + Math.cos(ang) * rx;
      const py = cy + Math.sin(ang) * ry;
      seatPos[p.id] = { x: px, y: py };
      seat.style.left = px + 'px';
      seat.style.top = py + 'px';

      const g0 = p.generals[0] || { name: '?', kingdom: '群' };
      seat.classList.add('k-' + (KINGDOM_TXT[g0.kingdom] || '群'));

      // 仿官方：整塊是武將立繪卡，左緣直排勾玉、底部名牌、右下角手牌數
      const frame = el('div', 'frame');
      if (p.generals.length > 1) {
        const duo = el('div', 'duo');
        p.generals.forEach(g => {
          const box = el('div', 'duobox');
          box.appendChild(avatarEl(g.name, g.kingdom, 'portrait'));
          box.appendChild(el('div', 'duoname', g.name));
          duo.appendChild(box);
        });
        frame.appendChild(duo);
      } else {
        frame.appendChild(avatarEl(g0.name, g0.kingdom, 'portrait'));
      }
      frame.appendChild(el('div', 'shade'));

      const hpCol = el('div', 'hpcol');
      const mx = Math.max(p.maxHp, p.hp);
      for (let i = 0; i < mx; i++) hpCol.appendChild(magatama(i < p.hp));
      frame.appendChild(hpCol);

      const plate = el('div', 'plate');
      const nm = el('div', 'nm', p.generals.map(g => g.name).join('&'));
      const roleTxt = p.identity === 'lord' ? '主公'
        : (p.identityRevealed || !p.alive ? ROLE_TXT[p.identity] : '身份不明');
      plate.appendChild(nm);
      plate.appendChild(el('div', 'role', roleTxt));
      frame.appendChild(plate);

      frame.appendChild(el('div', 'hand-n', String(p.hand.length)));

      const SLOTS = [['weapon', '武'], ['armor', '防'], ['horse+', '+1'], ['horse-', '-1'], ['treasure', '寶']];
      const hasEq = SLOTS.some(([k]) => p.equips[k]);
      if (hasEq) {
        const eqbar = el('div', 'eqbar');
        SLOTS.forEach(([k, icon]) => {
          const c = p.equips[k];
          if (!c) return;
          const chip = el('span', 'eqitem');
          chip.appendChild(el('i', 'eqicon', icon));
          chip.appendChild(el('b', '', c.name));
          eqbar.appendChild(chip);
        });
        seat.appendChild(eqbar);
      }
      if (p.chained) frame.appendChild(el('div', 'chained', '⛓'));
      if (p.flipped) frame.appendChild(el('div', 'chained', '⟲'));
      if (p.judge && p.judge.length) frame.appendChild(el('div', 'judge-n', '判' + p.judge.length));

      seat.appendChild(frame);
      if (p === me) {
        const skBtn = el('div', 'skbtn', '技能');
        skBtn.onclick = (ev) => { ev.stopPropagation(); showSkillSheet(p); };
        frame.appendChild(skBtn);
        seat.classList.add('clickable');
        seat.onclick = (ev) => {
          if (pending && pending.req.kind === 'targets' && isTargetable(p)) return;
          showSkillSheet(p);
        };
      }
      if (pending && pending.req.kind === 'targets' && sel.targets.includes(p.id)) {
        frame.appendChild(el('div', 'bubble', '目標'));
      }
      seats.appendChild(seat);
    }
  }

  document.addEventListener('click', (ev) => {
    const sheet = document.getElementById('sheet');
    if (!sheet || sheet.classList.contains('hidden')) return;
    if (ev.target.id === 'sheetClose' || ev.target.id === 'sheet') sheet.classList.add('hidden');
  });

  function isTargetable(p) {
    if (!pending) return false;
    const req = pending.req;
    if (req.kind === 'targets') return req.candidates.includes(p.id);
    return false;
  }

  function cardEl(card, opts) {
    opts = opts || {};
    const d = el('div', 'card ' + (C.isRed(card) ? 'red' : 'black'));
    if (card.type === 'equip') d.classList.add('eq');
    if (opts.disabled) d.classList.add('dis');
    if (opts.selected) d.classList.add('sel');
    const typeTxt = card.type === 'basic' ? '基本牌' : (card.type === 'trick' ? (card.delay ? '延時錦囊' : '錦囊') : (card.slotName || '裝備'));
    d.innerHTML = `<img class="cart" alt="" src="assets/cards/art/${encodeURIComponent(card.name)}.png"
        onload="this.parentNode.classList.add('hasart')" onerror="this.remove()">
      <div class="suit">${card.suit}</div><div class="num">${C.rankText(card.rank)}</div>
      <div class="cname">${card.name}</div><div class="ctype">${typeTxt}</div>`;
    if (opts.onClick) d.onclick = opts.onClick;
    return d;
  }

  function viewerPlayer() { return viewer() || game.players[mySeat]; }

  function renderHand() {
    const hand = $('#hand');
    const me = viewerPlayer();
    hand.innerHTML = '';
    $('#myequips').innerHTML = '';
    const eqWrap = $('#myequips');
    ['weapon', 'armor', 'horse+', 'horse-', 'treasure'].forEach(slot => {
      const c = me.equips[slot];
      if (c) {
        const chip = el('div', 'eqchip', `${C.SLOT_NAME[slot]}：${c.suit}${C.rankText(c.rank)}${c.name}`);
        eqWrap.appendChild(chip);
      }
    });

    const req = pending && pending.req;
    let playableIds = null;
    if (req && req.kind === 'play') playableIds = new Set(req.cards.map(x => x.id));
    if (req && (req.kind === 'response')) {
      playableIds = new Set();
      (req.options || []).forEach(o => o.cards.forEach(id => playableIds.add(id)));
    }
    if (req && req.kind === 'discard') playableIds = new Set(me.hand.map(c => c.id));
    if (req && req.kind === 'cards' && req.cards) playableIds = new Set(req.cards);

    me.hand.forEach(card => {
      const disabled = playableIds ? !playableIds.has(card.id) : false;
      const e = cardEl(card, {
        disabled,
        selected: sel.cards.includes(card.id),
        onClick: () => onCardClick(card, disabled),
      });
      hand.appendChild(e);
    });
    if (!me.hand.length) hand.appendChild(el('div', 'pick-hint', '（沒有手牌）'));

    const count = sel.cards.length;
    const need = reqNeedText();
    $('#handinfo').textContent = need || `${me.generals.map(g => g.name).join('&')} 的手牌 ${me.hand.length} 張`;
  }

  function reqNeedText() {
    const req = pending && pending.req;
    if (!req) return '';
    if (req.kind === 'discard') return `請選擇 ${req.count} 張手牌棄置（已選 ${sel.cards.length}）`;
    if (req.kind === 'cards') return `請選擇 ${req.min}${req.max !== req.min ? '~' + req.max : ''} 張（已選 ${sel.cards.length}）`;
    if (req.kind === 'targets') return `請選擇 ${req.min}${req.max !== req.min ? '~' + req.max : ''} 名目標（已選 ${sel.targets.length}）`;
    return '';
  }

  /* ================= 操作 ================= */
  function onCardClick(card, disabled) {
    if (disabled || !pending) return;
    const req = pending.req;

    if (req.kind === 'play') {
      const entries = req.cards.filter(x => x.id === card.id);
      if (!entries.length) return;
      if (entries.length === 1) {
        resolvePending({ cardId: card.id, asName: entries[0].asName || null, skill: entries[0].skill || null });
      } else {
        showCardOptions(card, entries);
      }
      return;
    }

    if (req.kind === 'response') {
      const opt = (req.options || []).find(o => o.cards.includes(card.id) && o.cards.length === 1);
      if (opt) { resolvePending({ cards: [card.id], skill: opt.skill || null }); return; }
      // 需要多張（丈八蛇矛）
      toggleCardSel(card.id);
      render();
      return;
    }

    toggleCardSel(card.id);
    render();
  }

  function toggleCardSel(id) {
    const i = sel.cards.indexOf(id);
    if (i >= 0) sel.cards.splice(i, 1);
    else {
      const req = pending.req;
      const max = req.kind === 'discard' ? req.count : (req.kind === 'cards' ? req.max : 2);
      if (sel.cards.length >= max) sel.cards.shift();
      sel.cards.push(id);
    }
  }

  function showCardOptions(card, entries) {
    const box = $('#actions');
    box.innerHTML = '';
    entries.forEach(ent => {
      const b = el('button', 'act skill', ent.asName ? `當【${ent.asName}】使用` : '使用');
      b.onclick = () => resolvePending({ cardId: card.id, asName: ent.asName || null, skill: ent.skill || null });
      box.appendChild(b);
    });
    const c = el('button', 'act cancel', '取消');
    c.onclick = () => { render(); };
    box.appendChild(c);
  }

  function resolvePending(value) {
    if (!pending) return;
    const p = pending;
    pending = null;
    sel = { cards: [], targets: [] };
    p.resolve(value);
    scheduleRender();
  }

  function seatClick(p) {
    if (!pending || pending.req.kind !== 'targets') return;
    if (!pending.req.candidates.includes(p.id)) return;
    const i = sel.targets.indexOf(p.id);
    if (i >= 0) sel.targets.splice(i, 1);
    else {
      if (sel.targets.length >= (pending.req.max || 1)) sel.targets.shift();
      sel.targets.push(p.id);
    }
    scheduleRender();
  }

  /* ================= 動作列 ================= */
  function renderActions() {
    const box = $('#actions');
    box.innerHTML = '';
    const req = pending && pending.req;

    const mk = (cls, label, fn) => {
      const b = el('button', 'act ' + cls, label);
      b.onclick = fn;
      box.appendChild(b);
      return b;
    };

    if (!req) {
      box.appendChild(el('span', 'pick-hint', game && game.over ? '對局結束' : '等待其他角色行動…'));
      return;
    }

    if (req.kind === 'play') {
      (req.skills || []).forEach(sk => {
        const btn = mk('skill', `【${sk}】`, () => resolvePending({ skill: sk }));
        const def = (window.SGS_SKILLS || {})[sk];
        if (def && def.desc) btn.title = def.desc;      // 滑鼠停留可看技能說明
        btn.dataset.skill = sk;
      });
      mk('', '結束出牌', () => resolvePending({ end: true }));
      return;
    }

    if (req.kind === 'response') {
      const multi = (req.options || []).filter(o => o.cards.length > 1);
      if (multi.length) {
        const btn = mk('ok', '確定打出', () => {
          const ids = sel.cards;
          const opt = multi.find(o => o.cards.length === ids.length && o.cards.every(id => ids.includes(id)));
          if (opt) resolvePending({ cards: ids, skill: opt.skill || null });
          else toast('張數不符');
        });
        btn.disabled = !sel.cards.length;
      }
      if (req.cancelable) mk('cancel', '不打出', () => resolvePending(null));
      if (!multi.length && !req.cancelable) {
        box.appendChild(el('span', 'pick-hint', '必須打出'));
      }
      return;
    }

    if (req.kind === 'targets') {
      const ok = mk('ok', `確定（${sel.targets.length}/${req.max}）`, () => {
        if (sel.targets.length < (req.min || 1)) { toast('目標數量不足'); return; }
        resolvePending(sel.targets.slice());
      });
      ok.disabled = sel.targets.length < (req.min || 1);
      if (req.cancelable) mk('cancel', '取消', () => resolvePending(null));
      return;
    }

    if (req.kind === 'choice') {
      req.options.forEach((o, i) => mk('', o, () => resolvePending(i)));
      return;
    }

    if (req.kind === 'discard' || req.kind === 'cards') {
      const ok = mk('ok', `確定（${sel.cards.length}）`, () => {
        if (sel.cards.length < req.min && req.kind === 'cards') { toast('張數不足'); return; }
        if (req.kind === 'discard' && sel.cards.length !== req.count) { toast(`要選 ${req.count} 張`); return; }
        resolvePending(sel.cards.slice());
      });
      ok.disabled = req.kind === 'discard' ? sel.cards.length !== req.count
        : (sel.cards.length < (req.min || 0));
      if (req.cancelable) mk('cancel', '取消', () => resolvePending(req.kind === 'cards' ? [] : null));
      return;
    }

    if (req.kind === 'chooseFrom') {
      (req.cardData || []).forEach((c, i) => {
        const card = { suit: c.suit, rank: c.rank, name: c.name, type: 'basic' };
        const b = el('button', 'act', `${c.suit}${C.rankText(c.rank)}【${c.name}】`);
        b.onclick = () => resolvePending(i);
        box.appendChild(b);
      });
      if (req.cancelable) mk('cancel', '取消', () => resolvePending(null));
      return;
    }

    if (req.kind === 'chooseZone') {
      if (req.hand) mk('', `手牌區（${req.hand}）`, () => resolvePending(0));
      if (req.equip) mk('', `裝備區（${req.equip}）`, () => resolvePending(1));
      if (req.judge) mk('', `判定區（${req.judge}）`, () => resolvePending(2));
      return;
    }

    box.appendChild(el('span', 'pick-hint', '…'));
  }

  /* ================= 座位點擊 ================= */
  document.addEventListener('click', (e) => {
    const seat = e.target.closest('.seat');
    if (!seat || !game) return;
    const idx = Array.from(document.querySelectorAll('.seat')).indexOf(seat);
    const me = viewer() || game.players[0];
    const p = game.players[(me.seat + idx) % game.players.length];
    if (p) seatClick(p);
  });

  /* ================= 提示 ================= */
  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 1600);
  }

  /* ================= 結算 ================= */
  function showResult() {
    if (!game || !game.winner) return;
    const w = game.winner;
    const sideName = { lord: '主公陣營 勝利', rebel: '反賊陣營 勝利', spy: '內奸 勝利', duel: '決出勝負' };
    const meP = game.players[mySeat];
    const iWin = (w.side === 'lord' && (meP.identity === 'lord' || meP.identity === 'loyal')) ||
      (w.side === 'rebel' && meP.identity === 'rebel') ||
      (w.side === 'spy' && meP.identity === 'spy') ||
      (w.side === 'duel' && w.player === meP);
    $('#resTitle').textContent = iWin ? '勝 利' : (game.mode === 'duel' && w.player === meP ? '勝 利' : '敗 北');
    $('#resSub').textContent = sideName[w.side] || '';
    const roles = $('#resRoles');
    roles.innerHTML = '';
    game.players.forEach(p => {
      const s = el('span', '', `${p.generals.map(g => g.name).join('&')} · ${ROLE_TXT[p.identity]}${p.alive ? '' : '（陣亡）'}`);
      s.style.borderColor = p.identity === 'lord' ? 'rgba(217,180,106,.7)' :
        (p.identity === 'rebel' ? 'rgba(255,84,112,.6)' : 'rgba(255,255,255,.15)');
      roles.appendChild(s);
    });
    $('#result').classList.remove('hidden');
    AUDIO.play(iWin ? 'win' : 'lose');
  }

  /* ================= 自定義武將 ================= */
  const CUSTOM_KEY = 'sgs.customGenerals.v1';
  let customList = [];

  function loadCustom() {
    try {
      customList = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]');
    } catch (e) { customList = []; }
    for (const g of customList) {
      if (!g || !g.name) continue;
      window.SGS_GENERALS[g.name] = {
        name: g.name, kingdom: g.kingdom || '群', hp: g.hp || 4,
        gender: g.gender || 'male', pack: 'custom', skills: (g.skills || []).slice(),
      };
    }
  }

  function persistCustom() {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(customList));
  }

  let edPicked = [];

  function openEditor() {
    $('#editor').classList.remove('hidden');
    edPicked = [];
    const box = $('#edSkills');
    box.innerHTML = '';
    const names = Object.keys(window.SGS_SKILLS).sort();
    for (const name of names) {
      const sk = window.SGS_SKILLS[name];
      const b = el('div', 'eskill', '【' + name + '】');
      b.title = (sk.desc || '') + '　（' + (sk.type || '') + '）';
      b.onclick = () => {
        const i = edPicked.indexOf(name);
        if (i >= 0) { edPicked.splice(i, 1); b.classList.remove('on'); }
        else {
          if (edPicked.length >= 3) { toast('最多 3 個技能'); return; }
          edPicked.push(name); b.classList.add('on');
        }
      };
      box.appendChild(b);
    }
    renderCustomList();
  }

  function renderCustomList() {
    const box = $('#edList');
    box.innerHTML = '';
    if (!customList.length) { box.appendChild(el('div', 'ehint', '（還沒有自定義武將）')); return; }
    customList.forEach((g, i) => {
      const row = el('div', 'item');
      row.innerHTML = `<span><b>${g.name}</b> · ${g.kingdom} · ${g.hp} 體力 · ${(g.skills || []).map(x => '【' + x + '】').join('')}</span>`;
      const del = el('button', '', '刪除');
      del.onclick = () => {
        delete window.SGS_GENERALS[g.name];
        customList.splice(i, 1);
        persistCustom();
        renderCustomList();
        buildLobby();
      };
      row.appendChild(del);
      box.appendChild(row);
    });
  }

  function bindEditor() {
    $('#btnEditor').onclick = openEditor;
    $('#edClose').onclick = () => { $('#editor').classList.add('hidden'); buildLobby(); };
    $('#edSave').onclick = () => {
      const name = ($('#edName').value || '').trim();
      if (!name) { toast('請輸入名稱'); return; }
      if (window.SGS_GENERALS[name]) { toast('名稱重複'); return; }
      if (!edPicked.length) { toast('至少要選一個技能'); return; }
      const g = {
        name,
        kingdom: $('#edKingdom').value,
        hp: parseInt($('#edHp').value, 10) || 4,
        gender: $('#edGender').value,
        skills: edPicked.slice(),
      };
      customList.push(g);
      persistCustom();
      window.SGS_GENERALS[name] = Object.assign({ pack: 'custom', name: g.name }, g);
      $('#edName').value = '';
      edPicked = [];
      document.querySelectorAll('.eskill.on').forEach(x => x.classList.remove('on'));
      renderCustomList();
      buildLobby();
      toast('已儲存：' + name);
    };
    $('#edExport').onclick = () => {
      const txt = JSON.stringify(customList, null, 1);
      navigator.clipboard && navigator.clipboard.writeText(txt);
      window.prompt('已複製到剪貼簿，也可手動複製：', txt);
    };
    $('#edImport').onclick = () => {
      const txt = window.prompt('貼上自定義武將 JSON：');
      if (!txt) return;
      try {
        const arr = JSON.parse(txt);
        if (!Array.isArray(arr)) throw new Error('格式錯誤');
        for (const g of arr) {
          if (!g.name || !g.skills || !g.skills.length) continue;
          if (!customList.some(x => x.name === g.name)) customList.push(g);
          window.SGS_GENERALS[g.name] = Object.assign({ pack: 'custom' }, g);
        }
        persistCustom();
        renderCustomList();
        buildLobby();
        toast('已匯入 ' + arr.length + ' 隻');
      } catch (e) { toast('匯入失敗：' + e.message); }
    };
  }

  /* ================= 啟動 ================= */
  if (FX) FX.init(document.querySelector('#fx'), document.querySelector('#board'));
  document.addEventListener('pointerdown', () => AUDIO.resume(), { passive: true });
  document.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.card, .act, .gcard, .seat')) AUDIO.play('click');
  }, { passive: true });

  const SPEEDS = [{ label: '慢', v: 420 }, { label: '正常', v: 220 }, { label: '快', v: 90 }, { label: '瞬發', v: 0 }];
  let speedIdx = 1;
  /* ───── 背景音樂（YouTube 官方播放器嵌入，不抓音檔） ───── */
  const BGM_ID = 'aEhc2NKUsjA';
  const BGM_KEY = 'sgs.bgm';
  let ytPlayer = null;
  let bgmWanted = localStorage.getItem(BGM_KEY) !== 'off';

  function loadYTApi(cb) {
    if (window.YT && window.YT.Player) return cb();
    if (!document.querySelector('#yt-api')) {
      const sc = document.createElement('script');
      sc.id = 'yt-api';
      sc.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(sc);
    }
    const t = setInterval(() => { if (window.YT && window.YT.Player) { clearInterval(t); cb(); } }, 200);
    setTimeout(() => clearInterval(t), 8000);
  }

  let localBgm = null;

  /* 讀 assets/bgm/config.json；local:true 時用本機 theme.mp3，否則用 YouTube（不會有 404 探測） */
  function tryLocalBgm(cb) {
    fetch('assets/bgm/config.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(cfg => {
      if (!cfg || !cfg.local) return cb(false);
      localBgm = new Audio('assets/bgm/theme.mp3');
      localBgm.loop = true;
      localBgm.volume = (cfg.volume || 35) / 100;
      if (bgmWanted) localBgm.play().catch(() => {});
      document.querySelector('#btnBgm').classList.add('on');
      cb(true);
    }).catch(() => cb(false));
  }

  window.__bgmLocal = () => (localBgm ? { paused: localBgm.paused, t: localBgm.currentTime } : null);

  function initBGM() {
    if (ytPlayer || localBgm || !bgmWanted) return;
    tryLocalBgm(ok => { if (!ok) initYT(); });
  }

  function initYT() {
    if (ytPlayer || !bgmWanted) return;
    loadYTApi(() => {
      if (ytPlayer) return;
      try {
        ytPlayer = new window.YT.Player('bgm', {
          videoId: BGM_ID,
          playerVars: { autoplay: 1, controls: 0, loop: 1, playlist: BGM_ID, disablekb: 1, modestbranding: 1, rel: 0 },
          events: {
            onReady: e => { e.target.setVolume(35); e.target.playVideo(); },
            onStateChange: e => {
              if (bgmWanted && e.data === 0) e.target.playVideo();   // 保險：播完再播
            },
          },
        });
        document.querySelector('#btnBgm').classList.add('on');
      } catch (err) {
        console.warn('BGM 初始化失敗', err);
      }
    });
  }

  // 首次點擊（使用者手勢）才啟動，符合瀏覽器自動播放政策
  document.addEventListener('click', function once() {
    initBGM();
    document.removeEventListener('click', once);
  }, { once: true });

  const btnBgmLobby = document.querySelector('#btnBgmLobby');
  function syncBgmBtns() {
    [document.querySelector('#btnBgm'), btnBgmLobby].forEach(b => {
      if (!b) return;
      b.classList.toggle('on', bgmWanted);
      b.textContent = bgmWanted ? '🎵 音樂開' : '🎵 音樂關';
    });
  }

  if (btnBgmLobby) {
    btnBgmLobby.onclick = (ev) => {
      ev.stopPropagation();
      bgmWanted = !bgmWanted;
      if (bgmWanted) { initBGM(); if (ytPlayer && ytPlayer.playVideo) ytPlayer.playVideo(); }
      else { if (ytPlayer && ytPlayer.pauseVideo) ytPlayer.pauseVideo(); if (localBgm) localBgm.pause(); }
      syncBgmBtns();
    };
  }
  syncBgmBtns();

  if (btnBgm) {
    btnBgm.onclick = () => {
      bgmWanted = !bgmWanted;
      localStorage.setItem(BGM_KEY, bgmWanted ? 'on' : 'off');
      btnBgm.classList.toggle('on', bgmWanted);
      if (localBgm) { bgmWanted ? localBgm.play().catch(() => {}) : localBgm.pause(); return; }
      if (!ytPlayer) { if (bgmWanted) initBGM(); return; }
      try { bgmWanted ? ytPlayer.playVideo() : ytPlayer.pauseVideo(); } catch (e) { /* ignore */ }
    };
  }
  window.__bgm = () => (ytPlayer ? { state: ytPlayer.getPlayerState(), vol: ytPlayer.getVolume(), t: ytPlayer.getCurrentTime() } : null);

  const btnLog = document.querySelector('#btnLog');
  if (btnLog) {
    btnLog.onclick = () => {
      const log = document.querySelector('#log');
      log.classList.toggle('show');
      btnLog.classList.toggle('on');
    };
  }

  const btnSound = document.querySelector('#btnSound');
  const btnSpeed = document.querySelector('#btnSpeed');
  btnSound.onclick = () => {
    AUDIO.setMuted(!AUDIO.muted);
    if (VOICE) VOICE.setMuted(AUDIO.muted);
    btnSound.textContent = AUDIO.muted ? '🔇 音效關' : '🔊 音效開';
  };
  btnSpeed.onclick = () => {
    speedIdx = (speedIdx + 1) % SPEEDS.length;
    cfg.speed = SPEEDS[speedIdx].v;
    btnSpeed.textContent = '速度：' + SPEEDS[speedIdx].label;
    toast('AI 速度：' + SPEEDS[speedIdx].label + '（下一局生效）');
  };
  loadCustom();
  bindEditor();
  buildLobby();
  $('#btnStart').onclick = () => beginPick();
  $('#btnAgain').onclick = () => {
    $('#result').classList.add('hidden');
    $('#table').classList.add('hidden');
    $('#lobby').classList.remove('hidden');
    game = null; pending = null; pickState = null;
    buildLobby();
  };

  // 測試鉤子
  window.__sgsUI = {
    cfg, get game() { return game; }, get pending() { return pending; },
    startGame: () => { beginPick(); },
    answerWithAI: () => {
      if (!pending) return Promise.resolve(false);
      const ai = new AI.AIController();
      const r = ai.respond(game, pending.p, pending.req);
      return Promise.resolve(r).then((v) => { resolvePending(v); return true; });
    },
    clickCard: (id) => {
      const me = viewerPlayer();
      const c = me.hand.find(x => x.id === id);
      if (c) onCardClick(c, false);
      return !!c;
    },
    render,
    pickFirst: () => {
      if (!pickState) return;
      pickState.picked = pickState.cands.slice(0, pickState.need);
      startGame();
    },
  };
})();
