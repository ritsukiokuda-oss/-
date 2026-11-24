(() => {
  'use strict';

  // ================= 基本設定 =================
  const T = 16, COLS = 20, ROWS = 11, W = 320, H = 176;
  const WALK = 4;            // 歩く速さ（マス / ゲーム内1分）
  const DAY_START = 8 * 60 + 20;
  const DAY_END = 19 * 60;
  const MEETINGS = [[10 * 60 + 30, 11 * 60], [15 * 60, 15 * 60 + 30]];
  const LUNCH = [12 * 60, 13 * 60];

  const canvas = document.getElementById('office');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const $ = (id) => document.getElementById(id);
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const key = (c, r) => `${c},${r}`;
  function px(x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), w, h);
  }

  // ================= マップ =================
  const blocked = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
  const block = (c, r) => { blocked[r][c] = true; };
  for (let c = 0; c < COLS; c++) { block(c, 0); if (c !== 5) block(c, 10); }
  for (let r = 0; r < ROWS; r++) { block(0, r); block(19, r); }

  const GLASS = [[11, 1], [11, 2], [11, 3], [11, 5]];
  for (let c = 12; c <= 18; c++) GLASS.push([c, 5]);
  GLASS.forEach(([c, r]) => block(c, r));

  const DOOR = { c: 5, r: 10, dir: 'down', label: '出入口' };

  // 机（左マスにモニター、その下が席）
  const DESKS = [];
  [2, 6].forEach((r) => [2, 5, 8].forEach((c) => {
    DESKS.push({ c, r });
    block(c, r); block(c + 1, r);
  }));

  const MEETING_TABLE = { c: 14, r: 2, w: 3, h: 2 };
  for (let c = 14; c <= 16; c++) for (let r = 2; r <= 3; r++) block(c, r);
  const MEETING_SEATS = [
    { c: 13, r: 2, dir: 'right' }, { c: 17, r: 2, dir: 'left' },
    { c: 13, r: 3, dir: 'right' }, { c: 17, r: 3, dir: 'left' },
    { c: 14, r: 1, dir: 'down' }, { c: 14, r: 4, dir: 'up' },
  ].map((s) => ({ ...s, chair: true, label: '会議室' }));

  for (let c = 16; c <= 18; c++) block(c, 6); // コーヒーカウンター
  const COFFEE_SPOTS = [16, 17, 18].map((c) => ({ c, r: 7, dir: 'up', label: 'コーヒー', shared: true }));

  block(14, 8); // 休憩テーブル
  const TABLE_SEATS = [
    { c: 13, r: 8, dir: 'right', chair: true, shared: true, label: '休憩スペース' },
    { c: 15, r: 8, dir: 'left', chair: true, shared: true, label: '休憩スペース' },
  ];

  block(10, 9); // コピー機
  const PRINTER_SPOT = { c: 10, r: 8, dir: 'down', label: 'コピー機', shared: true };

  const PLANTS = [[1, 1], [10, 1], [18, 9], [1, 9]];
  PLANTS.forEach(([c, r]) => block(c, r));

  // 自席の椅子のマスは「目的地のときだけ」通れる（会議室・休憩スペースの椅子は通り抜け可）
  const seatTiles = new Set(DESKS.map((d) => key(d.c, d.r + 1)));

  function walkable(c, r) {
    return c >= 0 && c < COLS && r >= 0 && r < ROWS && !blocked[r][c];
  }

  function findPath(from, to, avoid = null) {
    const goal = key(to.c, to.r);
    const prev = new Map([[key(from.c, from.r), null]]);
    const queue = [from];
    while (queue.length) {
      const cur = queue.shift();
      if (key(cur.c, cur.r) === goal) {
        const path = [];
        let k = goal;
        while (k && k !== key(from.c, from.r)) {
          const [c, r] = k.split(',').map(Number);
          path.unshift({ c, r });
          k = prev.get(k);
        }
        return path;
      }
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = { c: cur.c + dc, r: cur.r + dr };
        const nk = key(n.c, n.r);
        if (prev.has(nk) || !walkable(n.c, n.r)) continue;
        if (seatTiles.has(nk) && nk !== goal) continue;
        if (avoid && avoid.has(nk) && nk !== goal) continue;
        prev.set(nk, key(cur.c, cur.r));
        queue.push(n);
      }
    }
    return null;
  }

  // ================= 社員 =================
  const STAFF = [
    { name: '佐藤', role: '部長', hair: '#6b6b72', skin: '#f0bf94', shirt: '#2f3e5c', accent: '#c0392b', pants: '#25252f', style: 'short' },
    { name: '鈴木', role: 'エンジニア', hair: '#2a1a12', skin: '#f6c49a', shirt: '#3a7bd5', accent: '#9fd0ff', pants: '#3c3c5c', style: 'messy' },
    { name: '高橋', role: 'デザイナー', hair: '#c0662e', skin: '#f9d3b0', shirt: '#e07a9b', accent: '#ffd23f', pants: '#4a3a5a', style: 'long' },
    { name: '田中', role: '営業', hair: '#1b1b1b', skin: '#e8b07f', shirt: '#f2f2f2', accent: '#2e86de', pants: '#2b2b38', style: 'short' },
    { name: '伊藤', role: '経理', hair: '#4a2f22', skin: '#f6c49a', shirt: '#6ab04c', accent: '#ffffff', pants: '#5a4a3a', style: 'bob' },
    { name: '渡辺', role: '新人', hair: '#9a6a35', skin: '#f9d3b0', shirt: '#f0a030', accent: '#ffffff', pants: '#3c3c5c', style: 'messy' },
  ].map((s, i) => ({
    ...s,
    idx: i,
    desk: { c: DESKS[i].c, r: DESKS[i].r + 1, dir: 'up', chair: true, label: '自席' },
  }));

  const reservations = new Map();
  let clock = DAY_START;
  let day = 1;
  let speed = 3;
  let selected = null;
  let bannerTimer = 0;
  let animMs = 0; // アニメーション用の時計（一時停止中は止まる）

  function scheduleDay() {
    reservations.clear();
    STAFF.forEach((p, i) => {
      Object.assign(p, {
        present: false, state: 'before', mode: 'normal',
        arriveAt: 8 * 60 + 30 + rand(0, 40),
        leaveAt: i === 0 ? 18 * 60 + 20 + rand(0, 10) : 17 * 60 + 50 + rand(0, 30),
        lunchOut: Math.random() < 0.5,
        lunchEnd: LUNCH[1],
        x: DOOR.c * T + 8, y: DOOR.r * T + 13, c: DOOR.c, r: DOOR.r,
        dir: 'up', path: [], spot: null, nextState: null, nextTimer: 0,
        timer: 0, walkPx: 0, chatTarget: null, idea: 0, reserved: null,
      });
    });
  }

  function reserve(p, spot) {
    if (p.reserved) reservations.delete(p.reserved);
    p.reserved = null;
    if (spot && spot.shared) {
      p.reserved = key(spot.c, spot.r);
      reservations.set(p.reserved, p);
    }
  }
  function isFree(spot, p) {
    const owner = reservations.get(key(spot.c, spot.r));
    return !owner || owner === p;
  }
  function freeSpot(list, p) {
    const free = list.filter((s) => isFree(s, p));
    return free.length ? pick(free) : null;
  }

  function goTo(p, spot, state, timer, extra = {}) {
    reserve(p, spot);
    p.spot = spot;
    p.nextState = state;
    p.nextTimer = timer;
    p.chatTarget = extra.chatTarget || null;
    const from = { c: p.c, r: p.r };
    // 立ち止まっている他の人のマスはなるべく避ける
    const avoid = new Set(STAFF.filter((o) => o !== p && o.present && o.state !== 'walk').map((o) => key(o.c, o.r)));
    let path = findPath(from, spot, avoid) || findPath(from, spot);
    if (!path) {
      // 行けないときは到着扱いにせず、少し待ってから考え直す
      console.warn(`経路が見つかりません: ${p.name} (${p.c},${p.r}) → (${spot.c},${spot.r})`);
      reserve(p, null);
      p.path = [];
      p.state = 'wait';
      p.timer = 1;
      return;
    }
    // マスの途中にいて、新しい経路が向かっていたマスへ進まないなら、今のマスの中心に戻る
    const nextTile = p.path[0];
    const cx = p.c * T + 8, cy = p.r * T + 13;
    const continues = nextTile && path[0] && path[0].c === nextTile.c && path[0].r === nextTile.r;
    if ((p.x !== cx || p.y !== cy) && !continues) {
      path.unshift({ c: p.c, r: p.r });
    }
    p.path = path;
    p.state = 'walk';
    if (!p.path.length) arrive(p);
  }

  function arrive(p) {
    p.state = p.nextState;
    p.timer = p.nextTimer;
    if (p.spot) p.dir = p.spot.dir;
    if (p.state === 'gone' || p.state === 'out') {
      reserve(p, null);
      p.present = false;
    }
  }

  function modeFor(p) {
    if (clock >= p.leaveAt) return 'leave';
    if (MEETINGS.some(([a, b]) => clock >= a && clock < b)) return 'meeting';
    if (clock >= LUNCH[0] && clock < p.lunchEnd) return 'lunch';
    return 'normal';
  }

  // 今のモードに合わせて行き先を決める
  function decide(p) {
    switch (p.mode) {
      case 'leave':
        goTo(p, DOOR, 'gone', 0);
        break;
      case 'meeting':
        goTo(p, MEETING_SEATS[p.idx], 'meeting', Infinity);
        break;
      case 'lunch':
        if (p.lunchOut) goTo(p, DOOR, 'out', 0);
        else goTo(p, freeSpot(TABLE_SEATS, p) || p.desk, 'lunch', Infinity);
        break;
      default:
        goTo(p, p.desk, 'work', rand(15, 45));
    }
  }

  // 作業の合間にすること
  function pickActivity(p) {
    if (isChatting(p)) { p.timer = 1; return; } // 話しかけられている間は席を離れない
    const roll = Math.random();
    if (roll < 0.25) {
      const s = freeSpot(COFFEE_SPOTS, p);
      if (s) return goTo(p, s, 'coffee', rand(4, 8));
    } else if (roll < 0.45) {
      if (isFree(PRINTER_SPOT, p)) return goTo(p, PRINTER_SPOT, 'print', rand(2, 4));
    } else if (roll < 0.65) {
      const targets = STAFF.filter((o) => o !== p && o.present && o.state === 'work' && !isChatting(o) && o.leaveAt - clock > 15);
      if (targets.length) {
        const o = pick(targets);
        const s = { c: o.desk.c + 1, r: o.desk.r, dir: 'left', label: `${o.name}さんの席`, shared: true };
        if (isFree(s, p)) return goTo(p, s, 'chat', rand(5, 10), { chatTarget: o });
      }
    }
    p.timer = rand(15, 40);
    if (Math.random() < 0.3) p.idea = 2;
  }

  function isChatting(o) {
    return STAFF.some((p) => p.present && p.chatTarget === o && (p.state === 'chat' || p.nextState === 'chat'));
  }

  function enter(p) {
    p.present = true;
    p.c = DOOR.c; p.r = DOOR.r;
    p.x = DOOR.c * T + 8; p.y = DOOR.r * T + 13;
    p.mode = modeFor(p);
    decide(p);
  }

  function stepMove(p, dist) {
    while (dist > 0 && p.path.length) {
      const t = p.path[0];
      const tx = t.c * T + 8, ty = t.r * T + 13;
      const dx = tx - p.x, dy = ty - p.y;
      if (dx > 0) p.dir = 'right'; else if (dx < 0) p.dir = 'left';
      else if (dy < 0) p.dir = 'up'; else if (dy > 0) p.dir = 'down';
      const d = Math.abs(dx) + Math.abs(dy);
      if (d <= dist) {
        p.x = tx; p.y = ty; p.c = t.c; p.r = t.r;
        p.path.shift();
        dist -= d;
        p.walkPx += d;
      } else {
        p.x += Math.sign(dx) * dist;
        p.y += Math.sign(dy) * dist;
        p.walkPx += dist;
        dist = 0;
      }
    }
    if (!p.path.length) arrive(p);
  }

  function update(dt) {
    clock += dt;
    for (const p of STAFF) {
      if (!p.present) {
        if (p.state === 'before' && clock >= p.arriveAt && clock < p.leaveAt) enter(p);
        else if (p.state === 'out' && modeFor(p) !== 'lunch') enter(p);
        continue;
      }
      const m = modeFor(p);
      if (m !== p.mode) { p.mode = m; decide(p); }
      // 雑談相手が席にいなくなったら、話すのをやめて戻る
      if (p.state === 'chat' || (p.state === 'walk' && p.nextState === 'chat')) {
        const t = p.chatTarget;
        if (!t || !t.present || t.state !== 'work') decide(p);
      }
      if (p.idea > 0) p.idea -= dt;
      if (p.state === 'walk') {
        stepMove(p, WALK * T * dt);
      } else {
        p.timer -= dt;
        if (p.timer <= 0) {
          if (p.state === 'work') pickActivity(p);
          else if (['coffee', 'print', 'chat', 'wait'].includes(p.state)) decide(p);
        }
      }
    }
    if ((clock >= DAY_END || clock >= 17 * 60 + 50) && STAFF.every((p) => p.state === 'gone')) {
      day++;
      clock = DAY_START;
      scheduleDay();
      showBanner(`Day ${day}`);
    }
  }

  // ================= 描画 =================
  function skyColor() {
    const h = clock / 60;
    if (h < 8.7) return '#f3b38a';
    if (h < 16.5) return '#8fd0ff';
    if (h < 17.5) return '#ffb36b';
    if (h < 18.3) return '#c0607a';
    return '#2a2d5a';
  }

  function drawFloor() {
    for (let r = 1; r < 10; r++) {
      for (let c = 1; c < 19; c++) {
        const x = c * T, y = r * T;
        if (c >= 12 && r <= 4) {
          px(x, y, T, T, '#b98b5e');
          px(x, y + ((c % 2) ? 5 : 11), T, 1, '#a57a50');
        } else if (c >= 12 && r >= 6) {
          px(x, y, T, T, (c + r) % 2 ? '#e8e3d6' : '#d9d3c4');
        } else {
          px(x, y, T, T, '#c7c2b6');
          if ((c + r) % 2) px(x + 2, y + 2, T - 4, T - 4, '#cdc8bc');
        }
      }
    }
    // 出入口のマット
    px(DOOR.c * T + 2, 9 * T + 10, 12, 6, '#7a5a8a');
  }

  function drawWalls() {
    // 上の壁
    px(0, 0, W, T, '#5b6080');
    px(0, T - 3, W, 3, '#3e425c');
    // 窓
    const sky = skyColor();
    for (const c of [2, 3, 6, 7]) {
      px(c * T + 2, 2, 12, 10, '#e6e9f5');
      px(c * T + 3, 3, 10, 8, sky);
      px(c * T + 8, 3, 1, 8, '#e6e9f5');
      if (sky === '#2a2d5a') px(c * T + 5, 5, 1, 1, '#ffffff');
    }
    // 壁掛け時計
    const cx = 9 * T + 8, cy = 7;
    px(cx - 4, cy - 4, 9, 9, '#2b2b38');
    px(cx - 3, cy - 3, 7, 7, '#ffffff');
    const hour = ((clock / 60) % 12) / 12 * Math.PI * 2;
    const min = (clock % 60) / 60 * Math.PI * 2;
    px(cx + Math.round(Math.sin(min) * 3), cy - Math.round(Math.cos(min) * 3), 1, 1, '#c0392b');
    px(cx + Math.round(Math.sin(hour) * 2), cy - Math.round(Math.cos(hour) * 2), 1, 1, '#2b2b38');
    px(cx, cy, 1, 1, '#2b2b38');
    // ホワイトボード
    px(14 * T, 2, 44, 12, '#9aa0b8');
    px(14 * T + 1, 3, 42, 10, '#ffffff');
    px(14 * T + 4, 5, 14, 1, '#2e86de');
    px(14 * T + 4, 8, 20, 1, '#c0392b');
    px(14 * T + 28, 5, 8, 5, '#6ab04c');
    // 左右と下の壁
    px(0, T, T, H - T, '#4b4f6b');
    px(T - 2, T, 2, H - 2 * T, '#3e425c');
    px(19 * T, T, T, H - T, '#4b4f6b');
    px(19 * T, T, 2, H - 2 * T, '#3e425c');
    px(0, 10 * T, W, T, '#4b4f6b');
    px(0, 10 * T, W, 2, '#3e425c');
    // ドア
    px(DOOR.c * T, 10 * T, T, T, '#8b5a2b');
    px(DOOR.c * T + 1, 10 * T + 2, T - 2, T - 2, '#a8703a');
    px(DOOR.c * T + 11, 10 * T + 8, 2, 2, '#ffd23f');
  }

  function drawGlass() {
    const meeting = MEETINGS.some(([a, b]) => clock >= a && clock < b);
    for (const [c, r] of GLASS) {
      ctx.fillStyle = 'rgba(170, 215, 255, 0.55)';
      if (r === 5) {
        ctx.fillRect(c * T, r * T + 4, T, 8);
        px(c * T, r * T + 4, T, 1, '#e8f6ff');
        px(c * T, r * T + 11, T, 1, '#6f8fb0');
      } else {
        ctx.fillRect(c * T + 4, r * T, 8, T);
        px(c * T + 4, r * T, 1, T, '#e8f6ff');
        px(c * T + 11, r * T, 1, T, '#6f8fb0');
      }
    }
    // 会議中ランプ
    px(11 * T + 5, 1 * T + 1, 6, 4, '#2b2b38');
    px(11 * T + 6, 1 * T + 2, 4, 2, meeting ? '#ff4d4d' : '#55556e');
  }

  function isSeated(p, spot) {
    return p.present && p.state !== 'walk' && p.spot === spot;
  }

  function drawChair(x, y) {
    px(x - 5, y - 8, 10, 8, '#3b3b4f');
    px(x - 5, y - 8, 10, 2, '#55556e');
  }
  function drawChairBack(x, y) {
    px(x - 5, y - 6, 10, 6, '#3b3b4f');
    px(x - 5, y - 6, 10, 1, '#55556e');
  }

  function drawDesk(d, i) {
    const x = d.c * T, y = d.r * T;
    const owner = STAFF[i];
    px(x, y + 2, 32, 11, '#a8794e');
    px(x, y + 2, 32, 1, '#c99a6b');
    px(x, y + 12, 32, 3, '#7d5634');
    // モニター
    const working = owner.present && owner.state === 'work';
    px(x + 2, y - 3, 13, 9, '#2b2b38');
    px(x + 3, y - 2, 11, 7, working ? '#7ec8ff' : '#3d4660');
    if (working) {
      const line = Math.floor(animMs / 300 + i) % 4;
      px(x + 4, y - 1 + line, 6, 1, '#e6f6ff');
      px(x + 4, y + 3, 8, 1, '#4a9be0');
    }
    px(x + 7, y + 6, 3, 2, '#2b2b38');
    px(x + 4, y + 8, 10, 2, '#e0e0e8');
    // 書類とマグカップ
    px(x + 19, y + 4, 7, 8, '#ffffff');
    px(x + 20, y + 6, 5, 1, '#b0b0c0');
    px(x + 20, y + 8, 4, 1, '#b0b0c0');
    px(x + 27, y + 5, 3, 4, owner.accent === '#ffffff' ? owner.shirt : owner.accent);
  }

  function drawFurniture() {
    // 机の席の椅子（空席のとき）
    STAFF.forEach((p) => {
      if (!isSeated(p, p.desk)) drawChair(p.desk.c * T + 8, p.desk.r * T + 13);
    });
    DESKS.forEach(drawDesk);
    // 会議テーブル
    const mt = MEETING_TABLE;
    px(mt.c * T + 1, mt.r * T + 2, mt.w * T - 2, mt.h * T - 4, '#8a5a3a');
    px(mt.c * T + 1, mt.r * T + 2, mt.w * T - 2, 1, '#a8794e');
    px(mt.c * T + 6, mt.r * T + 8, 8, 6, '#2b2b38');
    px(mt.c * T + 30, mt.r * T + 14, 7, 9, '#ffffff');
    // コーヒーカウンター
    px(16 * T, 6 * T, 48, 13, '#d9d4c7');
    px(16 * T, 6 * T + 10, 48, 3, '#a39e90');
    px(17 * T + 3, 6 * T - 6, 10, 13, '#3a3a48');
    px(17 * T + 5, 6 * T - 4, 6, 3, '#6a6a80');
    px(17 * T + 11, 6 * T, 1, 1, '#ff4d4d');
    px(16 * T + 5, 6 * T + 4, 3, 3, '#ffffff');
    px(18 * T + 6, 6 * T + 4, 3, 3, '#e07a9b');
    // 休憩テーブル
    px(14 * T + 2, 8 * T + 2, 12, 11, '#ffffff');
    px(14 * T + 2, 8 * T + 11, 12, 2, '#c8c8d4');
    // コピー機
    const printing = STAFF.some((p) => p.present && p.state === 'print');
    px(10 * T + 1, 9 * T + 1, 14, 13, '#e0e0e8');
    px(10 * T + 1, 9 * T + 1, 14, 3, '#9a9aae');
    px(10 * T + 3, 9 * T + 6, 10, 2, '#5a5a70');
    px(10 * T + 12, 9 * T + 10, 2, 2, printing && Math.floor(animMs / 200) % 2 ? '#3dff6a' : '#2a7a3a');
    // 観葉植物
    for (const [c, r] of PLANTS) {
      const x = c * T, y = r * T;
      px(x + 5, y + 9, 6, 6, '#a0522d');
      px(x + 4, y + 2, 8, 7, '#3d8b40');
      px(x + 2, y + 4, 4, 4, '#4caf50');
      px(x + 10, y + 3, 4, 4, '#4caf50');
      px(x + 7, y, 3, 4, '#5fcf62');
    }
    // 空いている会議・休憩の椅子
    [...MEETING_SEATS, ...TABLE_SEATS].forEach((s) => {
      if (!STAFF.some((p) => isSeated(p, s))) drawChair(s.c * T + 8, s.r * T + 13);
    });
  }

  function drawPerson(p) {
    const x = Math.round(p.x), y = Math.round(p.y);
    const seated = p.state !== 'walk' && p.spot && p.spot.chair;
    const walking = p.state === 'walk';
    const step = walking ? Math.floor(p.walkPx / 4) % 2 : 0;
    const typing = p.state === 'work' && Math.floor(animMs / 160 + p.idx) % 2;

    if (seated && p.dir !== 'up') drawChair(x, y);

    // 影
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(x - 4, y - 1, 8, 2);

    const by = y - (walking && step ? 1 : 0);
    // 足
    if (!seated) {
      if (p.dir === 'left' || p.dir === 'right') {
        px(x - 2 + (step ? -1 : 0), by - 3, 2, 3, p.pants);
        px(x + (step ? 1 : 0), by - 3, 2, 3, p.pants);
      } else {
        px(x - 3, by - 3 + (step ? -1 : 0), 2, 3, p.pants);
        px(x + 1, by - 3 + (step ? 0 : -1), 2, 3, p.pants);
      }
    } else {
      px(x - 3, by - 3, 6, 2, p.pants);
    }
    // 体
    const side = p.dir === 'left' || p.dir === 'right';
    const bw = side ? 6 : 8;
    px(x - bw / 2, by - 8, bw, 6, p.shirt);
    if (p.dir === 'down') px(x, by - 8, 1, 3, p.accent);
    // 腕
    if (side) {
      const ax = p.dir === 'right' ? x + 1 : x - 2;
      px(ax, by - 7, 2, 4, p.shirt);
      px(ax, by - 3, 2, 1, p.skin);
    } else {
      const lift = typing ? 1 : 0;
      px(x - 5, by - 8, 1, 4 - lift, p.shirt);
      px(x + 4, by - 8, 1, 4 - (typing ? 0 : 1) * (p.state === 'work' ? 1 : 0), p.shirt);
      px(x - 5, by - 4 - lift, 1, 1, p.skin);
      px(x + 4, by - 4, 1, 1, p.skin);
    }
    // 頭
    const hx = x - 4, hy = by - 15;
    px(hx, hy, 8, 7, p.skin);
    if (p.dir === 'up') {
      px(hx, hy, 8, 6, p.hair);
      if (p.style === 'long') px(hx, hy + 6, 8, 3, p.hair);
      if (p.style === 'bob') px(hx - 1, hy + 2, 10, 5, p.hair);
    } else if (p.dir === 'down') {
      px(hx, hy, 8, 3, p.hair);
      px(hx, hy + 3, 1, 2, p.hair);
      px(hx + 7, hy + 3, 1, 2, p.hair);
      if (p.style === 'messy') { px(hx + 1, hy - 1, 2, 1, p.hair); px(hx + 5, hy - 1, 2, 1, p.hair); }
      if (p.style === 'long') { px(hx - 1, hy + 2, 1, 7, p.hair); px(hx + 8, hy + 2, 1, 7, p.hair); }
      if (p.style === 'bob') { px(hx - 1, hy + 1, 1, 5, p.hair); px(hx + 8, hy + 1, 1, 5, p.hair); }
      px(hx + 2, hy + 4, 1, 1, '#1b1b2f');
      px(hx + 5, hy + 4, 1, 1, '#1b1b2f');
      if (p.state === 'meeting' || p.state === 'chat') px(hx + 3, hy + 6, 2, 1, '#c0605a');
    } else {
      const flip = p.dir === 'left';
      const fx = (dx) => (flip ? hx + 7 - dx : hx + dx);
      px(hx, hy, 8, 3, p.hair);
      for (let i = 0; i < 3; i++) px(fx(i), hy + 3, 1, 3, p.hair);
      if (p.style === 'long') for (let i = 0; i < 3; i++) px(fx(i), hy + 6, 1, 3, p.hair);
      if (p.style === 'messy') px(fx(1), hy - 1, 3, 1, p.hair);
      px(fx(5), hy + 4, 1, 1, '#1b1b2f');
    }

    if (seated && p.dir === 'up') drawChairBack(x, y);
  }

  // 吹き出し
  const ICONS = {
    chat: (x, y) => { [1, 4, 7].forEach((d) => px(x + d + 1, y + 3, 1, 1, '#1b1b2f')); },
    talk: (x, y) => { px(x + 2, y + 2, 6, 1, '#2e86de'); px(x + 2, y + 4, 4, 1, '#2e86de'); },
    coffee: (x, y) => { px(x + 3, y + 2, 4, 4, '#8b4a2b'); px(x + 7, y + 3, 1, 2, '#8b4a2b'); px(x + 4, y + 1, 1, 1, '#c8c8d4'); },
    print: (x, y) => { px(x + 3, y + 1, 5, 5, '#d0d0dc'); px(x + 4, y + 2, 3, 1, '#5a5a70'); px(x + 4, y + 4, 2, 1, '#5a5a70'); },
    lunch: (x, y) => {
      px(x + 4, y, 2, 1, '#8a8aa0'); px(x + 3, y + 1, 4, 1, '#8a8aa0'); px(x + 2, y + 2, 6, 3, '#8a8aa0'); px(x + 1, y + 4, 8, 3, '#8a8aa0');
      px(x + 4, y + 1, 2, 1, '#f4f1e6'); px(x + 3, y + 2, 4, 2, '#f4f1e6'); px(x + 2, y + 4, 6, 2, '#f4f1e6'); px(x + 3, y + 5, 4, 2, '#1b1b2f');
    },
    idea: (x, y) => { px(x + 4, y + 1, 2, 3, '#e0a800'); px(x + 4, y + 5, 2, 1, '#e0a800'); },
  };

  function bubbleFor(p) {
    if (!p.present || p.state === 'walk') return null;
    if (p.state === 'chat' || (p.state === 'work' && isChatting(p) && STAFF.some((o) => o.chatTarget === p && o.state === 'chat'))) return 'chat';
    if (p.state === 'coffee') return 'coffee';
    if (p.state === 'print') return 'print';
    if (p.state === 'lunch') return 'lunch';
    if (p.state === 'meeting') {
      const here = STAFF.filter((o) => o.present && o.state === 'meeting');
      return here[Math.floor(clock / 3) % here.length] === p ? 'talk' : null;
    }
    if (p.state === 'work' && p.idea > 0) return 'idea';
    return null;
  }

  function drawBubble(p, type) {
    const x = Math.round(p.x) - 5, y = Math.round(p.y) - 26;
    px(x, y, 11, 8, '#1b1b2f');
    px(x + 1, y - 1, 9, 10, '#1b1b2f');
    px(x + 1, y, 9, 8, '#ffffff');
    px(x + 4, y + 8, 2, 2, '#1b1b2f');
    px(x + 4, y + 8, 1, 1, '#ffffff');
    ctx.save();
    ICONS[type](x, y);
    ctx.restore();
  }

  function drawLighting() {
    const h = clock / 60;
    let color = null;
    if (h < 8.6) color = 'rgba(255, 170, 120, 0.12)';
    else if (h >= 17 && h < 18) color = `rgba(255, 140, 60, ${((h - 17) * 0.18).toFixed(3)})`;
    else if (h >= 18) color = `rgba(20, 20, 70, ${Math.min(0.45, 0.18 + (h - 18) * 0.3).toFixed(3)})`;
    if (color) { ctx.fillStyle = color; ctx.fillRect(0, 0, W, H); }
  }

  function render() {
    drawFloor();
    drawWalls();
    drawGlass();
    drawFurniture();
    const people = STAFF.filter((p) => p.present).sort((a, b) => a.y - b.y);
    people.forEach(drawPerson);
    drawLighting();
    people.forEach((p) => { const b = bubbleFor(p); if (b) drawBubble(p, b); });
    if (selected && selected.present) {
      const bob = Math.floor(animMs / 250) % 2;
      const x = Math.round(selected.x), y = Math.max(0, Math.round(selected.y) - (bubbleFor(selected) ? 34 : 22) - bob);
      px(x - 3, y, 7, 1, '#ffd23f');
      px(x - 2, y + 1, 5, 1, '#ffd23f');
      px(x - 1, y + 2, 3, 1, '#ffd23f');
      px(x, y + 3, 1, 1, '#ffd23f');
    }
  }

  // ================= UI =================
  const fmt = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;

  function statusText(p) {
    const s = p.state === 'walk' ? p.nextState : p.state;
    if (p.state === 'walk') {
      if (s === 'gone') return '退勤中 → 出入口';
      if (s === 'out') return 'ランチへ外出中…';
      return `移動中 → ${p.spot.label}`;
    }
    switch (s) {
      case 'before': return '出勤前';
      case 'work': return STAFF.some((o) => o.chatTarget === p && o.state === 'chat') ? '雑談に付き合い中' : 'デスクで作業中';
      case 'wait': return '待機中';
      case 'coffee': return 'コーヒー休憩';
      case 'print': return 'コピー・印刷中';
      case 'chat': return `${p.chatTarget.name}さんと雑談中`;
      case 'meeting': return '会議中';
      case 'lunch': return `昼休み（${p.spot.label}）`;
      case 'out': return 'ランチで外出中';
      case 'gone': return '退勤済み';
      default: return '';
    }
  }

  function phaseText() {
    if (MEETINGS.some(([a, b]) => clock >= a && clock < b)) return '会議中';
    if (clock >= LUNCH[0] && clock < LUNCH[1]) return '昼休み';
    if (clock < 9 * 60) return '始業前';
    if (clock >= 17 * 60 + 50 && STAFF.every((p) => p.state === 'gone')) return '終業後';
    if (clock >= 17 * 60 + 50) return '退勤時間';
    return '業務中';
  }

  const list = $('staff');
  STAFF.forEach((p) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="sw" style="background:${p.shirt};border:2px solid ${p.hair}"></span><span class="nm">${p.name}（${p.role}）</span><span class="st"></span>`;
    li.addEventListener('click', () => select(p));
    p.li = li;
    list.appendChild(li);
  });

  function select(p) {
    selected = selected === p ? null : p;
    STAFF.forEach((o) => o.li.classList.toggle('sel', o === selected));
    updateUI();
  }

  function updateUI() {
    $('day').textContent = `Day ${day}`;
    $('time').textContent = fmt(clock);
    $('phase').textContent = phaseText();
    STAFF.forEach((p) => { p.li.querySelector('.st').textContent = statusText(p); });
    const d = $('detail');
    if (selected) {
      const p = selected;
      d.innerHTML = `<strong>${p.name}</strong>（${p.role}）<br>今: ${statusText(p)}<br>出勤 ${fmt(p.arriveAt)} ／ 退勤予定 ${fmt(p.leaveAt)}<br>昼食: ${p.lunchOut ? '外で食べる' : '社内で食べる'}`;
    } else {
      d.textContent = '社員をクリックすると詳しく表示します';
    }
  }

  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (W / rect.width);
    const my = (e.clientY - rect.top) * (H / rect.height);
    const hit = STAFF.filter((p) => p.present && mx >= p.x - 7 && mx <= p.x + 7 && my >= p.y - 18 && my <= p.y + 2)
      .sort((a, b) => b.y - a.y)[0];
    if (hit) select(hit);
  });

  document.querySelectorAll('[data-speed]').forEach((btn) => {
    btn.addEventListener('click', () => {
      speed = Number(btn.dataset.speed);
      document.querySelectorAll('[data-speed]').forEach((b) => b.classList.toggle('on', b === btn));
    });
  });

  function showBanner(text) {
    const b = $('banner');
    b.textContent = text;
    b.classList.remove('hidden');
    bannerTimer = 2;
  }

  // ================= ループ =================
  let last = performance.now();
  let uiTick = 0;
  function frame(now) {
    const real = Math.min(0.1, (now - last) / 1000);
    if (speed > 0) animMs += real * 1000;
    last = now;
    let sim = real * speed; // ゲーム内の分
    while (sim > 0) {        // 高速時も細かく刻んで更新
      const dt = Math.min(sim, 0.05);
      update(dt);
      sim -= dt;
    }
    if (bannerTimer > 0) {
      bannerTimer -= real;
      if (bannerTimer <= 0) $('banner').classList.add('hidden');
    }
    render();
    uiTick += real;
    if (uiTick > 0.1) { uiTick = 0; updateUI(); }
    requestAnimationFrame(frame);
  }

  // テスト・デバッグ用（ブラウザのコンソールから時刻を進められる）
  window.office = {
    get clock() { return clock; },
    set clock(v) { clock = v; },
    get day() { return day; },
    staff: STAFF,
    setSpeed(v) { speed = v; },
    step(minutes) { let m = minutes; while (m > 0) { const dt = Math.min(m, 0.05); update(dt); m -= dt; } render(); updateUI(); },
  };

  scheduleDay();
  showBanner('Day 1');
  requestAnimationFrame(frame);
})();
