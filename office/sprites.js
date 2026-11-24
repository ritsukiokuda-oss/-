// ピクセル・オフィスのキャラクタードット絵（12x17）
// 体のテンプレートに髪型を重ね、自動で陰影を付けてから小さなキャンバスに焼き込む。
// 文字: O=輪郭 H=髪 h=髪ハイライト S=肌 s=肌の影 b=ほお E=目 C=服 c=服の影 A=アクセント(ネクタイ・帽子) P=ズボン F=靴 .=そのまま/透明
const OfficeSprites = (() => {
  'use strict';
  const OUTLINE = '#2a2238';

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const ch = [n >> 16, (n >> 8) & 255, n & 255].map((v) =>
      Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt))));
    return '#' + ch.map((v) => v.toString(16).padStart(2, '0')).join('');
  }

  // ---- 頭 ----
  const HEAD_FRONT = [
    '....OOOO....',
    '..OOSSSSOO..',
    '.OSSSSSSSSO.',
    '.OSSSSSSSSO.',
    '.OSSSSSSSSO.',
    '.OSSESSESSO.',
    '.OSSESSESSO.',
    '.ObSSSSSSbO.',
    '..OsSSSSsO..',
    '...OOssOO...',
  ];
  const HEAD_BACK = HEAD_FRONT.map((r) => r.replace(/[Eb]/g, 'S'));
  const HEAD_SIDE = [
    '....OOOO....',
    '..OOSSSSOO..',
    '.OSSSSSSSSO.',
    '.OSSSSSSSSO.',
    '.OSSSSSSSSO.',
    '.OSSSSSSESO.',
    '.OSSSSSSESO.',
    '.OSSSSSSSbO.',
    '..OsSSSSSO..',
    '...OOssOO...',
  ];

  // ---- 体（上3行＋足4行） ----
  const TORSO = {
    front: ['..OCCAACCO..', '.OCCCAACCCO.', '.OCOCAACOCO.'],
    back: ['..OCCCCCCO..', '.OCCCCCCCCO.', '.OCOCCCCOCO.'],
    side: ['...OCCCCO...', '...OCCCCO...', '...OCOCCO...'],
  };
  const LOWER = {
    front: {
      stand: ['.OSOCCCCOSO.', '..OPPPPPPO..', '..OPPOOPPO..', '..OFFOOFFO..'],
      walkA: ['.OSOCCCCOSO.', '..OPPPPPPO..', '..OPPOOFFO..', '..OFFO......'],
      walkB: ['.OSOCCCCOSO.', '..OPPPPPPO..', '..OFFOOPPO..', '......OFFO..'],
      sit: ['.OSOCCCCOSO.', '..OPPPPPPO..', '..OOOOOOOO..', '............'],
    },
    back: {
      stand: ['.OSOCCCCOSO.', '..OPPPPPPO..', '..OPPOOPPO..', '..OFFOOFFO..'],
      walkA: ['.OSOCCCCOSO.', '..OPPPPPPO..', '..OPPOOFFO..', '..OFFO......'],
      walkB: ['.OSOCCCCOSO.', '..OPPPPPPO..', '..OFFOOPPO..', '......OFFO..'],
      sit: ['.OSOCCCCOSO.', '..OPPPPPPO..', '............', '............'],
      typeA: ['..OOCCCCOO..', '..OPPPPPPO..', '............', '............'],
      typeB: ['.OSOCCCCOO..', '..OPPPPPPO..', '............', '............'],
    },
    side: {
      stand: ['...OCSCCO...', '...OPPPPO...', '...OPPPPO...', '...OFFFFO...'],
      walkA: ['...OCCSCO...', '...OPPPPO...', '..OPPOOPPO..', '.OFFO..OFFO.'],
      walkB: ['...OSCCCO...', '...OPPPPO...', '...OPPPPO...', '..OFFOFFO...'],
      sit: ['...OCSCCO...', '...OPPPPPO..', '...OOOOOOO..', '............'],
    },
  };

  // ---- 髪型（正面・横）。後ろ姿は正面から自動生成 ----
  const HAIR = {
    short: {
      front: ['...OOOOOO...', '..OHhhHHHO..', '.OHhHHHHHHO.', '.OHHHHHHHHO.', '.OH......HO.'],
      side: ['...OOOOOO...', '..OHhhHHHO..', '.OHhHHHHHHO.', '.OHHHHHHHHO.', '.OHHHHH..HO.', '.OHHH.......', '.OHH........', '.OHO........'],
      backRows: 7,
    },
    messy: {
      front: ['..OO.OO.OO..', '.OHHOHHOHHO.', '.OHhhHHHHHO.', '.OHHHHHHHHO.', '.OHH.HH..HO.'],
      side: ['..OO.OO.OO..', '.OHHOHHOHHO.', '.OHhhHHHHHO.', '.OHHHHHHHHO.', '.OHHHHH.H.O.', '.OHHH.......', '.OHH........', '.OHO........'],
      backRows: 7,
    },
    long: {
      front: ['...OOOOOO...', '..OHhhHHHO..', '.OHhHHHHHHO.', '.OHHHHHHHHO.', '.OHHH...HHO.', 'OHH......HHO', 'OHH......HHO', 'OHH......HHO', 'OHHO....OHHO', 'OHHO....OHHO', 'OHO......OHO', '.O........O.'],
      side: ['...OOOOOO...', '..OHhhHHHO..', '.OHhHHHHHHO.', '.OHHHHHHHHO.', '.OHHHHH..HO.', 'OHHHH.......', 'OHHHH.......', 'OHHHH.......', 'OHHHO.......', 'OHHO........', 'OHHO........', '.OO.........'],
      backRows: 11,
    },
    bob: {
      front: ['...OOOOOO...', '..OHhhHHHO..', '.OHhHHHHHHO.', '.OHHHHHHHHO.', '.OHHHHHHHHO.', 'OHH......HHO', 'OHH......HHO', 'OHHO....OHHO', '.OO......OO.'],
      side: ['...OOOOOO...', '..OHhhHHHO..', '.OHhHHHHHHO.', '.OHHHHHHHHO.', '.OHHHHHHHHO.', 'OHHHH.......', 'OHHHH.......', 'OHHHO.......', '.OOO........'],
      backRows: 8,
    },
    cap: {
      front: ['...OOOOOO...', '..OAAAAAAO..', '.OAAAAAAAAO.', '.OAAAAAAAAO.', 'OAAAAAAAAAAO', '.OH......HO.'],
      side: ['...OOOOOO...', '..OAAAAAAO..', '.OAAAAAAAAO.', '.OAAAAAAAAO.', '.OHAAAAAAAAA', '.OHH........', '.OHH........', '.OHO........'],
      backRows: 7,
    },
  };

  function overlay(base, top) {
    return base.map((row, y) => {
      const t = top[y];
      if (!t) return row;
      return [...row].map((ch, x) => (t[x] && t[x] !== '.' ? t[x] : ch)).join('');
    });
  }

  function backHair(style, base) {
    const h = HAIR[style];
    const rows = [];
    for (let y = 0; y <= h.backRows; y++) {
      const f = h.front[y] || '.'.repeat(12);
      rows.push([...f].map((ch, x) => {
        if (ch === 'O' && 'SsEbCA'.includes(base[y][x])) return style === 'cap' && y < 5 ? 'A' : 'H'; // 正面用の内側の輪郭は後ろ姿では髪にする
        if (ch !== '.') return ch === 'h' && y > 2 ? 'H' : ch;
        return 'SsEbCA'.includes(base[y][x]) ? (style === 'cap' && y < 5 ? 'A' : 'H') : '.';
      }).join(''));
      // 4行目より下は、左右の端だけ輪郭にして間を髪で埋める（正面用の内側の線を消す）
      if (y >= 4) {
        const merged = [...rows[y]].map((ch, x) => (ch !== '.' ? ch : base[y][x]));
        const l = merged.findIndex((ch) => ch !== '.');
        const r = merged.length - 1 - [...merged].reverse().findIndex((ch) => ch !== '.');
        const fill = style === 'cap' && y < 5 ? 'A' : 'H';
        rows[y] = merged.map((ch, x) => (x === l || x === r ? 'O' : x > l && x < r ? fill : '.')).join('');
      }
    }
    return rows;
  }

  // 右側の輪郭の内側に影を付ける
  function autoShade(rows) {
    return rows.map((row) => {
      const a = [...row];
      for (let x = 1; x < a.length; x++) {
        if (a[x] === 'O' && a[x - 1] === 'C') a[x - 1] = 'c';
        if (a[x] === 'O' && a[x - 1] === 'S' && x > 6) a[x - 1] = 's';
      }
      return a.join('');
    });
  }

  function compose(view, frame, style) {
    const head = view === 'front' ? HEAD_FRONT : view === 'back' ? HEAD_BACK : HEAD_SIDE;
    let rows = [...head, ...TORSO[view], ...LOWER[view][frame]];
    if (view === 'front') rows = overlay(rows, HAIR[style].front);
    else if (view === 'side') rows = overlay(rows, HAIR[style].side);
    else rows = overlay(rows, backHair(style, rows));
    return autoShade(rows);
  }

  function paint(rows, colors, flip) {
    const w = rows[0].length, h = rows.length;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch === '.' || !colors[ch]) return;
      ctx.fillStyle = colors[ch];
      ctx.fillRect(flip ? w - 1 - x : x, y, 1, 1);
    }));
    return cv;
  }

  function build(look) {
    const colors = {
      O: OUTLINE, H: look.hair, h: shade(look.hair, 0.35),
      S: look.skin, s: shade(look.skin, -0.13), b: '#f0a08c', E: OUTLINE,
      C: look.shirt, c: shade(look.shirt, -0.22), A: look.accent,
      P: look.pants, F: look.shoes || '#4a3428',
    };
    const out = { down: {}, up: {}, right: {}, left: {} };
    for (const f of Object.keys(LOWER.front)) out.down[f] = paint(compose('front', f, look.style), colors);
    for (const f of Object.keys(LOWER.back)) out.up[f] = paint(compose('back', f, look.style), colors);
    for (const f of Object.keys(LOWER.side)) {
      const rows = compose('side', f, look.style);
      out.right[f] = paint(rows, colors, false);
      out.left[f] = paint(rows, colors, true);
    }
    return out;
  }

  // ---- 猫（輪郭は自動） ----
  const CAT = {
    walkA: ['......K..K', '......KKKK', 'K.....KEKE', 'K.....KKPK', '.KKKKKKKK.', '.KkKkKKKK.', '.K.K..K.K.'],
    walkB: ['......K..K', '......KKKK', 'K.....KEKE', 'K.....KKPK', '.KKKKKKKK.', '.KkKkKKKK.', 'K.K....KK.'],
    sit: ['......K..K', '......KKKK', '......KEKE', '......KKPK', '..KKKKKKK.', 'K.KkKkKKK.', 'KKKKKKKKK.'],
  };
  function buildCat() {
    const colors = { K: '#e8963e', k: '#b8682a', E: OUTLINE, P: '#f28aa0' };
    const res = { right: {}, left: {} };
    for (const [f, rows] of Object.entries(CAT)) {
      // 1px の輪郭を付けて 12x9 にする
      const w = rows[0].length + 2, h = rows.length + 2;
      const grid = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => (rows[y - 1] && rows[y - 1][x - 1]) || '.'));
      const outlined = grid.map((row, y) => row.map((ch, x) => {
        if (ch !== '.') return ch;
        const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => grid[y + dy] && grid[y + dy][x + dx] && grid[y + dy][x + dx] !== '.');
        return n ? 'O' : '.';
      }).join(''));
      colors.O = OUTLINE;
      res.right[f] = paint(outlined, colors, false);
      res.left[f] = paint(outlined, colors, true);
    }
    return res;
  }

  return { build, buildCat, shade };
})();
