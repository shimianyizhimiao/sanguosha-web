/* 三國殺 · 連線層（PeerJS / WebRTC）
   房主開一個 Peer，房號就是 peer id 的後綴；客人用同一組房號連進來。
   只有「房主」跑引擎，客人送決策、收狀態快照。 */
window.SGS_NET = (function () {
  'use strict';
  const PREFIX = 'sgs3-';
  const listeners = {};
  const on = (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); };
  const emit = (t, d) => (listeners[t] || []).forEach((f) => { try { f(d); } catch (e) { console.error(e); } });

  let peer = null;
  let isHost = false;
  let code = null;
  let hostConn = null;          // 客人端：連到房主的連線
  const conns = [];             // 房主端：所有客人的連線

  const available = () => typeof window.Peer === 'function';
  const ready = () => (typeof location === 'object' && /(^|\.)github\.io$/.test(location.hostname || '')) || true; // 佔位：兩邊都需要連外

  function makeCode() {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 4; i++) s += abc[Math.floor(Math.random() * abc.length)];
    return s;
  }

  /* ---------------- 房主 ---------------- */
  function host() {
    return new Promise((resolve, reject) => {
      if (!available()) return reject(new Error('連線模組沒載入（CDN 被擋？）'));
      if (peer) destroy();
      const c = makeCode();
      peer = new window.Peer(PREFIX + c, { debug: 0 });
      let opened = false;
      const fail = (err) => {
        if (!opened) { opened = true; reject(new Error(friendly(err))); }
        else emit('error', err);
      };
      peer.on('open', () => {
        opened = true;
        isHost = true; code = c;
        emit('room', { code: c });
        resolve(c);
      });
      peer.on('error', fail);
      peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) {} });
      peer.on('connection', (conn) => {
        conn.on('open', () => {
          conns.push(conn);
          emit('guest', conn);
        });
        conn.on('data', (msg) => emit('data', { conn, msg }));
        conn.on('close', () => {
          const i = conns.indexOf(conn);
          if (i >= 0) conns.splice(i, 1);
          emit('guestLeave', conn);
        });
      });
    });
  }

  /* ---------------- 客人 ---------------- */
  function join(roomCode) {
    return new Promise((resolve, reject) => {
      if (!available()) return reject(new Error('連線模組沒載入（CDN 被擋？）'));
      if (peer) destroy();
      const target = PREFIX + String(roomCode || '').trim().toUpperCase();
      peer = new window.Peer(undefined, { debug: 0 });
      let opened = false;
      peer.on('error', (err) => {
        if (!opened) { opened = true; reject(new Error(friendly(err))); }
        else emit('error', err);
      });
      peer.on('open', () => {
        const conn = peer.connect(target, { reliable: true });
        const timer = setTimeout(() => { if (!opened) { opened = true; reject(new Error('連不上房間（房號錯或房主已離線）')); } }, 12000);
        conn.on('open', () => {
          clearTimeout(timer);
          opened = true; hostConn = conn; code = roomCode;
          conn.on('data', (msg) => emit('data', { conn: null, msg }));
          conn.on('close', () => emit('closed'));
          emit('joined', { code: roomCode });
          resolve();
        });
        conn.on('error', () => {
          clearTimeout(timer);
          if (!opened) { opened = true; reject(new Error('連線失敗')); }
        });
      });
    });
  }

  function friendly(err) {
    const t = (err && err.type) || '';
    if (t === 'unavailable-id') return '這個房號已被使用，請再開一次';
    if (t === 'peer-unavailable') return '找不到這個房間（房號打錯，或房主已關掉頁面）';
    if (t === 'network' || t === 'server-error') return '連不上配對伺服器（可能被網路擋住）';
    if (t === 'browser-incompatible') return '這個瀏覽器不支援 WebRTC';
    return (err && err.message) || '連線錯誤';
  }

  const send = (conn, msg) => { try { conn.send(msg); return true; } catch (e) { return false; } };
  const broadcast = (msg) => conns.forEach((c) => send(c, msg));
  const sendHost = (msg) => (hostConn ? send(hostConn, msg) : false);

  function destroy() {
    try { conns.forEach((c) => c.close()); } catch (e) {}
    conns.length = 0;
    try { if (hostConn) hostConn.close(); } catch (e) {}
    hostConn = null;
    try { if (peer) peer.destroy(); } catch (e) {}
    peer = null; isHost = false; code = null;
  }

  return {
    available, host, join, on, send, broadcast, sendHost, destroy,
    get isHost() { return isHost; },
    get code() { return code; },
    get conns() { return conns; },
    get hostConn() { return hostConn; },
    emit,
  };
})();
