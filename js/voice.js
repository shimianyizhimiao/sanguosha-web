/* 三國殺 · 角色語音
   語音檔在 assets/voice/<武將名>/<key>.mp3（本機自用；抓取工具 tools/fetch-voice.py）
   key：1dead01=陣亡、1skill1_1=第一技能第 1 句、2skill1_1=第二技能…
   找不到檔案就靜音，不會報錯、不會擋遊戲。
*/
(function (root) {
  'use strict';

  const V = {
    muted: false,
    cache: {},        // url -> HTMLAudioElement
    miss: {},         // url -> true（404 記住，不再重試）
    last: 0,
    volume: 0.85,
    index: null,        // assets/voice/index.json：{武將名: [檔名…]}
    indexTried: false,

    base(n) { return String(n).replace(/^(界|神|SP)/, '').replace(/·.*$/, ''); },

    candidates(name, key) {
      const b = this.base(name);
      const list = [];
      if (b !== name) list.push('assets/voice/' + name + '/' + key + '.mp3');
      list.push('assets/voice/' + b + '/' + key + '.mp3');
      return list;
    },

    loadIndex() {
      if (this.indexTried) return;
      this.indexTried = true;
      // 公開版（GitHub Pages）沒有語音檔，直接當作沒有索引，避免一個 404 探測請求
      if (typeof location === 'object' && /(^|\.)github\.io$/.test(location.hostname || '')) { this.index = {}; return; }
      if (typeof fetch !== 'function') return;
      fetch('assets/voice/index.json').then(r => r.ok ? r.json() : null)
        .then(j => { this.index = j || {}; })
        .catch(() => { this.index = {}; });
    },

    /* 有索引就照索引挑檔（只請求真的存在的檔案），沒有就退回舊命名規則 */
    picks(name, kind, n) {
      this.loadIndex();
      if (!this.index) return [];      // 索引還沒到／線上版沒有索引：直接當作沒語音，不要亂猜檔名造成 404
      const files = this.index[name] || this.index[this.base(name)];
      if (!files) return [];
      if (kind === 'dead') return files.filter(f => /dead/.test(f)).sort();
      if (!/^skill\d$/.test(kind)) return [];
      const idx = kind.slice(5);
      const re = new RegExp('^(\\d)skill' + idx + '_(\\d)\\.mp3$');
      const hit = files.map(f => [f, re.exec(f)]).filter(x => x[1]);
      const want = String(n || 1);
      hit.sort((a, b) => {
        const [, ma] = a, [, mb] = b;
        const sc = m => (m[1] === '1' ? 0 : 10) + (m[2] === want ? 0 : m[2] === '1' ? 1 : 2);
        return sc(ma) - sc(mb);
      });
      return hit.map(x => x[0]);
    },

    get(url) {
      if (this.miss[url]) return null;
      if (this.cache[url]) return this.cache[url];
      const a = new Audio();
      a.preload = 'auto';
      a.src = url;
      a.volume = this.volume;
      a.addEventListener('error', () => { this.miss[url] = true; delete this.cache[url]; }, { once: true });
      this.cache[url] = a;
      return a;
    },

    /* kind: 'dead' | 'skill1' | 'skill2'…；句數預設第 1 句
       命名規則：{形象組}skill{技能編號}_{句號}，例如 1skill2_1 = 經典形象・第 2 個技能・第 1 句 */
    play(name, kind, n) {
      if (this.muted || !name) return false;
      const now = performance.now();
      if (now - this.last < 180) return false;      // 避免同時多句疊在一起
      const idxed = this.picks(name, kind, n);
      let keys;
      if (idxed && idxed.length) {
        for (const f of idxed) {
          const a = this.get('assets/voice/' + (this.index[name] ? name : this.base(name)) + '/' + f);
          if (!a) continue;
          try {
            a.currentTime = 0;
            const p2 = a.play();
            if (p2 && p2.catch) p2.catch(() => {});
            this.last = now;
            return true;
          } catch (e) { /* 下一條 */ }
        }
      }
      if (idxed) return false;        // 有索引且明確沒有這個檔，就不用再亂試
      if (kind === 'dead') keys = ['1dead01', '2dead01'];
      else if (/^skill\d$/.test(kind)) {
        const idx = parseInt(kind.slice(5), 10);
        keys = [];
        for (const line of [n || 1, 1, 2]) keys.push('1skill' + idx + '_' + line);
        for (const line of [n || 1, 1, 2]) keys.push('2skill' + idx + '_' + line);
      } else return false;
      for (const url of keys.flatMap(k => this.candidates(name, k))) {
        const a = this.get(url);
        if (!a) continue;
        try {
          a.currentTime = 0;
          const p = a.play();
          if (p && p.catch) p.catch(() => {});
          this.last = now;
          return true;
        } catch (e) { /* 下一條 */ }
      }
      return false;
    },

    /* 依武將技能清單決定是第幾個技能 */
    playSkill(generalName, skillName, skills) {
      const idx = (skills || []).indexOf(skillName);
      const which = idx >= 0 ? idx + 1 : 1;
      return this.play(generalName, 'skill' + which);
    },

    setMuted(m) {
      this.muted = m;
      if (m) for (const k of Object.keys(this.cache)) { try { this.cache[k].pause(); } catch (e) { /* ignore */ } }
    },

    /* 有沒有這隻武將的語音（給 UI 顯示用） */
    has(name) {
      return this.candidates(name, '0probe').some(u => !this.miss[u] && this.cache[u]);
    },
  };

  root.SGS_VOICE = V;
})(typeof window !== 'undefined' ? window : globalThis);
