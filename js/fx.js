/* 三國殺 · 特效層（Canvas，疊在桌面棋盤上；全部自己畫，不用外部素材） */
(function (root) {
  'use strict';

  const FX = {
    canvas: null,
    ctx: null,
    board: null,
    W: 0, H: 0,
    parts: [],
    texts: [],
    slashes: [],
    rings: [],
    shakeAmt: 0,
    running: false,

    init(canvas, board) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.board = board;
      this.resize();
      window.addEventListener('resize', () => this.resize());
      // 版面變動（開局、視窗縮放、切換模式）時自動校正
      if (window.ResizeObserver) {
        try { new ResizeObserver(() => this.resize()).observe(this.board); } catch (e) { /* ignore */ }
      }
      this.start();
    },

    resize() {
      if (!this.canvas || !this.board) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const r = this.board.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return;   // 版面還沒出現
      if (Math.abs(r.width - this.W) < 1 && Math.abs(r.height - this.H) < 1) return;
      this.W = r.width; this.H = r.height;
      this.canvas.width = Math.round(this.W * dpr);
      this.canvas.height = Math.round(this.H * dpr);
      this.canvas.style.width = this.W + 'px';
      this.canvas.style.height = this.H + 'px';
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    },

    start() {
      if (this.running) return;
      this.running = true;
      const loop = () => {
        this.step();
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    },

    /* ---------------- 基本特效 ---------------- */
    burst(x, y, color, n, spd) {
      n = n || 18; spd = spd || 260;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = spd * (0.25 + Math.random() * 0.9);
        this.parts.push({
          x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
          life: 0.45 + Math.random() * 0.5, max: 0.95,
          size: 1.5 + Math.random() * 3.4, color, g: 240,
        });
      }
      if (this.parts.length > 900) this.parts.splice(0, this.parts.length - 900);
    },

    slash(x, y, color, ang) {
      this.slashes.push({
        x, y, color: color || '#ffd9a0', ang: ang == null ? Math.random() * Math.PI * 2 : ang,
        life: 0.34, max: 0.34, len: 96,
      });
    },

    ring(x, y, color, r0, r1) {
      this.rings.push({ x, y, color, r: r0 || 8, r1: r1 || 90, life: 0.5, max: 0.5 });
    },

    text(x, y, str, color, size) {
      this.texts.push({ x, y, str, color: color || '#fff', size: size || 20, life: 1.0, max: 1.0 });
    },

    shake(amt) {
      this.shakeAmt = Math.max(this.shakeAmt, amt || 6);
    },

    /* 飛牌：從 A 點飛到 B 點 */
    fly(from, to, label, color) {
      this.parts.push({
        fly: true, x: from.x, y: from.y, sx: from.x, sy: from.y, tx: to.x, ty: to.y,
        t: 0, dur: 0.42, life: 0.42, max: 0.42, label: label || '', color: color || '#e8e2d4',
      });
    },

    /* ---------------- 每幀 ---------------- */
    step() {
      const ctx = this.ctx;
      if (!ctx) return;
      ctx.clearRect(0, 0, this.W, this.H);

      // 震動（作用在棋盤容器上，比整頁抖更穩）
      if (this.board) {
        if (this.shakeAmt > 0.3) {
          const a = this.shakeAmt;
          this.board.style.transform = `translate(${(Math.random() - 0.5) * a}px, ${(Math.random() - 0.5) * a}px)`;
          this.shakeAmt *= 0.86;
        } else if (this.shakeAmt !== 0) {
          this.shakeAmt = 0;
          this.board.style.transform = '';
        }
      }

      const dt = 1 / 60;

      // 粒子 / 飛牌
      for (let i = this.parts.length - 1; i >= 0; i--) {
        const p = this.parts[i];
        p.life -= dt;
        if (p.life <= 0) { this.parts.splice(i, 1); continue; }
        if (p.fly) {
          p.t += dt;
          const k = Math.min(1, p.t / p.dur);
          const e = 1 - Math.pow(1 - k, 3);
          p.x = p.sx + (p.tx - p.sx) * e;
          p.y = p.sy + (p.ty - p.sy) * e - Math.sin(k * Math.PI) * 60;
        } else {
          p.vy += (p.g || 0) * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vx *= 0.97; p.vy *= 0.97;
        }
      }

      // 刀光
      for (let i = this.slashes.length - 1; i >= 0; i--) {
        const s = this.slashes[i];
        s.life -= dt;
        if (s.life <= 0) { this.slashes.splice(i, 1); continue; }
        const k = 1 - s.life / s.max;
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(s.ang);
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 7 * (1 - k) + 1;
        ctx.shadowColor = s.color;
        ctx.shadowBlur = 24;
        ctx.beginPath();
        const r = s.len * (0.55 + k * 0.6);
        ctx.arc(0, 0, r, -0.9 + k * 0.5, 0.75 + k * 0.5);
        ctx.stroke();
        ctx.restore();
      }

      // 光環
      for (let i = this.rings.length - 1; i >= 0; i--) {
        const r = this.rings[i];
        r.life -= dt;
        if (r.life <= 0) { this.rings.splice(i, 1); continue; }
        const k = 1 - r.life / r.max;
        ctx.save();
        ctx.globalAlpha = (1 - k) * 0.9;
        ctx.strokeStyle = r.color;
        ctx.lineWidth = 4 * (1 - k) + 0.6;
        ctx.shadowColor = r.color; ctx.shadowBlur = 18;
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.r + (r.r1 - r.r) * k, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // 粒子
      ctx.globalCompositeOperation = 'lighter';
      for (const p of this.parts) {
        const a = Math.max(0, p.life / p.max);
        if (p.fly) {
          ctx.globalAlpha = Math.min(1, p.life * 3);
          ctx.fillStyle = 'rgba(24,28,38,.95)';
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 1.4;
          const w = 34, h = 48;
          ctx.beginPath();
          ctx.roundRect ? ctx.roundRect(p.x - w / 2, p.y - h / 2, w, h, 6)
            : ctx.rect(p.x - w / 2, p.y - h / 2, w, h);
          ctx.fill(); ctx.stroke();
          ctx.fillStyle = p.color;
          ctx.font = '700 12px "PingFang TC",sans-serif';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(p.label, p.x, p.y);
          ctx.globalAlpha = 1;
          continue;
        }
        ctx.globalAlpha = a * 0.95;
        ctx.fillStyle = p.color;
        const s = p.size * (0.35 + a * 0.9);
        ctx.beginPath();
        ctx.arc(p.x, p.y, s, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;

      // 浮動文字
      for (let i = this.texts.length - 1; i >= 0; i--) {
        const t = this.texts[i];
        t.life -= dt;
        t.y -= 30 * dt;
        if (t.life <= 0) { this.texts.splice(i, 1); continue; }
        ctx.save();
        ctx.globalAlpha = Math.min(1, t.life * 1.6);
        ctx.font = `800 ${t.size}px "PingFang TC","Helvetica Neue",sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = t.color;
        ctx.shadowColor = t.color; ctx.shadowBlur = 16;
        ctx.fillText(t.str, t.x, t.y);
        ctx.restore();
      }
    },
  };

  root.SGS_FX = FX;
})(typeof window !== 'undefined' ? window : globalThis);
