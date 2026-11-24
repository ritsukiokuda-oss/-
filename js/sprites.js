// オリジナルのドット絵キャラクター（12x16 ピクセル、右向き）
// 1文字 = 1ピクセル。"." は透明。
const PALETTE = {
  K: '#1b1b2f', // 輪郭
  H: '#e43b44', // 帽子
  h: '#ff7a7f', // 帽子ハイライト
  S: '#f6c49a', // 肌
  W: '#ffffff', // 白目
  B: '#3a7bd5', // 服
  b: '#6fa8ff', // 服ハイライト
  P: '#3c3c5c', // ズボン
  E: '#8b4a2b', // 靴
};

const HEAD = [
  '...KKKKKK...',
  '..KHhhHHHK..',
  '.KHhHHHHHHK.',
  '.KHHHHHHHHHK',
  '.KSSSSWKSK..',
  '.KSSSSWKSSK.',
  '.KSSSSSSSSK.',
  '..KSSSSSSK..',
];
const BODY = [
  '..KBbBBBBK..',
  '.KBbBBBBBBK.',
];
const ARMS_DOWN = [
  '.KBBBBBBBBK.',
  '.KSBBBBBBSK.',
];
const ARMS_UP = [
  'KSKBBBBBBKSK',
  '.K.KBBBBK.K.',
];

const LEGS = {
  stand: [
    '..KPPPPPPK..',
    '..KPPKKPPK..',
    '..KPK..KPK..',
    '..KEEK.KEEK.',
  ],
  stride: [
    '..KPPPPPPK..',
    '.KPPK..KPPK.',
    '.KPK....KPK.',
    'KEEK....KEEK',
  ],
  pass: [
    '..KPPPPPPK..',
    '...KPPPPK...',
    '...KPKKPK...',
    '...KEEKEEK..',
  ],
  jump: [
    '..KPPPPPPK..',
    '.KPPK..KPPK.',
    'KEEK...KPK..',
    '.......KEEK.',
  ],
};

function blink(rows) {
  return rows.map((r, i) => (i === 4 || i === 5 ? r.replace('WK', 'KK') : r));
}

const FRAME_DATA = {
  idle: [...HEAD, ...BODY, ...ARMS_DOWN, ...LEGS.stand],
  blink: blink([...HEAD, ...BODY, ...ARMS_DOWN, ...LEGS.stand]),
  walk1: [...HEAD, ...BODY, ...ARMS_DOWN, ...LEGS.stride],
  walk2: [...HEAD, ...BODY, ...ARMS_DOWN, ...LEGS.pass],
  jump: [...HEAD, ...BODY, ...ARMS_UP, ...LEGS.jump],
};

// 各フレームを右向き・左向きの小さなキャンバスに描いておく
function buildSprite(rows) {
  const w = rows[0].length;
  const h = rows.length;
  const right = document.createElement('canvas');
  right.width = w;
  right.height = h;
  const ctx = right.getContext('2d');
  rows.forEach((row, y) => {
    if (row.length !== w) throw new Error(`sprite row ${y} has width ${row.length}, expected ${w}`);
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      ctx.fillStyle = PALETTE[ch];
      ctx.fillRect(x, y, 1, 1);
    });
  });
  const left = document.createElement('canvas');
  left.width = w;
  left.height = h;
  const lctx = left.getContext('2d');
  lctx.translate(w, 0);
  lctx.scale(-1, 1);
  lctx.drawImage(right, 0, 0);
  return { right, left, w, h };
}

const SPRITES = Object.fromEntries(
  Object.entries(FRAME_DATA).map(([name, rows]) => [name, buildSprite(rows)])
);
