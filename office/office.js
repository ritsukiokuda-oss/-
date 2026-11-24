(() => {
  'use strict';

  // ================= 基本設定 =================
  const T = 16, COLS = 20, ROWS = 11, W = 320, H = 176;
  const WALK = 4;            // 歩く速さ（マス / ゲーム内1分）
  const DAY_START = 8 * 60 + 20;
  const DAY_END = 19 * 60;
  const MEETINGS = [[10 * 60 + 30, 11 * 60], [15 * 60, 15 * 60 + 30]];
  const LUNCH = [12 * 60, 13 * 60];
  const LEAVE_START = 17 * 60 + 50;

  const canvas = document.getElementById('office');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const $ = (id) => document.getElementById(id);
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const key = (c, r) => `${c},${r}`;
  const shade = OfficeSprites.shade;
  function px(x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), w, h);
  }
  // 輪郭付きの箱
  function box(x, y, w, h, fill, outline = '#2a2238') {
    px(x, y, w, h, outline);
    px(x + 1, y + 1, w - 2, h - 2, fill);
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
  // 追加の2席は上側に置き、下側の通路を空けておく
  const MEETING_SEATS = [
    { c: 13, r: 2, dir: 'right' }, { c: 17, r: 2, dir: 'left' },
    { c: 13, r: 3, dir: 'right' }, { c: 17, r: 3, dir: 'left' },
    { c: 14, r: 1, dir: 'down' }, { c: 16, r: 1, dir: 'down' },
  ].map((s) => ({ ...s, chair: true, label: '会議室' }));

  for (let c = 16; c <= 18; c++) block(c, 6); // コーヒーカウンター
  const COFFEE_SPOTS = [16, 17, 18].map((c) => ({ c, r: 7, dir: 'up', label: 'コーヒー', shared: true }));

  block(14, 8); // 休憩テーブル
  const TABLE_SEATS = [
    { c: 13, r: 8, dir: 'right', chair: true, shared: true, label: '休憩スペース' },
    { c: 15, r: 8, dir: 'left', chair: true, shared: true, label: '休憩スペース' },
  ];
  // 誕生日会でテーブルを囲む位置（社員の番号順）
  const PARTY_SPOTS = [
    TABLE_SEATS[0], TABLE_SEATS[1],
    { c: 14, r: 7, dir: 'down' }, { c: 14, r: 9, dir: 'up' },
    { c: 13, r: 9, dir: 'right' }, { c: 15, r: 7, dir: 'left' },
  ].map((s) => ({ ...s, label: '休憩スペース' }));

  block(10, 9); // コピー機
  const PRINTER_SPOT = { c: 10, r: 8, dir: 'down', label: 'コピー機', shared: true };

  const PLANTS = [[1, 1], [10, 1], [18, 9], [1, 9]];
  PLANTS.forEach(([c, r]) => block(c, r));
  const SHELF = [[1, 5], [1, 6]];
  SHELF.forEach(([c, r]) => block(c, r));

  // 宅配便の受け渡し位置
  const COURIER_SPOT = { c: 5, r: 9, dir: 'up', label: '出入口' };
  const RECEIVE_SPOT = { c: 5, r: 8, dir: 'down', label: '出入口' };

  // 自席の椅子のマスは「目的地のときだけ」通れる
  const seatTiles = new Set(DESKS.map((d) => key(d.c, d.r + 1)));

  function walkable(c, r) {
    return c >= 0 && c < COLS && r >= 0 && r < ROWS && !blocked[r][c];
  }
  const FLOOR_TILES = [];
  for (let r = 1; r < 10; r++) for (let c = 1; c < 19; c++) if (walkable(c, r) && !seatTiles.has(key(c, r))) FLOOR_TILES.push({ c, r });

  function findPath(from, to, avoid = null) {
    const goal = key(to.c, to.r);
    const start = key(from.c, from.r);
    const prev = new Map([[start, null]]);
    const queue = [from];
    while (queue.length) {
      const cur = queue.shift();
      if (key(cur.c, cur.r) === goal) {
        const path = [];
        let k = goal;
        while (k && k !== start) {
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

  // ================= 登場人物 =================
  const SCREENS = ['mail', 'code', 'design', 'sales', 'sheet', 'manual'];
  const STAFF = [
    { name: '佐藤', role: '部長', hair: '#7a7a86', skin: '#f0bf94', shirt: '#34466e', accent: '#d64541', pants: '#25252f', style: 'short' },
    { name: '鈴木', role: 'エンジニア', hair: '#3a2418', skin: '#f6c49a', shirt: '#3a7bd5', accent: '#bfe0ff', pants: '#3c3c5c', style: 'messy' },
    { name: '高橋', role: 'デザイナー', hair: '#d0702e', skin: '#f9d3b0', shirt: '#e88aa8', accent: '#ffe066', pants: '#4a3a5a', style: 'long' },
    { name: '田中', role: '営業', hair: '#232323', skin: '#e8b07f', shirt: '#f4f4f8', accent: '#2e86de', pants: '#2b2b38', style: 'short' },
    { name: '伊藤', role: '経理', hair: '#5a3524', skin: '#f6c49a', shirt: '#6ab04c', accent: '#f4f4f8', pants: '#5a4a3a', style: 'bob' },
    { name: '渡辺', role: '新人', hair: '#a8743a', skin: '#f9d3b0', shirt: '#f0a030', accent: '#fff4d0', pants: '#3c3c5c', style: 'messy' },
  ].map((s, i) => ({
    ...s,
    kind: 'staff',
    idx: i,
    screen: SCREENS[i],
    sprites: OfficeSprites.build(s),
    desk: { c: DESKS[i].c, r: DESKS[i].r + 1, dir: 'up', chair: true, label: '自席' },
  }));

  const NPC_LOOKS = {
    visitor: { name: 'お客さま', role: '来客', hair: '#5a4030', skin: '#f0c8a0', shirt: '#6b6b7a', accent: '#9b59b6', pants: '#3a3a46', style: 'bob' },
    courier: { name: '配達員', role: '宅配便', hair: '#2a2a2a', skin: '#e8b07f', shirt: '#3c9a5a', accent: '#2f6e40', pants: '#2b4a35', style: 'cap' },
  };
  const NPC_SPRITES = {
    visitor: OfficeSprites.build(NPC_LOOKS.visitor),
    courier: OfficeSprites.build(NPC_LOOKS.courier),
  };
  const CAT_SPRITES = OfficeSprites.buildCat();

  let npcs = [];
  const actors = () => [...STAFF, ...npcs];

  const reservations = new Map();
  let clock = DAY_START;
  let day = 1;
  let speed = 3;
  let selected = null;
  let bannerTimer = 0;
  let allGoneAt = null; // 全員が退勤した時刻
  let animMs = 0;       // アニメーション用の時計（一時停止中は止まる）
  let events = [];      // 今日のイベント
  let eventLog = [];
  let confetti = [];

  function freshActor(extra) {
    return {
      present: false, state: 'before', mode: 'normal',
      x: DOOR.c * T + 8, y: DOOR.r * T + 13, c: DOOR.c, r: DOOR.r,
      dir: 'up', path: [], spot: null, nextState: null, nextTimer: 0,
      timer: 0, walkPx: 0, chatTarget: null, idea: 0, reserved: null, surprised: 0,
      ...extra,
    };
  }

  function scheduleDay() {
    reservations.clear();
    npcs = [];
    confetti = [];
    STAFF.forEach((p, i) => {
      Object.assign(p, freshActor({
        arriveAt: 8 * 60 + 30 + rand(0, 40),
        leaveAt: i === 0 ? 18 * 60 + 20 + rand(0, 10) : LEAVE_START + rand(0, 30),
        lunchOut: Math.random() < 0.5,
        lunchEnd: LUNCH[1],
      }));
    });
    planEvents();
  }

  // ================= 場所の予約と移動 =================
  function reserve(p, spot) {
    if (p.reserved && reservations.get(p.reserved) === p) reservations.delete(p.reserved);
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

  // 立ち止まっている他の人がいるマス（猫は除く）
  function occupiedBy(p) {
    return new Set(actors().filter((o) => o !== p && o.kind !== 'cat' && o.present && o.state !== 'walk').map((o) => key(o.c, o.r)));
  }

  function goTo(p, spot, state, timer, extra = {}) {
    reserve(p, spot);
    p.spot = spot;
    p.nextState = state;
    p.nextTimer = timer;
    p.chatTarget = extra.chatTarget || null;
    p.onArrive = extra.onArrive || null;
    const from = { c: p.c, r: p.r };
    const avoid = p.kind === 'cat' ? null : occupiedBy(p);
    const path = findPath(from, spot, avoid) || findPath(from, spot);
    if (!path) {
      // 行けないときは到着扱いにせず、少し待ってから考え直す
      console.warn(`経路が見つかりません: ${p.name} (${p.c},${p.r}) → (${spot.c},${spot.r})`);
      reserve(p, null);
      p.pendingArrive = p.onArrive;
      p.onArrive = null;
      p.path = [];
      p.state = 'wait';
      p.timer = 1;
      return;
    }
    // マスの途中にいて、新しい経路が向かっていたマスへ進まないなら、今のマスの中心に戻る
    const nextTile = p.path[0];
    const cx = p.c * T + 8, cy = p.r * T + 13;
    const continues = nextTile && path[0] && path[0].c === nextTile.c && path[0].r === nextTile.r;
    if ((p.x !== cx || p.y !== cy) && !continues) path.unshift({ c: p.c, r: p.r });
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
    if (p.onArrive) { const f = p.onArrive; p.onArrive = null; f(p); }
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
        // 次のマスに誰かが立ち止まっていたら、よけられる経路に引き直す
        const next = p.path[0];
        if (p.kind !== 'cat' && next && p.path.length > 1 && occupiedBy(p).has(key(next.c, next.r))) {
          const goal = p.path[p.path.length - 1];
          const detour = findPath({ c: p.c, r: p.r }, goal, occupiedBy(p));
          if (detour) p.path = detour;
        }
      } else {
        p.x += Math.sign(dx) * dist;
        p.y += Math.sign(dy) * dist;
        p.walkPx += dist;
        dist = 0;
      }
    }
    if (!p.path.length) arrive(p);
  }

  function enterAt(p) {
    p.present = true;
    p.c = DOOR.c; p.r = DOOR.r;
    p.x = DOOR.c * T + 8; p.y = DOOR.r * T + 13;
    p.path = [];
  }

  // ================= イベント =================
  const EVENT_DEFS = {
    birthday: { label: '誕生日会', icon: '🎂', exclusive: true, dur: 20, windows: [[15 * 60 + 35, 15 * 60 + 50]] },
    visitor: { label: '来客', icon: '🤝', exclusive: true, dur: 25, windows: [[13 * 60 + 15, 14 * 60 + 20], [16 * 60, 16 * 60 + 50]] },
    drill: { label: '避難訓練', icon: '🚨', exclusive: true, dur: 15, windows: [[9 * 60 + 20, 10 * 60], [13 * 60 + 20, 14 * 60 + 30], [16 * 60, 17 * 60]] },
    blackout: { label: '停電', icon: '💡', dur: 4, windows: [[9 * 60 + 30, 17 * 60]] },
    cat: { label: '猫の迷い込み', icon: '🐈', dur: 50, windows: [[9 * 60 + 15, 16 * 60 + 30]] },
    courier: { label: '宅配便', icon: '📦', dur: 10, windows: [[9 * 60 + 30, 16 * 60 + 45]] },
  };
  const PLANNED = ['birthday', 'visitor', 'drill']; // 事前に予定が分かるイベント

  function overlaps(a, b) { return a.start < b.end && b.start < a.end; }

  function planEvents() {
    events = [];
    const all = Object.keys(EVENT_DEFS);
    for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
    const types = all.slice(0, 3);
    for (const type of types) {
      const def = EVENT_DEFS[type];
      for (let tries = 0; tries < 20; tries++) {
        const [a, b] = pick(def.windows);
        const ev = { type, start: Math.round(rand(a, b)), started: false, ended: false };
        ev.end = ev.start + def.dur;
        const clash = events.some((o) => (def.exclusive && EVENT_DEFS[o.type].exclusive && overlaps(o, ev)) || (o.type === type));
        if (!clash) { events.push(ev); break; }
      }
    }
    events.sort((a, b) => a.start - b.start);
  }

  function activeEvent(type) {
    return events.find((e) => e.type === type && e.started && !e.ended) || null;
  }

  function log(text) {
    eventLog.unshift({ time: clock, day, text });
    eventLog = eventLog.slice(0, 30);
    renderLog();
  }

  function presentStaff() { return STAFF.filter((p) => p.present); }

  function startEvent(ev) {
    ev.started = true;
    const def = EVENT_DEFS[ev.type];
    showBanner(`${def.icon} ${def.label}`);
    switch (ev.type) {
      case 'birthday': {
        const cands = presentStaff();
        ev.honoree = cands.length ? pick(cands) : pick(STAFF);
        log(`🎂 ${ev.honoree.name}さんの誕生日会が始まりました`);
        break;
      }
      case 'visitor': {
        const hosts = [STAFF[0], STAFF[3], STAFF[1], STAFF[2]].filter((p) => p.present);
        ev.host = hosts[0] || pick(presentStaff()) || STAFF[0];
        ev.visitorSeat = MEETING_SEATS[1]; // 応対役は (13,2)、お客さまは向かいの (17,2)
        const v = freshActor({ kind: 'visitor', name: NPC_LOOKS.visitor.name, role: '来客', sprites: NPC_SPRITES.visitor, ev });
        enterAt(v);
        goTo(v, ev.visitorSeat, 'visit', Infinity);
        npcs.push(v);
        ev.npc = v;
        log(`🤝 お客さまが来社。${ev.host.name}さんが対応します`);
        break;
      }
      case 'drill': {
        ev.allOutAt = null;
        ev.evacuees = presentStaff();
        const cr = activeEvent('courier');
        if (cr) { cr.end = clock; endEvent(cr); }
        log('🚨 避難訓練開始！全員出入口から避難します');
        break;
      }
      case 'blackout':
        STAFF.forEach((p) => { if (p.present) p.surprised = 0.6; });
        log('💡 停電発生！真っ暗に…');
        break;
      case 'cat': {
        const cat = freshActor({ kind: 'cat', name: '猫', role: '迷い猫', ev });
        enterAt(cat);
        catWander(cat);
        npcs.push(cat);
        ev.npc = cat;
        log('🐈 どこからか猫が入ってきました');
        break;
      }
      case 'courier': {
        const c = freshActor({ kind: 'courier', name: NPC_LOOKS.courier.name, role: '宅配便', sprites: NPC_SPRITES.courier, ev });
        enterAt(c);
        goTo(c, COURIER_SPOT, 'deliver', 6, { onArrive: () => { ev.arrived = true; chooseReceiver(ev); } });
        npcs.push(c);
        ev.npc = c;
        log('📦 宅配便が届きました');
        break;
      }
    }
  }

  function chooseReceiver(ev) {
    const free = (p) => p.present && baseMode(p) === 'normal';
    const dist = (p) => Math.abs(p.c - RECEIVE_SPOT.c) + Math.abs(p.r - RECEIVE_SPOT.r);
    ev.receiver = free(STAFF[5]) ? STAFF[5] : (STAFF.filter(free).sort((a, b) => dist(a) - dist(b))[0] || null);
  }

  function endEvent(ev) {
    ev.ended = true;
    switch (ev.type) {
      case 'birthday':
        log(`🎉 誕生日会おわり。${ev.honoree.name}さん、おめでとう！`);
        break;
      case 'visitor':
        if (ev.npc) goTo(ev.npc, DOOR, 'gone', 0);
        log('🤝 お客さまがお帰りになりました');
        break;
      case 'drill': {
        const t = ev.allOutAt;
        log(t !== null ? `✅ 避難訓練終了（全員避難まで ${Math.round((t - ev.start) * 10) / 10} 分）` : '✅ 避難訓練終了');
        break;
      }
      case 'blackout':
        log('💡 電気が復旧しました');
        break;
      case 'cat':
        if (ev.npc && ev.npc.present) goTo(ev.npc, DOOR, 'gone', 0);
        log('🐈 猫はどこかへ帰っていきました');
        break;
      case 'courier':
        if (ev.npc && ev.npc.present) goTo(ev.npc, DOOR, 'gone', 0);
        log(ev.received ? `📦 ${ev.receiver.name}さんが荷物を受け取りました` : '📦 誰も出られず、不在票が置かれました');
        break;
    }
  }

  function updateEvents() {
    for (const ev of events) {
      if (!ev.started && clock >= ev.start) {
        if (clock < LEAVE_START) startEvent(ev);
        else { ev.started = true; ev.ended = true; } // 退勤時間を過ぎたら中止
      }
      if (ev.started && !ev.ended) {
        if (ev.type === 'courier') {
          const r = ev.receiver;
          if (ev.arrived && !ev.received && (!r || !r.present || baseMode(r) !== 'normal')) { ev.receiver = null; chooseReceiver(ev); }
          if (ev.receiver && ev.receiver.state === 'receive' && !ev.received) {
            ev.received = true;
            ev.end = Math.min(ev.end, clock + 1.5);
          }
        }
        if (ev.type === 'drill' && ev.allOutAt === null && ev.evacuees.every((p) => !p.present)) ev.allOutAt = clock;
        if (clock >= ev.end) endEvent(ev);
      }
    }
  }

  function triggerNow(type) {
    const def = EVENT_DEFS[type];
    if (clock < 9 * 60 || clock >= LEAVE_START) return log(`⚠️ 営業時間外なので「${def.label}」は起こせません`);
    if (clock >= LEAVE_START - def.dur) return log(`⚠️ 退勤時間までに終わらないので「${def.label}」は起こせません`);
    if (!presentStaff().length) return log(`⚠️ まだ誰も出社していないので「${def.label}」は起こせません`);
    if (activeEvent(type)) return log(`⚠️ 「${def.label}」はもう起きています`);
    const ev = { type, start: clock, end: clock + def.dur, started: false, ended: false };
    if (def.exclusive && events.some((o) => EVENT_DEFS[o.type].exclusive && o.started && !o.ended)) {
      return log(`⚠️ 別のイベント中なので「${def.label}」は起こせません`);
    }
    if (def.exclusive && MEETINGS.some(([a, b]) => ev.start < b && a < ev.end)) {
      return log(`⚠️ 会議と重なるので「${def.label}」は起こせません`);
    }
    if (def.exclusive && ev.start < LUNCH[1] && LUNCH[0] < ev.end) {
      return log(`⚠️ 昼休みと重なるので「${def.label}」は起こせません`);
    }
    // 同じ種類の予定や、重なる予定は取りやめる
    const dropped = events.filter((o) => !o.started && (o.type === type || (def.exclusive && EVENT_DEFS[o.type].exclusive && overlaps(o, ev))));
    dropped.filter((o) => o.type !== type).forEach((o) => log(`📅 ${fmt(o.start)}の「${EVENT_DEFS[o.type].label}」は中止になりました`));
    events = events.filter((o) => !dropped.includes(o));
    events.push(ev);
    events.sort((a, b) => a.start - b.start);
    startEvent(ev);
    renderPlan();
  }

  function spawnConfetti() {
    const colors = ['#ff5d73', '#ffd23f', '#3ddc97', '#4fb3ff', '#c77dff'];
    confetti.push({ x: 14 * T + rand(-20, 36), y: 6 * T + rand(0, 8), vx: rand(-8, 8), vy: rand(4, 14), life: 2.5, color: pick(colors) });
  }

  // ================= 社員の行動 =================
  function inMeeting() { return MEETINGS.some(([a, b]) => clock >= a && clock < b); }

  function modeFor(p) {
    const b = baseMode(p);
    if (b !== 'normal') return b;
    const cr = activeEvent('courier');
    if (cr && cr.arrived && cr.receiver === p) return 'receive';
    return 'normal';
  }

  // 宅配便の受け取り役を除いたモード
  function baseMode(p) {
    if (clock >= p.leaveAt) return 'leave';
    if (activeEvent('drill')) return 'drill';
    if (inMeeting()) return 'meeting';
    if (activeEvent('birthday')) return 'party';
    if (clock >= LUNCH[0] && clock < p.lunchEnd) return 'lunch';
    const v = activeEvent('visitor');
    if (v && v.host === p) return 'host';
    return 'normal';
  }

  // 今のモードに合わせて行き先を決める
  function decide(p) {
    switch (p.mode) {
      case 'leave': goTo(p, DOOR, 'gone', 0); break;
      case 'drill': goTo(p, DOOR, 'out', 0); break;
      case 'meeting': goTo(p, MEETING_SEATS[p.idx], 'meeting', Infinity); break;
      case 'party': goTo(p, PARTY_SPOTS[p.idx], 'party', Infinity); break;
      case 'host': goTo(p, MEETING_SEATS[0], 'host', Infinity); break;
      case 'receive': goTo(p, RECEIVE_SPOT, 'receive', Infinity); break;
      case 'lunch':
        if (p.lunchOut) goTo(p, DOOR, 'out', 0);
        else goTo(p, freeSpot(TABLE_SEATS, p) || p.desk, 'lunch', Infinity);
        break;
      default:
        goTo(p, p.desk, 'work', rand(15, 45));
    }
  }

  function isChatting(o) {
    return STAFF.some((p) => p.present && p.chatTarget === o && (p.state === 'chat' || p.nextState === 'chat'));
  }

  // 作業の合間にすること
  function pickActivity(p) {
    if (isChatting(p)) { p.timer = 1; return; } // 話しかけられている間は席を離れない
    const cat = npcs.find((n) => n.kind === 'cat' && n.present && n.state === 'sit');
    if (cat && Math.random() < 0.4) {
      const spots = [[1, 0], [-1, 0], [0, 1], [0, -1]]
        .map(([dc, dr]) => ({ c: cat.c + dc, r: cat.r + dr, dir: dc === 1 ? 'left' : dc === -1 ? 'right' : dr === 1 ? 'up' : 'down', label: '猫のところ', shared: true }))
        .filter((s) => s.r < 10 && walkable(s.c, s.r) && !seatTiles.has(key(s.c, s.r)) && isFree(s, p) && !occupiedBy(p).has(key(s.c, s.r)));
      if (spots.length) return goTo(p, pick(spots), 'pet', rand(3, 6));
    }
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

  function updateStaff(p, dt) {
    if (!p.present) {
      const m = modeFor(p);
      if (p.state === 'out' && m === 'leave') { p.state = 'gone'; return; }
      const canEnter = m !== 'drill' && m !== 'leave';
      if (p.state === 'before' && clock >= p.arriveAt && canEnter) { enterAt(p); p.mode = m; decide(p); }
      else if (p.state === 'out' && canEnter && (m !== 'lunch' || !p.lunchOut)) { enterAt(p); p.mode = m; decide(p); }
      return;
    }
    const m = modeFor(p);
    if (m !== p.mode) { p.mode = m; decide(p); }
    // 雑談相手が席にいなくなったら、話すのをやめて戻る
    if (p.state === 'chat' || (p.state === 'walk' && p.nextState === 'chat')) {
      const t = p.chatTarget;
      if (!t || !t.present || t.state !== 'work') decide(p);
    }
    // 撫でに行った猫がいなくなったら戻る
    if (p.state === 'pet' || (p.state === 'walk' && p.nextState === 'pet')) {
      const cat = npcs.find((n) => n.kind === 'cat' && n.present);
      const near = cat && cat.state === 'sit' && Math.abs(cat.c - p.spot.c) + Math.abs(cat.r - p.spot.r) <= 1;
      if (!cat || (p.state === 'pet' && !near)) decide(p);
    }
    if (p.idea > 0) p.idea -= dt;
    if (p.surprised > 0) p.surprised -= dt;
    if (p.state === 'walk') {
      stepMove(p, WALK * T * dt);
    } else {
      p.timer -= dt;
      if (p.timer <= 0) {
        if (p.state === 'work') pickActivity(p);
        else if (['coffee', 'print', 'chat', 'wait', 'pet'].includes(p.state)) decide(p);
      }
    }
  }

  // ================= 来客・配達員・猫 =================
  function catWander(cat) {
    const t = pick(FLOOR_TILES);
    goTo(cat, { ...t, dir: Math.random() < 0.5 ? 'left' : 'right' }, 'sit', rand(3, 8));
  }

  function updateNpc(n, dt) {
    if (!n.present) return;
    const speedMul = n.kind === 'cat' ? 0.8 : 1;
    if (n.state === 'walk') {
      stepMove(n, WALK * T * dt * speedMul);
    } else {
      n.timer -= dt;
      if (n.state === 'wait' && n.timer <= 0) goTo(n, n.spot, n.nextState, n.nextTimer, { onArrive: n.pendingArrive });
      if (n.kind === 'cat' && n.state === 'sit' && n.timer <= 0 && !n.ev.ended) catWander(n);
      if (n.kind === 'courier' && n.state === 'deliver' && n.timer <= 0 && !n.ev.ended) {
        n.ev.end = Math.min(n.ev.end, clock); // 誰も来ないので帰る
      }
    }
    if (n.state === 'gone') n.present = false;
  }

  function update(dt) {
    clock += dt;
    updateEvents();
    for (const p of STAFF) updateStaff(p, dt);
    for (const n of npcs) updateNpc(n, dt);
    npcs = npcs.filter((n) => n.present || n.state === 'before');

    const allGone = clock >= LEAVE_START && STAFF.every((p) => p.state === 'gone');
    if (allGone && allGoneAt === null) allGoneAt = clock;
    // 全員帰ってから20分は夜のオフィスを見せてから翌日へ
    if (allGone && (clock >= allGoneAt + 20 || clock >= DAY_END)) {
      allGoneAt = null;
      day++;
      clock = DAY_START;
      scheduleDay();
      renderPlan();
      showBanner(`Day ${day}`);
    }
  }

  // ================= 描画：部屋 =================
  const dark = () => !!activeEvent('blackout');

  function skyColors() {
    const h = clock / 60;
    if (h < 8.7) return ['#f7c59f', '#ffe3c4'];
    if (h < 16.5) return ['#6fbaff', '#b9e3ff'];
    if (h < 17.5) return ['#ff9e5e', '#ffd28a'];
    if (h < 18.3) return ['#8a4f8f', '#e07a6a'];
    return ['#141838', '#2a2d5a'];
  }

  function drawFloor() {
    for (let r = 1; r < 10; r++) {
      for (let c = 1; c < 19; c++) {
        const x = c * T, y = r * T;
        if (c >= 12 && r <= 4) {
          // 会議室：木の床
          const tones = ['#b98b5e', '#b28457', '#c09265'];
          for (let i = 0; i < 4; i++) px(x, y + i * 4, T, 4, tones[(c * 3 + r * 2 + i) % 3]);
          for (let i = 0; i < 4; i++) px(x + ((c * 5 + r * 7 + i * 9) % 14), y + i * 4 + 3, 2, 1, '#9a6e46');
        } else if (c >= 12 && r >= 6) {
          // 休憩スペース：タイル
          px(x, y, T, T, (c + r) % 2 ? '#ece7da' : '#ddd6c6');
          px(x, y + T - 1, T, 1, '#c9c1ae');
          px(x + T - 1, y, 1, T, '#c9c1ae');
        } else {
          // 執務エリア：タイルカーペット
          px(x, y, T, T, (c + r) % 2 ? '#b9bfc9' : '#b2b8c3');
          px(x, y, T, 1, '#c5cad3');
          px(x, y, 1, T, '#c5cad3');
          for (let i = 0; i < 3; i++) px(x + ((c * 7 + r * 3 + i * 5) % 13) + 1, y + ((c * 5 + r * 11 + i * 7) % 13) + 1, 1, 1, '#a6adb9');
        }
      }
    }
    // 出入口のマット
    px(DOOR.c * T + 1, 9 * T + 9, 14, 7, '#5a3f6e');
    px(DOOR.c * T + 2, 9 * T + 10, 12, 5, '#7a5a8a');
  }

  function drawWalls() {
    // 上の壁（腰壁つき）
    px(0, 0, W, T, '#7a80a6');
    px(0, 0, W, 2, '#8e94b8');
    px(0, 11, W, 1, '#5b6080');
    px(0, 12, W, 4, '#4b4f6b');
    px(0, 12, W, 1, '#62678a');
    // 窓
    const [skyTop, skyBottom] = skyColors();
    const night = clock / 60 >= 18.3;
    for (const c of [2, 3, 6, 7]) {
      const x = c * T + 1;
      box(x, 1, 14, 11, '#f0f2fa', '#4a4e6a');
      px(x + 2, 2, 10, 4, skyTop);
      px(x + 2, 6, 10, 4, skyBottom);
      px(x + 6, 2, 2, 8, '#f0f2fa');
      px(x + 1, 10, 12, 1, '#d6d9e8');
      if (night) { px(x + 3, 3, 1, 1, '#ffffff'); px(x + 10, 5, 1, 1, '#ffffaa'); if (c === 7) px(x + 9, 3, 2, 2, '#fff6c0'); }
      else if (clock / 60 >= 8.7 && clock / 60 < 16.5 && (c === 2 || c === 7)) { px(x + 3, 4, 3, 1, '#ffffff'); px(x + 4, 3, 2, 1, '#ffffff'); }
    }
    // 壁掛け時計
    const cx = 9 * T + 8, cy = 6;
    px(cx - 3, cy - 5, 7, 11, '#2a2238');
    px(cx - 5, cy - 3, 11, 7, '#2a2238');
    px(cx - 4, cy - 4, 9, 9, '#2a2238');
    px(cx - 3, cy - 4, 7, 9, '#fdfdf5');
    px(cx - 4, cy - 3, 9, 7, '#fdfdf5');
    const hour = ((clock / 60) % 12) / 12 * Math.PI * 2;
    const min = (clock % 60) / 60 * Math.PI * 2;
    for (let i = 1; i <= 3; i++) px(cx + Math.round(Math.sin(min) * i), cy - Math.round(Math.cos(min) * i), 1, 1, '#d64541');
    for (let i = 1; i <= 2; i++) px(cx + Math.round(Math.sin(hour) * i), cy - Math.round(Math.cos(hour) * i), 1, 1, '#2a2238');
    px(cx, cy, 1, 1, '#2a2238');
    // ホワイトボード
    box(14 * T - 2, 1, 46, 12, '#ffffff', '#6a6f8a');
    px(14 * T + 2, 4, 14, 1, '#2e86de');
    px(14 * T + 2, 7, 20, 1, '#d64541');
    px(14 * T + 2, 9, 10, 1, '#2e86de');
    px(14 * T + 27, 3, 2, 7, '#3ddc97');
    px(14 * T + 30, 5, 2, 5, '#3ddc97');
    px(14 * T + 33, 4, 2, 6, '#3ddc97');
    px(14 * T + 36, 2, 2, 8, '#3ddc97');
    px(14 * T + 10, 12, 20, 1, '#9aa0b8');
    // 左右と下の壁
    px(0, T, T, H - T, '#5b6080');
    px(T - 3, T, 3, H - 2 * T, '#4b4f6b');
    px(19 * T, T, T, H - T, '#5b6080');
    px(19 * T, T, 3, H - 2 * T, '#4b4f6b');
    px(0, 10 * T, W, T, '#5b6080');
    px(0, 10 * T, W, 3, '#4b4f6b');
    // ドア
    box(DOOR.c * T, 10 * T, T, T, '#a8703a', '#4a3020');
    px(DOOR.c * T + 3, 10 * T + 3, 10, 5, '#bf8550');
    px(DOOR.c * T + 11, 10 * T + 9, 2, 2, '#ffd23f');
    // 本棚
    const sx = 1 * T, sy = 5 * T - 6;
    box(sx, sy, 12, 38, '#8a5a34', '#4a3020');
    const books = ['#d64541', '#2e86de', '#3ddc97', '#ffd23f', '#9b59b6', '#f0a030'];
    for (let shelf = 0; shelf < 4; shelf++) {
      const y0 = sy + 2 + shelf * 9;
      px(sx + 1, y0 + 7, 10, 1, '#5a3a20');
      for (let i = 0; i < 4; i++) px(sx + 2 + i * 2, y0 + 1 + ((i + shelf) % 2), 2, 6 - ((i + shelf) % 2), books[(i + shelf * 2) % books.length]);
    }
  }

  function drawGlass() {
    const lamp = inMeeting() || !!activeEvent('visitor');
    for (const [c, r] of GLASS) {
      ctx.fillStyle = 'rgba(170, 215, 255, 0.5)';
      if (r === 5) {
        px(c * T, r * T + 5, T, 6, '#8fa8c4');
        ctx.fillStyle = 'rgba(190, 230, 255, 0.65)';
        ctx.fillRect(c * T, r * T + 6, T, 4);
        px(c * T + 3, r * T + 6, 3, 1, '#ffffff');
      } else {
        px(c * T + 5, r * T, 6, T, '#8fa8c4');
        ctx.fillStyle = 'rgba(190, 230, 255, 0.65)';
        ctx.fillRect(c * T + 6, r * T, 4, T);
        px(c * T + 6, r * T + 3, 1, 3, '#ffffff');
      }
    }
    // 会議中ランプ
    box(11 * T + 4, 1 * T + 1, 8, 6, '#2a2238');
    px(11 * T + 5, 1 * T + 2, 6, 4, lamp ? '#ff4d4d' : '#55556e');
    if (lamp) px(11 * T + 6, 1 * T + 2, 2, 1, '#ffb0b0');
  }

  // 椅子：背もたれは向きの反対側
  function drawChair(x, y, dir, layer) {
    if (layer !== 'back') {
      px(x - 4, y - 1, 9, 1, '#22222c');
      px(x - 1, y - 3, 2, 2, '#22222c');
      box(x - 5, y - 10, 10, 8, '#4a4a64', '#1f1f2a');
      px(x - 4, y - 9, 8, 1, '#6a6a88');
      if (dir === 'down') box(x - 5, y - 14, 10, 5, '#3b3b52', '#1f1f2a');
      if (dir === 'right') box(x - 7, y - 13, 3, 10, '#3b3b52', '#1f1f2a');
      if (dir === 'left') box(x + 4, y - 13, 3, 10, '#3b3b52', '#1f1f2a');
    }
    if (dir === 'up' && layer !== 'front') {
      box(x - 5, y - 7, 10, 6, '#3b3b52', '#1f1f2a');
      px(x - 4, y - 6, 8, 1, '#55556e');
    }
  }

  function drawScreen(x, y, kind, on) {
    if (!on) { px(x, y, 11, 7, dark() ? '#1a1d2c' : '#2f3650'); px(x + 1, y + 1, 3, 1, '#3f4766'); return; }
    const t = Math.floor(animMs / 400);
    px(x, y, 11, 7, '#dff1ff');
    switch (kind) {
      case 'code':
        px(x, y, 11, 7, '#1e2433');
        for (let i = 0; i < 4; i++) px(x + 1 + (i % 2) * 2, y + 1 + i * 1.5, 3 + ((i * 3 + t) % 5), 1, ['#7ee787', '#79c0ff', '#ffa657', '#d2a8ff'][i]);
        if (t % 2) px(x + 8, y + 5, 1, 1, '#ffffff');
        break;
      case 'design':
        px(x, y, 11, 7, '#f6f0ff');
        px(x + 1, y + 1, 4, 3, '#ff7aa2');
        px(x + 6, y + 1, 4, 2, '#7ad3ff');
        px(x + 5, y + 4, 5, 2, '#ffd23f');
        px(x + 1 + (t % 4), y + 5, 1, 1, '#2a2238');
        break;
      case 'sales':
        px(x, y, 11, 7, '#ffffff');
        [2, 3, 2, 4, 5].forEach((h, i) => px(x + 1 + i * 2, y + 6 - h - (i === t % 5 ? 1 : 0), 1, h + (i === t % 5 ? 1 : 0), '#2e86de'));
        break;
      case 'sheet':
        px(x, y, 11, 7, '#ffffff');
        for (let i = 0; i < 3; i++) px(x, y + 2 + i * 2, 11, 1, '#c8e6c9');
        px(x + 4, y, 1, 7, '#c8e6c9');
        px(x + 5 + (t % 5), y + 2 + (t % 3) * 2, 2, 1, '#43a047');
        break;
      case 'manual':
        px(x, y, 11, 7, '#fffbe6');
        for (let i = 0; i < 3; i++) px(x + 1, y + 1 + i * 2, 7 - i, 1, '#b0a080');
        px(x + 9, y + 1, 1, 3, '#f0a030');
        break;
      default:
        px(x, y, 11, 7, '#eef6ff');
        px(x, y, 11, 2, '#2e86de');
        for (let i = 0; i < 2; i++) px(x + 1, y + 3 + i * 2, 8 - i * 3 - (t % 2), 1, '#9aa6bb');
    }
  }

  function drawDesk(d, i) {
    const x = d.c * T, y = d.r * T;
    const owner = STAFF[i];
    // 天板・前板
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(x + 1, y + 15, 32, 2);
    box(x, y + 1, 32, 14, '#c08a58');
    px(x + 1, y + 2, 30, 1, '#dcab76');
    px(x + 1, y + 11, 30, 3, '#8a5a34');
    px(x + 1, y + 11, 30, 1, '#6e4628');
    // モニター
    const working = owner.present && owner.state === 'work' && !dark();
    box(x + 2, y - 4, 15, 11, '#3a3a4a');
    px(x + 3, y - 3, 13, 1, '#55556a');
    drawScreen(x + 4, y - 2, owner.screen, working);
    if (working) { ctx.fillStyle = 'rgba(160, 210, 255, 0.18)'; ctx.fillRect(x + 1, y + 6, 17, 5); }
    px(x + 8, y + 7, 3, 2, '#2a2238');
    px(x + 6, y + 9, 7, 1, '#2a2238');
    // キーボードとマウス
    box(x + 4, y + 7, 11, 3, '#e8e8f0', '#6a6a80');
    if (working && Math.floor(animMs / 160 + i) % 2) px(x + 6 + ((animMs / 160) | 0) % 6, y + 8, 1, 1, '#9a9ab0');
    px(x + 17, y + 8, 2, 2, '#6a6a80');
    // 書類・マグカップ・小物
    box(x + 19, y + 3, 8, 8, '#ffffff', '#a0a0b4');
    px(x + 21, y + 5, 4, 1, '#b0b0c0');
    px(x + 21, y + 7, 3, 1, '#b0b0c0');
    const mug = owner.accent === '#f4f4f8' || owner.accent === '#fff4d0' ? owner.shirt : owner.accent;
    box(x + 27, y + 4, 4, 5, mug);
    px(x + 31, y + 5, 1, 2, '#2a2238');
    if (working && Math.floor(animMs / 500) % 3 === 0) px(x + 28, y + 2, 1, 1, '#ffffff');
  }

  function drawFurniture() {
    STAFF.forEach((p) => {
      if (!isSeatedAt(p.desk)) drawChair(p.desk.c * T + 8, p.desk.r * T + 13, 'up');
    });
    DESKS.forEach(drawDesk);
    // 会議テーブル
    const mt = MEETING_TABLE;
    const tx = mt.c * T, ty = mt.r * T;
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(tx + 2, ty + 29, 46, 3);
    box(tx, ty + 1, 48, 29, '#9a6a44', '#4a3020');
    px(tx + 1, ty + 2, 46, 1, '#b8845a');
    px(tx + 1, ty + 26, 46, 3, '#7a4e30');
    box(tx + 5, ty + 8, 9, 6, '#c8c8d8', '#3a3a4a');
    px(tx + 6, ty + 9, 7, 3, '#7ec8ff');
    box(tx + 30, ty + 13, 7, 9, '#ffffff', '#a0a0b4');
    px(tx + 31, ty + 15, 5, 1, '#b0b0c0');
    if (inMeeting() || activeEvent('visitor')) { box(tx + 20, ty + 6, 4, 4, '#ffffff', '#8a8aa0'); box(tx + 40, ty + 18, 4, 4, '#ffffff', '#8a8aa0'); }
    // コーヒーカウンター
    const cx = 16 * T, cy = 6 * T;
    box(cx, cy, 48, 15, '#e6e1d4', '#5a5446');
    px(cx + 1, cy + 1, 46, 1, '#f6f2e8');
    px(cx + 1, cy + 7, 46, 7, '#bfb8a6');
    for (let i = 0; i < 3; i++) { px(cx + 1 + i * 16, cy + 7, 1, 7, '#8a8474'); px(cx + 12 + i * 16, cy + 10, 2, 1, '#8a8474'); }
    box(17 * T + 2, cy - 8, 12, 14, '#3a3a48');
    px(17 * T + 4, cy - 6, 8, 3, '#5a5a70');
    px(17 * T + 11, cy - 2, 1, 1, '#ff4d4d');
    px(17 * T + 6, cy + 1, 4, 3, '#ffffff');
    box(cx + 3, cy + 1, 5, 5, '#ffffff', '#8a8aa0');
    box(18 * T + 6, cy + 1, 5, 5, '#e88aa8', '#8a8aa0');
    // 休憩テーブル（誕生日会はケーキ）
    const bx = 14 * T, by = 8 * T;
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(bx + 2, by + 13, 13, 2);
    box(bx + 1, by + 1, 14, 13, '#ffffff', '#8a8aa0');
    px(bx + 2, by + 11, 12, 2, '#d8d8e4');
    if (activeEvent('birthday')) {
      box(bx + 4, by + 3, 8, 7, '#fff4f0', '#a05050');
      px(bx + 5, by + 4, 6, 2, '#ff7a9a');
      px(bx + 5, by + 7, 6, 1, '#ff7a9a');
      px(bx + 7, by + 1, 1, 2, '#4fb3ff');
      px(bx + 9, by + 1, 1, 2, '#ffd23f');
      if (Math.floor(animMs / 200) % 2) { px(bx + 7, by, 1, 1, '#ffb020'); px(bx + 9, by, 1, 1, '#ffb020'); }
    } else {
      box(bx + 5, by + 4, 5, 5, '#ffffff', '#8a8aa0');
      px(bx + 6, by + 5, 3, 2, '#8b4a2b');
    }
    // コピー機
    const printing = STAFF.some((p) => p.present && p.state === 'print');
    const ppx = 10 * T, ppy = 9 * T;
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(ppx + 2, ppy + 14, 13, 2);
    box(ppx + 1, ppy, 14, 15, '#e8e8f0', '#4a4a5a');
    px(ppx + 2, ppy + 1, 12, 3, '#a8a8bc');
    px(ppx + 3, ppy + 6, 10, 2, '#4a4a5a');
    px(ppx + 4, ppy + 10, 8, 3, '#ffffff');
    if (printing) px(ppx + 4, ppy + 8 + Math.floor(animMs / 150) % 2, 8, 2, '#ffffff');
    px(ppx + 12, ppy + 2, 1, 1, printing && Math.floor(animMs / 200) % 2 ? '#3dff6a' : '#2a7a3a');
    // 観葉植物
    for (const [c, r] of PLANTS) {
      const x = c * T, y = r * T;
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      ctx.fillRect(x + 4, y + 14, 9, 2);
      box(x + 4, y + 9, 8, 6, '#b5653a', '#5a3020');
      px(x + 5, y + 10, 6, 1, '#d07a48');
      px(x + 3, y + 3, 10, 7, '#2a2238');
      px(x + 4, y + 2, 8, 8, '#3d8b40');
      px(x + 2, y + 5, 3, 4, '#2a2238');
      px(x + 11, y + 4, 3, 4, '#2a2238');
      px(x + 3, y + 5, 2, 3, '#4caf50');
      px(x + 11, y + 4, 2, 3, '#4caf50');
      px(x + 6, y, 4, 4, '#2a2238');
      px(x + 7, y + 1, 2, 3, '#66cf62');
      px(x + 5, y + 4, 2, 2, '#66cf62');
      px(x + 9, y + 6, 2, 2, '#2f6e30');
    }
    // 空いている会議・休憩の椅子
    [...MEETING_SEATS, ...TABLE_SEATS].forEach((s) => {
      if (!actors().some((p) => isSeatedAtSpot(p, s))) drawChair(s.c * T + 8, s.r * T + 13, s.dir);
    });
  }

  function isSeatedAt(spot) {
    return STAFF.some((p) => isSeatedAtSpot(p, spot));
  }
  function isSeatedAtSpot(p, spot) {
    return p.present && p.state !== 'walk' && p.spot && p.spot.c === spot.c && p.spot.r === spot.r && p.spot.chair;
  }

  // ================= 描画：人と猫 =================
  function frameFor(p) {
    const seated = p.state !== 'walk' && p.spot && p.spot.chair;
    if (p.state === 'walk') {
      const step = Math.floor(p.walkPx / 4) % 4;
      return ['walkA', 'stand', 'walkB', 'stand'][step];
    }
    if (seated) {
      if (p.dir === 'up' && p.state === 'work' && !dark()) return Math.floor(animMs / 160 + p.idx) % 2 ? 'typeA' : 'typeB';
      return 'sit';
    }
    return 'stand';
  }

  function drawActor(p) {
    const x = Math.round(p.x), y = Math.round(p.y);
    if (p.kind === 'cat') {
      const f = p.state === 'walk' ? (Math.floor(p.walkPx / 3) % 2 ? 'walkA' : 'walkB') : 'sit';
      const img = CAT_SPRITES[p.dir === 'left' ? 'left' : 'right'][f];
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.fillRect(x - 5, y - 1, 10, 2);
      ctx.drawImage(img, x - 6, y - 8);
      return;
    }
    const seated = p.state !== 'walk' && p.spot && p.spot.chair;
    if (seated) drawChair(x, y, p.dir, 'front');
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(x - 5, y - 1, 10, 2);
    ctx.fillRect(x - 4, y, 8, 1);
    const frame = frameFor(p);
    const bob = p.state === 'walk' && frame === 'stand' ? -1 : 0;
    const party = p.state === 'party' && Math.floor(animMs / 300 + p.idx) % 2 ? -1 : 0;
    const img = p.sprites[p.dir][frame] || p.sprites[p.dir].stand;
    ctx.drawImage(img, x - 6, y - 16 + bob + party + (seated && p.dir !== 'up' ? 1 : 0));
    if (seated && p.dir === 'up') drawChair(x, y, 'up', 'back');
    // 誕生日の主役は王冠
    const bd = activeEvent('birthday');
    if (bd && bd.honoree === p && p.state === 'party') {
      const cy = y - 17 + bob + party + (seated && p.dir !== 'up' ? 1 : 0);
      px(x - 3, cy, 7, 2, '#ffd23f');
      px(x - 3, cy - 2, 1, 2, '#ffd23f');
      px(x, cy - 2, 1, 2, '#ffd23f');
      px(x + 3, cy - 2, 1, 2, '#ffd23f');
      px(x, cy, 1, 1, '#d64541');
    }
  }

  // 吹き出し
  const ICONS = {
    chat: (x, y) => { [1, 4, 7].forEach((d) => px(x + d + 1, y + 3, 1, 1, '#2a2238')); },
    talk: (x, y) => { px(x + 2, y + 2, 6, 1, '#2e86de'); px(x + 2, y + 4, 4, 1, '#2e86de'); },
    coffee: (x, y) => { px(x + 3, y + 3, 4, 3, '#8b4a2b'); px(x + 7, y + 3, 1, 2, '#8b4a2b'); px(x + 4, y + 1, 1, 1, '#b0b0c0'); px(x + 5, y + 2, 1, 1, '#b0b0c0'); },
    print: (x, y) => { px(x + 3, y + 1, 5, 6, '#c8c8d4'); px(x + 4, y + 2, 3, 4, '#ffffff'); px(x + 4, y + 3, 3, 1, '#5a5a70'); },
    lunch: (x, y) => {
      px(x + 4, y, 2, 1, '#8a8aa0'); px(x + 3, y + 1, 4, 1, '#8a8aa0'); px(x + 2, y + 2, 6, 3, '#8a8aa0'); px(x + 1, y + 4, 8, 3, '#8a8aa0');
      px(x + 4, y + 1, 2, 1, '#f4f1e6'); px(x + 3, y + 2, 4, 2, '#f4f1e6'); px(x + 2, y + 4, 6, 2, '#f4f1e6'); px(x + 3, y + 5, 4, 2, '#2a2238');
    },
    idea: (x, y) => { px(x + 4, y + 1, 2, 3, '#e0a800'); px(x + 4, y + 5, 2, 1, '#e0a800'); },
    alarm: (x, y) => { px(x + 4, y + 1, 2, 3, '#e53935'); px(x + 4, y + 5, 2, 1, '#e53935'); },
    heart: (x, y) => { px(x + 2, y + 1, 2, 1, '#ff5d8f'); px(x + 6, y + 1, 2, 1, '#ff5d8f'); px(x + 1, y + 2, 8, 2, '#ff5d8f'); px(x + 2, y + 4, 6, 1, '#ff5d8f'); px(x + 3, y + 5, 4, 1, '#ff5d8f'); px(x + 4, y + 6, 2, 1, '#ff5d8f'); px(x + 2, y + 2, 1, 1, '#ffd0de'); },
    note: (x, y) => { px(x + 6, y + 1, 1, 5, '#7a4fd0'); px(x + 4, y + 5, 3, 2, '#7a4fd0'); px(x + 7, y + 1, 2, 1, '#7a4fd0'); },
    box: (x, y) => { px(x + 2, y + 2, 7, 5, '#c08a58'); px(x + 2, y + 2, 7, 1, '#dcab76'); px(x + 5, y + 2, 1, 5, '#8a5a34'); },
    star: (x, y) => { px(x + 4, y + 1, 2, 6, '#ffb400'); px(x + 2, y + 3, 6, 2, '#ffb400'); px(x + 3, y + 2, 4, 4, '#ffd23f'); },
  };

  function bubbleFor(p) {
    if (!p.present || p.state === 'walk') return null;
    if (p.kind === 'cat') return null;
    if (p.kind === 'courier') return p.state === 'deliver' && !(p.ev.receiver && p.ev.receiver.state === 'receive') ? 'box' : null;
    if (p.kind === 'visitor') return p.state === 'visit' && Math.floor(clock / 2) % 2 ? 'talk' : null;
    if (p.surprised > 0) return 'alarm';
    if (p.state === 'chat' || (p.state === 'work' && STAFF.some((o) => o.chatTarget === p && o.state === 'chat'))) return 'chat';
    if (p.state === 'coffee') return 'coffee';
    if (p.state === 'print') return 'print';
    if (p.state === 'lunch') return 'lunch';
    if (p.state === 'pet') return 'heart';
    if (p.state === 'receive') return 'box';
    if (p.state === 'party') return null; // 誕生日会は王冠と音符の演出で表す
    if (p.state === 'host') return Math.floor(clock / 2) % 2 ? null : 'talk';
    if (p.state === 'meeting') {
      const here = STAFF.filter((o) => o.present && o.state === 'meeting');
      return here[Math.floor(clock / 3) % here.length] === p ? 'talk' : null;
    }
    if (p.state === 'work') {
      const cat = npcs.find((n) => n.kind === 'cat' && n.present);
      if (cat && Math.abs(cat.x - p.x) + Math.abs(cat.y - p.y) < 40) return 'heart';
      if (p.idea > 0) return 'idea';
    }
    return null;
  }

  function drawBubble(p, type) {
    const x = Math.round(p.x) - 5, y = Math.max(1, Math.round(p.y) - 30);
    px(x, y, 11, 8, '#2a2238');
    px(x + 1, y - 1, 9, 10, '#2a2238');
    px(x + 1, y, 9, 8, '#ffffff');
    px(x + 4, y + 8, 2, 2, '#2a2238');
    px(x + 4, y + 8, 1, 1, '#ffffff');
    ICONS[type](x, y);
  }

  function drawLighting() {
    const h = clock / 60;
    let color = null;
    if (h < 8.6) color = 'rgba(255, 170, 120, 0.12)';
    else if (h >= 17 && h < 18) color = `rgba(255, 140, 60, ${((h - 17) * 0.18).toFixed(3)})`;
    else if (h >= 18) color = `rgba(20, 20, 70, ${Math.min(0.45, 0.18 + (h - 18) * 0.3).toFixed(3)})`;
    if (color) { ctx.fillStyle = color; ctx.fillRect(0, 0, W, H); }
    if (dark()) {
      ctx.fillStyle = 'rgba(8, 8, 24, 0.62)';
      ctx.fillRect(0, 0, W, H);
    }
    const drill = activeEvent('drill');
    if (drill && Math.floor(animMs / 350) % 2) { ctx.fillStyle = 'rgba(255, 40, 40, 0.13)'; ctx.fillRect(0, 0, W, H); }
  }

  function drawConfetti() {
    for (const c of confetti) px(c.x, c.y, 2, 1 + (Math.floor(c.life * 6) % 2), c.color);
    // 誕生日会：テーブルの上に音符が浮かぶ
    if (activeEvent('birthday')) {
      for (let i = 0; i < 3; i++) {
        const t = (animMs / 1200 + i / 3) % 1;
        const x = 14 * T + 2 + i * 6 + Math.round(Math.sin(t * 6 + i) * 2);
        const y = 8 * T - 4 - Math.round(t * 14);
        const col = ['#7a4fd0', '#ff5d8f', '#2e86de'][i];
        px(x + 2, y, 1, 4, col); px(x, y + 3, 3, 2, col); px(x + 3, y, 2, 1, col);
      }
    }
  }

  function render() {
    drawFloor();
    drawWalls();
    drawGlass();
    drawFurniture();
    const list = actors().filter((p) => p.present).sort((a, b) => a.y - b.y);
    list.forEach(drawActor);
    drawConfetti();
    drawLighting();
    list.forEach((p) => { const b = bubbleFor(p); if (b) drawBubble(p, b); });
    if (selected && selected.present) {
      const bob = Math.floor(animMs / 250) % 2;
      const x = Math.round(selected.x);
      const y = Math.max(0, Math.round(selected.y) - (bubbleFor(selected) ? 39 : 25) - bob);
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
      if (s === 'out') return activeEvent('drill') ? '避難中 → 出入口' : 'ランチへ外出中…';
      return `移動中 → ${p.spot.label}`;
    }
    switch (s) {
      case 'before': return '出勤前';
      case 'work': return STAFF.some((o) => o.chatTarget === p && o.state === 'chat') ? '雑談に付き合い中' : (dark() ? '停電で手が止まっている' : 'デスクで作業中');
      case 'coffee': return 'コーヒー休憩';
      case 'print': return 'コピー・印刷中';
      case 'chat': return `${p.chatTarget.name}さんと雑談中`;
      case 'meeting': return '会議中';
      case 'lunch': return `昼休み（${p.spot.label}）`;
      case 'out': return activeEvent('drill') ? '避難訓練で屋外に避難中' : 'ランチで外出中';
      case 'gone': return '退勤済み';
      case 'wait': return '待機中';
      case 'pet': return '猫をなでている';
      case 'party': { const bd = activeEvent('birthday'); return bd && bd.honoree === p ? '誕生日会の主役！' : '誕生日会に参加中'; }
      case 'host': return 'お客さまの対応中';
      case 'receive': return '荷物を受け取り中';
      default: return '';
    }
  }

  function phaseText() {
    const ex = events.find((e) => e.started && !e.ended && EVENT_DEFS[e.type].exclusive);
    if (ex) return EVENT_DEFS[ex.type].label;
    if (dark()) return '停電中';
    if (inMeeting()) return '会議中';
    if (clock >= LUNCH[0] && clock < LUNCH[1]) return '昼休み';
    if (clock < 9 * 60) return '始業前';
    if (clock >= LEAVE_START && STAFF.every((p) => p.state === 'gone')) return '終業後';
    if (clock >= LEAVE_START) return '退勤時間';
    return '業務中';
  }

  const list = $('staff');
  STAFF.forEach((p) => {
    const li = document.createElement('li');
    const face = document.createElement('canvas');
    face.width = 12; face.height = 11;
    face.className = 'face';
    face.getContext('2d').drawImage(p.sprites.down.stand, 0, 0);
    li.appendChild(face);
    li.insertAdjacentHTML('beforeend', `<span class="nm">${p.name}（${p.role}）</span><span class="st"></span>`);
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

  function renderPlan() {
    const ul = $('plan');
    const planned = events.filter((e) => PLANNED.includes(e.type));
    ul.innerHTML = planned.length
      ? planned.map((e) => `<li class="${e.ended ? 'done' : ''}">${fmt(e.start)} ${EVENT_DEFS[e.type].icon} ${EVENT_DEFS[e.type].label}</li>`).join('')
      : '<li class="none">予定なし（何か起きるかも…）</li>';
  }

  function renderLog() {
    $('log').innerHTML = eventLog.map((e) => `<li><time>D${e.day} ${fmt(e.time)}</time>${e.text}</li>`).join('');
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

  const evSelect = $('evSelect');
  Object.entries(EVENT_DEFS).forEach(([type, def]) => {
    evSelect.insertAdjacentHTML('beforeend', `<option value="${type}">${def.icon} ${def.label}</option>`);
  });
  $('evGo').addEventListener('click', () => triggerNow(evSelect.value));

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
    last = now;
    if (speed > 0) animMs += real * 1000;
    let sim = real * speed; // ゲーム内の分
    while (sim > 0) {        // 高速時も細かく刻んで更新
      const dt = Math.min(sim, 0.05);
      update(dt);
      sim -= dt;
    }
    if (speed > 0) {
      if (activeEvent('birthday') && Math.random() < real * 8) spawnConfetti();
      for (const c of confetti) { c.x += c.vx * real; c.y += c.vy * real; c.life -= real; }
      confetti = confetti.filter((c) => c.life > 0 && c.y < H);
    }
    if (bannerTimer > 0) {
      bannerTimer -= real;
      if (bannerTimer <= 0) $('banner').classList.add('hidden');
    }
    render();
    uiTick += real;
    if (uiTick > 0.1) { uiTick = 0; updateUI(); renderPlan(); }
    requestAnimationFrame(frame);
  }

  // テスト・デバッグ用（ブラウザのコンソールから時刻を進めたりイベントを起こしたりできる）
  window.office = {
    get clock() { return clock; },
    set clock(v) { clock = v; },
    get day() { return day; },
    get events() { return events; },
    get npcs() { return npcs; },
    get log() { return eventLog; },
    staff: STAFF,
    setSpeed(v) { speed = v; },
    trigger: triggerNow,
    step(minutes) { let m = minutes; while (m > 0) { const dt = Math.min(m, 0.05); update(dt); m -= dt; } render(); updateUI(); renderPlan(); },
  };

  scheduleDay();
  renderPlan();
  showBanner('Day 1');
  requestAnimationFrame(frame);
})();
