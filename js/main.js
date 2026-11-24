(() => {
  'use strict';

  // ---- 定数 ----
  const VIEW_W = 320;
  const VIEW_H = 176;
  const TILE = 16;
  const COLS = 80;
  const ROWS = 11;
  const STEP = 1 / 60;

  const MAX_SPEED = 95;
  const ACCEL = 650;
  const AIR_ACCEL = 420;
  const FRICTION = 750;
  const GRAVITY = 900;
  const MAX_FALL = 360;
  const JUMP_V = 300;
  const COYOTE = 0.1;
  const JUMP_BUFFER = 0.12;

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const ui = {
    coins: document.getElementById('coins'),
    coinsTotal: document.getElementById('coinsTotal'),
    time: document.getElementById('time'),
    message: document.getElementById('message'),
  };

  // ---- ステージ ----
  // '#' 地面, '=' レンガ, 'o' コイン, 'F' ゴール
  function buildLevel() {
    const g = Array.from({ length: ROWS }, () => Array(COLS).fill('.'));
    const set = (c, r, ch) => { g[r][c] = ch; };
    const span = (c1, c2, r, ch) => { for (let c = c1; c <= c2; c++) set(c, r, ch); };

    const gaps = [[18, 20], [41, 43], [60, 61]];
    for (let c = 0; c < COLS; c++) {
      if (gaps.some(([a, b]) => c >= a && c <= b)) continue;
      set(c, 9, '#');
      set(c, 10, '#');
    }
    const platforms = [
      [8, 11, 6], [24, 28, 5], [33, 35, 7], [37, 39, 4],
      [47, 52, 6], [64, 67, 6], [70, 72, 3],
    ];
    for (const [a, b, r] of platforms) {
      span(a, b, r, '=');
      span(a, b, r - 1, 'o');
    }
    // 階段
    set(55, 8, '=');
    set(56, 8, '='); set(56, 7, '=');
    set(57, 8, '='); set(57, 7, '='); set(57, 6, '=');
    // 穴の上のコイン
    for (const [a, b] of gaps) span(a, b, 6, 'o');
    set(77, 8, 'F');
    return g;
  }

  // ---- 入力 ----
  const input = { left: false, right: false, jump: false };
  let jumpBuffer = 0;

  const KEYMAP = {
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    Space: 'jump', ArrowUp: 'jump', KeyW: 'jump', KeyZ: 'jump',
  };

  function press(action, down) {
    if (action === 'jump' && down && !input.jump) jumpBuffer = JUMP_BUFFER;
    input[action] = down;
  }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyR') { reset(); return; }
    const action = KEYMAP[e.code];
    if (!action) return;
    e.preventDefault();
    if (state.won && action === 'jump' && !e.repeat) { reset(); return; }
    press(action, true);
  });
  window.addEventListener('keyup', (e) => {
    const action = KEYMAP[e.code];
    if (action) press(action, false);
  });
  window.addEventListener('blur', () => {
    input.left = input.right = input.jump = false;
  });

  document.querySelectorAll('[data-key]').forEach((btn) => {
    const action = btn.dataset.key;
    const on = (e) => {
      e.preventDefault();
      btn.setPointerCapture?.(e.pointerId);
      btn.classList.add('active');
      if (state.won && action === 'jump') { reset(); return; }
      press(action, true);
    };
    const off = () => { btn.classList.remove('active'); press(action, false); };
    btn.addEventListener('pointerdown', on);
    btn.addEventListener('pointerup', off);
    btn.addEventListener('pointercancel', off);
    btn.addEventListener('lostpointercapture', off);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  });

  // ---- 状態 ----
  let state;

  function reset() {
    const level = buildLevel();
    const coins = [];
    let flag = null;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (level[r][c] === 'o') { coins.push({ x: c * TILE + 8, y: r * TILE + 8, taken: false }); level[r][c] = '.'; }
        if (level[r][c] === 'F') { flag = { x: c * TILE + 7, top: 2 * TILE, bottom: 9 * TILE }; level[r][c] = '.'; }
      }
    }
    state = {
      level, coins, flag,
      player: makePlayer(),
      camX: 0,
      time: 0,
      won: false,
      particles: [],
      score: 0,
    };
    ui.coinsTotal.textContent = coins.length;
    ui.coins.textContent = 0;
    ui.message.classList.add('hidden');
  }

  function makePlayer() {
    return {
      x: 2 * TILE, y: 9 * TILE - 15, w: 10, h: 15,
      vx: 0, vy: 0, facing: 1,
      onGround: false, coyote: 0,
      walkDist: 0, blinkTimer: 2,
    };
  }

  function solidAt(px, py) {
    const c = Math.floor(px / TILE);
    const r = Math.floor(py / TILE);
    if (c < 0 || c >= COLS) return true; // 左右の端は壁
    if (r < 0 || r >= ROWS) return false;
    const t = state.level[r][c];
    return t === '#' || t === '=';
  }

  function overlapsSolid(x, y, w, h) {
    const c1 = Math.floor(x / TILE), c2 = Math.floor((x + w - 0.001) / TILE);
    const r1 = Math.floor(y / TILE), r2 = Math.floor((y + h - 0.001) / TILE);
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) {
        if (solidAt(c * TILE + 1, r * TILE + 1)) return { c, r };
      }
    }
    return null;
  }

  function dust(x, y, n) {
    for (let i = 0; i < n; i++) {
      state.particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 60,
        vy: -Math.random() * 40,
        life: 0.3 + Math.random() * 0.2,
        color: '#e8dcc0',
      });
    }
  }

  function sparkle(x, y) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      state.particles.push({
        x, y, vx: Math.cos(a) * 50, vy: Math.sin(a) * 50,
        life: 0.35, color: '#ffe680',
      });
    }
  }

  // ---- 更新 ----
  function update(dt) {
    const p = state.player;
    if (!state.won) state.time += dt;

    // 横移動
    const dir = state.won ? 0 : (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (dir !== 0) {
      p.facing = dir;
      p.vx += dir * (p.onGround ? ACCEL : AIR_ACCEL) * dt;
      p.vx = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, p.vx));
    } else if (p.onGround) {
      const f = FRICTION * dt;
      p.vx = Math.abs(p.vx) <= f ? 0 : p.vx - Math.sign(p.vx) * f;
    }

    // ジャンプ（コヨーテタイム＋先行入力）
    p.coyote = p.onGround ? COYOTE : Math.max(0, p.coyote - dt);
    jumpBuffer = Math.max(0, jumpBuffer - dt);
    if (jumpBuffer > 0 && p.coyote > 0 && !state.won) {
      p.vy = -JUMP_V;
      p.coyote = 0;
      jumpBuffer = 0;
      p.onGround = false;
      dust(p.x + p.w / 2, p.y + p.h, 4);
    }
    // ボタンを早く離すと低いジャンプ
    if (!input.jump && p.vy < -110) p.vy = -110;

    p.vy = Math.min(MAX_FALL, p.vy + GRAVITY * dt);

    // X方向の衝突
    p.x += p.vx * dt;
    let hit = overlapsSolid(p.x, p.y, p.w, p.h);
    if (hit) {
      if (p.vx > 0) p.x = hit.c * TILE - p.w;
      else if (p.vx < 0) p.x = (hit.c + 1) * TILE;
      p.vx = 0;
    }

    // Y方向の衝突
    const wasOnGround = p.onGround;
    const fallSpeed = p.vy;
    p.y += p.vy * dt;
    p.onGround = false;
    hit = overlapsSolid(p.x, p.y, p.w, p.h);
    if (hit) {
      if (p.vy > 0) {
        p.y = hit.r * TILE - p.h;
        p.onGround = true;
        if (!wasOnGround && fallSpeed > 150) dust(p.x + p.w / 2, p.y + p.h, 6);
      } else if (p.vy < 0) {
        p.y = (hit.r + 1) * TILE;
      }
      p.vy = 0;
    }

    // 落下したらスタート位置へ
    if (p.y > VIEW_H + 40) {
      const prev = state.player;
      state.player = makePlayer();
      state.player.facing = prev.facing;
    }

    // アニメーション用
    if (p.onGround) p.walkDist += Math.abs(p.vx) * dt;
    p.blinkTimer -= dt;
    if (p.blinkTimer < -0.12) p.blinkTimer = 2 + Math.random() * 2;

    // コイン
    for (const coin of state.coins) {
      if (coin.taken) continue;
      if (coin.x > p.x - 4 && coin.x < p.x + p.w + 4 && coin.y > p.y - 4 && coin.y < p.y + p.h + 4) {
        coin.taken = true;
        state.score++;
        ui.coins.textContent = state.score;
        sparkle(coin.x, coin.y);
      }
    }

    // ゴール
    if (!state.won && p.x + p.w >= state.flag.x) {
      state.won = true;
      const all = state.score === state.coins.length;
      ui.message.innerHTML =
        `GOAL!<span>コイン ${state.score} / ${state.coins.length}${all ? ' ★パーフェクト★' : ''}</span>` +
        `<small>タイム ${state.time.toFixed(1)}秒 ・ ジャンプ / R でもう一度</small>`;
      ui.message.classList.remove('hidden');
    }

    // パーティクル
    for (const pt of state.particles) {
      pt.life -= dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vy += 200 * dt;
    }
    state.particles = state.particles.filter((pt) => pt.life > 0);

    // カメラ（なめらかに追従）
    const target = Math.max(0, Math.min(COLS * TILE - VIEW_W, p.x + p.w / 2 - VIEW_W / 2 + p.facing * 24));
    state.camX += (target - state.camX) * Math.min(1, dt * 6);

    ui.time.textContent = state.time.toFixed(1);
  }

  // ---- 描画 ----
  const CLOUD = [
    '....WWWW......',
    '..WWWWWWWW.WW.',
    '.WWWWWWWWWWWWW',
    'WWWWWWWWWWWWWW',
    '.LLLLLLLLLLLL.',
  ];

  function drawCloud(x, y) {
    CLOUD.forEach((row, ry) => [...row].forEach((ch, rx) => {
      if (ch === '.') return;
      ctx.fillStyle = ch === 'W' ? '#ffffff' : '#d6e6ff';
      ctx.fillRect(x + rx * 2, y + ry * 2, 2, 2);
    }));
  }

  function drawBackground() {
    // 空（段階的なグラデーション）
    const bands = ['#5aa8ff', '#6db4ff', '#82c0ff', '#99ccff', '#b3dbff'];
    const bh = Math.ceil(VIEW_H / bands.length);
    bands.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(0, i * bh, VIEW_W, bh); });

    // 雲（ゆっくり）
    const cw = 480;
    for (let i = 0; i < 5; i++) {
      const x = ((i * 110 - state.camX * 0.15) % cw + cw) % cw - 40;
      drawCloud(Math.round(x), 14 + (i % 3) * 14);
    }

    // 遠くの山
    ctx.fillStyle = '#7fb0e8';
    for (let x = 0; x < VIEW_W; x += 2) {
      const wx = x + state.camX * 0.25;
      const h = 46 + Math.round(Math.sin(wx / 37) * 14 + Math.sin(wx / 13) * 4);
      ctx.fillRect(x, VIEW_H - h - 20, 2, h + 20);
    }
    // 近くの丘
    ctx.fillStyle = '#5c9e5a';
    for (let x = 0; x < VIEW_W; x += 2) {
      const wx = x + state.camX * 0.5;
      const h = 34 + Math.round(Math.sin(wx / 29) * 8);
      ctx.fillRect(x, VIEW_H - h, 2, h);
    }
  }

  function drawTile(t, c, r, sx, sy) {
    if (t === '#') {
      const above = r > 0 ? state.level[r - 1][c] : '.';
      ctx.fillStyle = '#8b5a2b';
      ctx.fillRect(sx, sy, TILE, TILE);
      ctx.fillStyle = '#6e4420';
      for (let i = 0; i < 4; i++) {
        const px = (c * 7 + r * 13 + i * 5) % 14;
        const py = (c * 3 + r * 11 + i * 7) % 14;
        ctx.fillRect(sx + px, sy + py, 2, 2);
      }
      if (above !== '#' && above !== '=') {
        ctx.fillStyle = '#4caf50';
        ctx.fillRect(sx, sy, TILE, 5);
        ctx.fillStyle = '#7ddc6f';
        ctx.fillRect(sx, sy, TILE, 1);
        ctx.fillStyle = '#4caf50';
        ctx.fillRect(sx + ((c * 5) % 12), sy + 5, 2, 2);
      }
    } else if (t === '=') {
      ctx.fillStyle = '#c26a3a';
      ctx.fillRect(sx, sy, TILE, TILE);
      ctx.fillStyle = '#e8925c';
      ctx.fillRect(sx, sy, TILE, 1);
      ctx.fillStyle = '#7a3a1c';
      ctx.fillRect(sx, sy + 7, TILE, 1);
      ctx.fillRect(sx, sy + 15, TILE, 1);
      ctx.fillRect(sx + 7, sy, 1, 7);
      ctx.fillRect(sx + 3, sy + 8, 1, 7);
      ctx.fillRect(sx + 11, sy + 8, 1, 7);
    }
  }

  function drawLevel(cam) {
    const c1 = Math.floor(cam / TILE);
    const c2 = Math.min(COLS - 1, c1 + Math.ceil(VIEW_W / TILE) + 1);
    for (let r = 0; r < ROWS; r++) {
      for (let c = c1; c <= c2; c++) {
        const t = state.level[r][c];
        if (t !== '.') drawTile(t, c, r, c * TILE - cam, r * TILE);
      }
    }
  }

  function drawCoins(cam) {
    const widths = [6, 4, 2, 4];
    state.coins.forEach((coin, i) => {
      if (coin.taken) return;
      const w = widths[Math.floor(state.time * 8 + i) % 4];
      const bob = Math.round(Math.sin(state.time * 3 + i) * 1.5);
      const x = Math.round(coin.x - cam - w / 2);
      const y = coin.y - 4 + bob;
      ctx.fillStyle = '#b8860b';
      ctx.fillRect(x - 1, y, w + 2, 8);
      ctx.fillRect(x, y - 1, w, 10);
      ctx.fillStyle = '#ffd23f';
      ctx.fillRect(x, y, w, 8);
      if (w > 2) { ctx.fillStyle = '#fff3b0'; ctx.fillRect(x + 1, y + 1, 1, 3); }
    });
  }

  function drawFlag(cam) {
    const f = state.flag;
    const x = Math.round(f.x - cam);
    ctx.fillStyle = '#e0e0e0';
    ctx.fillRect(x, f.top, 2, f.bottom - f.top);
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(x - 1, f.top - 3, 4, 4);
    const wave = Math.floor(state.time * 6) % 2;
    ctx.fillStyle = state.won ? '#ffd23f' : '#e43b44';
    for (let i = 0; i < 10; i++) {
      const h = 12 - Math.floor(i * 1.1);
      ctx.fillRect(x + 2 + i, f.top + 2 + Math.floor(i / 2) + ((i + wave) % 2), 1, Math.max(1, h - i));
    }
    ctx.fillStyle = '#8b5a2b';
    ctx.fillRect(x - 3, f.bottom - 4, 8, 4);
  }

  function pickFrame(p) {
    if (state.won) return Math.floor(state.time * 4) % 2 ? 'jump' : 'idle';
    if (!p.onGround) return 'jump';
    if (Math.abs(p.vx) > 5) {
      const cycle = ['walk1', 'walk2', 'walk1', 'walk2'];
      return cycle[Math.floor(p.walkDist / 7) % 4];
    }
    return p.blinkTimer < 0 ? 'blink' : 'idle';
  }

  function drawPlayer(cam) {
    const p = state.player;
    const sprite = SPRITES[pickFrame(p)];
    const img = p.facing > 0 ? sprite.right : sprite.left;
    const x = Math.round(p.x - 1 - cam);
    const y = Math.round(p.y - 1);
    // 影
    if (p.onGround) {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(x + 2, y + sprite.h - 1, sprite.w - 4, 2);
    }
    ctx.drawImage(img, x, y);
  }

  function drawParticles(cam) {
    for (const pt of state.particles) {
      ctx.fillStyle = pt.color;
      ctx.fillRect(Math.round(pt.x - cam), Math.round(pt.y), 2, 2);
    }
  }

  function render() {
    const cam = Math.round(state.camX);
    drawBackground();
    drawLevel(cam);
    drawFlag(cam);
    drawCoins(cam);
    drawPlayer(cam);
    drawParticles(cam);
  }

  // ---- ループ ----
  let last = performance.now();
  let acc = 0;
  function frame(now) {
    acc += Math.min(0.25, (now - last) / 1000);
    last = now;
    while (acc >= STEP) {
      update(STEP);
      acc -= STEP;
    }
    render();
    requestAnimationFrame(frame);
  }

  reset();
  requestAnimationFrame(frame);
})();
