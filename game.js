/* =========================================================================
   ぴよまるパックン  —  game.js
   ・28 x 31 タイルの迷路をタイル中心グラフ上で移動する方式
   ・おばけは本家と同じ 4 体の性格 (追跡 / 待ちぶせ / 挟撃 / 気まぐれ) を持つ
   ========================================================================= */
(() => {
'use strict';

/* =========================================================================
   1. 迷路データ
   ========================================================================= */

const COLS = 28;
const ROWS = 31;
const TILE = 24;
const W = COLS * TILE;   // 672
const H = ROWS * TILE;   // 744

const TUNNEL_ROW = 14;           // 左右がつながる行
const HOUSE_ENTRY = { x: 13, y: 11 };  // 巣の出入口 (通路側)
const HOUSE_COL_X = 13.5;        // 巣から出入りするときの縦ライン
const HOUSE_INNER_Y = 14.5;      // 巣の中の待機ライン
const HOUSE_RECT = { x: 10, y: 12, w: 8, h: 5 };  // nest.png を描く範囲
const PAC_START = { x: 13, y: 23 };

const T = { WALL: 0, PATH: 1, DOOR: 2, HOUSE: 3 };

/* ---------- 迷路の生成 ----------------------------------------------------
   9〜19 行目は固定。おばけの巣・扉・トンネル・左右の抜け道がここに収まって
   いて、ここを崩すと おばけが巣から出られなくなるため触らない。
   その上 (1〜8 行) と下 (20〜29 行) を毎ステージ作り直す。
   格子の交点を結ぶ辺を「連結を保ったまま・行き止まりを作らない」範囲で
   ランダムに間引くので、生成結果は必ず遊べる形になる。
-------------------------------------------------------------------------- */

const BAND_TOP = 9;
const BAND = [
  '######.##### ## #####.######',   //  9
  '     #.##### ## #####.#     ',   // 10
  '     #.##          ##.#     ',   // 11
  '     #.## ###--### ##.#     ',   // 12
  '######.## #HHHHHH# ##.######',   // 13
  '          #HHHHHH#          ',   // 14  トンネル
  '######.## #HHHHHH# ##.######',   // 15
  '     #.## ######## ##.#     ',   // 16
  '     #.##          ##.#     ',   // 17
  '     #.## ######## ##.#     ',   // 18
  '######.## ######## ##.######',   // 19
];

// 格子の縦線。左右対称 (x ↔ 27-x) になる並びを選んである
const NODE_COLS = [1, 4, 6, 9, 12, 15, 18, 21, 23, 26];
const TOP_ROWS = [1, 5, 8];          // 固定帯の上
const BOT_ROWS = [20, 23, 26, 29];   // 固定帯の下

const POWER_SPOTS = [
  { x: 1, y: 5 }, { x: 26, y: 5 }, { x: 1, y: 23 }, { x: 26, y: 23 },
];

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 格子の辺を間引く。left/right が対になるよう必ず 2 本ずつ扱う
function genRegion(nodeRows, keep) {
  const NC = NODE_COLS.length;
  const NR = nodeRows.length;
  const h = [];   // h[r][i] : 縦線 i と i+1 を r 行でつなぐ
  const v = [];   // v[r][i] : 横線 r と r+1 を i 列でつなぐ
  for (let r = 0; r < NR; r++) h.push(new Array(NC - 1).fill(true));
  for (let r = 0; r < NR - 1; r++) v.push(new Array(NC).fill(true));

  const pairs = [];
  for (let r = 0; r < NR; r++) {
    for (let i = 0; i < NC - 1; i++) {
      const j = NC - 2 - i;
      if (j < i) continue;
      pairs.push(i === j ? [['h', r, i]] : [['h', r, i], ['h', r, j]]);
    }
  }
  for (let r = 0; r < NR - 1; r++) {
    for (let i = 0; i < NC; i++) {
      const j = NC - 1 - i;
      if (j < i) continue;
      pairs.push(i === j ? [['v', r, i]] : [['v', r, i], ['v', r, j]]);
    }
  }
  shuffle(pairs);

  const grids = { h, v };
  const set = (t, r, i, val) => { grids[t][r][i] = val; };

  const degree = (r, i) => {
    let d = 0;
    if (i > 0 && h[r][i - 1]) d++;
    if (i < NC - 1 && h[r][i]) d++;
    if (r > 0 && v[r - 1][i]) d++;
    if (r < NR - 1 && v[r][i]) d++;
    return d;
  };

  const noDeadEnd = () => {
    for (let r = 0; r < NR; r++) {
      for (let i = 0; i < NC; i++) if (degree(r, i) < 2) return false;
    }
    return true;
  };

  const connected = () => {
    const seen = new Uint8Array(NR * NC);
    const stack = [0];
    seen[0] = 1;
    let n = 1;
    while (stack.length) {
      const id = stack.pop();
      const r = (id / NC) | 0, i = id % NC;
      const push = nid => { if (!seen[nid]) { seen[nid] = 1; n++; stack.push(nid); } };
      if (i > 0 && h[r][i - 1]) push(id - 1);
      if (i < NC - 1 && h[r][i]) push(id + 1);
      if (r > 0 && v[r - 1][i]) push(id - NC);
      if (r < NR - 1 && v[r][i]) push(id + NC);
    }
    return n === NR * NC;
  };

  for (const pair of pairs) {
    if (pair.some(([t, r, i]) => keep(t, r, i))) continue;
    pair.forEach(([t, r, i]) => set(t, r, i, false));
    if (!noDeadEnd() || !connected()) pair.forEach(([t, r, i]) => set(t, r, i, true));
  }
  return { h, v };
}

function carveRegion(rows, nodeRows, eg) {
  const NC = NODE_COLS.length;
  const open = (x, y) => { rows[y][x] = ' '; };
  for (let r = 0; r < nodeRows.length; r++) {
    for (let i = 0; i < NC; i++) open(NODE_COLS[i], nodeRows[r]);
  }
  for (let r = 0; r < nodeRows.length; r++) {
    for (let i = 0; i < NC - 1; i++) {
      if (!eg.h[r][i]) continue;
      for (let x = NODE_COLS[i]; x <= NODE_COLS[i + 1]; x++) open(x, nodeRows[r]);
    }
  }
  for (let r = 0; r < nodeRows.length - 1; r++) {
    for (let i = 0; i < NC; i++) {
      if (!eg.v[r][i]) continue;
      for (let y = nodeRows[r]; y <= nodeRows[r + 1]; y++) open(NODE_COLS[i], y);
    }
  }
}

function genMaze() {
  const rows = [];
  for (let y = 0; y < ROWS; y++) rows.push(new Array(COLS).fill('#'));
  for (let y = 0; y < BAND.length; y++) {
    for (let x = 0; x < COLS; x++) rows[BAND_TOP + y][x] = BAND[y][x];
  }
  // ぴよまるの出発点 (13,23) を必ず通路にするため、23 行の中央の辺は残す
  const keepStart = (t, r, i) => t === 'h' && r === 1 && NODE_COLS[i] === 12;
  carveRegion(rows, TOP_ROWS, genRegion(TOP_ROWS, () => false));
  carveRegion(rows, BOT_ROWS, genRegion(BOT_ROWS, keepStart));
  return rows.map(r => r.join(''));
}

/* ---------- 盤面の状態 ---------- */

let grid = [];         // 地形
let pellets = [];      // 0 なし / 1 エサ / 2 パワーエサ
let totalPellets = 0;
let OPEN_TILES = [];   // 到達できる通路タイル (ぶらぶら歩き・アイテム配置に使う)
let PELLET_TILES = []; // そのうちエサを置いてよいタイル

function tileType(x, y) {
  if (y === TUNNEL_ROW && (x < 0 || x >= COLS)) return T.PATH;   // トンネル
  if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return T.WALL;
  return grid[y][x];
}

const isOpen = (x, y) => tileType(x, y) === T.PATH;
const randomTile = () => OPEN_TILES[(Math.random() * OPEN_TILES.length) | 0];

// 巣のまわりとトンネルにはエサを置かない
const noPelletZone = (x, y) =>
  y === TUNNEL_ROW || (y >= 9 && y <= 19 && x >= 9 && x <= 18);

// ぴよまるの出発点から届くタイルだけを拾う。
// 生成の都合でできる閉じた隙間にエサが残ると クリア不能になるため必須
function reachableFrom(start) {
  const seen = [];
  for (let y = 0; y < ROWS; y++) seen.push(new Uint8Array(COLS));
  const stack = [start];
  seen[start.y][start.x] = 1;
  const tiles = [];
  while (stack.length) {
    const t = stack.pop();
    tiles.push(t);
    for (const d of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      let nx = t.x + d[0];
      const ny = t.y + d[1];
      if (nx < 0) nx += COLS; else if (nx >= COLS) nx -= COLS;
      if (ny < 0 || ny >= ROWS) continue;
      if (!isOpen(nx, ny) || seen[ny][nx]) continue;
      seen[ny][nx] = 1;
      stack.push({ x: nx, y: ny });
    }
  }
  return tiles;
}

function applyMaze(rows) {
  grid = [];
  for (let y = 0; y < ROWS; y++) {
    grid[y] = [];
    for (let x = 0; x < COLS; x++) {
      const c = rows[y][x];
      grid[y][x] = c === '#' ? T.WALL : c === '-' ? T.DOOR : c === 'H' ? T.HOUSE : T.PATH;
    }
  }
  OPEN_TILES = reachableFrom(PAC_START);
  PELLET_TILES = OPEN_TILES.filter(t =>
    !noPelletZone(t.x, t.y) && !(t.x === PAC_START.x && t.y === PAC_START.y));
}

// 巣の出入口まで行けて、エサを置ける場所が十分にあるかを確かめる
function mazeIsPlayable() {
  if (!OPEN_TILES.some(t => t.x === HOUSE_ENTRY.x && t.y === HOUSE_ENTRY.y)) return false;
  if (!isOpen(PAC_START.x, PAC_START.y)) return false;
  for (const p of POWER_SPOTS) {
    if (!OPEN_TILES.some(t => t.x === p.x && t.y === p.y)) return false;
  }
  return PELLET_TILES.length >= 150;
}

function newMaze() {
  for (let i = 0; i < 40; i++) {
    applyMaze(genMaze());
    if (mazeIsPlayable()) return;
  }
  // 念のための保険。ここに来ることはまずない
  applyMaze(genMaze());
}

function buildPellets() {
  pellets = [];
  for (let y = 0; y < ROWS; y++) pellets[y] = new Array(COLS).fill(0);
  totalPellets = 0;
  for (const t of PELLET_TILES) {
    pellets[t.y][t.x] = 1;
    totalPellets++;
  }
  for (const p of POWER_SPOTS) {
    if (pellets[p.y][p.x] === 1) pellets[p.y][p.x] = 2;
  }
}

/* =========================================================================
   2. 画像の読み込み
   ========================================================================= */

const IMG_NAMES = [
  'piyomaru-up-open', 'piyomaru-up-closed',
  'piyomaru-down-open', 'piyomaru-down-closed',
  'piyomaru-left-open', 'piyomaru-left-closed',
  'piyomaru-right-open', 'piyomaru-right-closed',
  'chaser-moko', 'chaser-mimiko', 'chaser-pote', 'chaser-kuron',
  'chaser-scared', 'chaser-eyes-only',
  'item-dot', 'item-cherry', 'item-mikan', 'item-grape', 'item-daifuku',
  'nest',
];

// たべものの効果で使う差し替えキャラ (png/new)
const MINI_COLORS = ['peach', 'mint', 'cream', 'lilac'];
const NEW_NAMES = ['piyomaru-black', 'piyomaru-black-left'];
for (const c of MINI_COLORS) {
  for (const d of ['up', 'down', 'left', 'right']) {
    for (const m of ['open', 'closed']) NEW_NAMES.push(`mini-${c}-${d}-${m}`);
  }
}
for (const d of ['up', 'down', 'left', 'right']) {
  for (const m of ['open', 'closed']) NEW_NAMES.push(`pink-${d}-${m}`);
}

const IMG = {};

function loadOne(key, src) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = img.onerror = () => { IMG[key] = img; resolve(); };
    img.src = src;
  });
}

function loadImages() {
  return Promise.all([
    ...IMG_NAMES.map(n => loadOne(n, `png/${n}.png`)),
    ...NEW_NAMES.map(n => loadOne(n, `png/new/${n}.png`)),
  ]);
}

// 元画像のアルファを保ったまま白寄りに色を乗せる (パワー切れ間際の点滅用)
function makeTinted(img, color, alpha) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth || 1;
  c.height = img.naturalHeight || 1;
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  x.globalCompositeOperation = 'source-atop';
  x.globalAlpha = alpha;
  x.fillStyle = color;
  x.fillRect(0, 0, c.width, c.height);
  return c;
}

/* =========================================================================
   3. レベルごとのパラメータ
   ========================================================================= */

const BASE_SPEED = 9.5;   // 100% のときのタイル/秒

const FRIGHT_TIME = [6, 5, 4, 3, 2, 5, 2, 2, 1, 5, 2, 1, 1, 3, 1, 1, 0, 1, 0, 0, 0];

// たべもの。ステージ 1 から 4 種類すべてが出る。どれが出るかは毎回ランダム
const EFFECT_TIME = 5;   // どの効果も 5 秒

const FRUIT_KINDS = [
  { id: 'daifuku', img: 'item-daifuku', pts: 700, label: 'いちご大福',
    note: 'ミニぴよまる とうじょう!' },
  { id: 'cherry',  img: 'item-cherry',  pts: 300, label: 'さくらんぼ',
    note: 'スコア 3ばい!' },
  { id: 'mikan',   img: 'item-mikan',   pts: 400, label: 'みかん',
    note: 'すきとおって みんなまよう!' },
  { id: 'grape',   img: 'item-grape',   pts: 500, label: 'ぶどう',
    note: 'ブラックぴよまるが つかまえた!' },
];

const randomFruitKind = () => FRUIT_KINDS[(Math.random() * FRUIT_KINDS.length) | 0];

/* ---------- むずかしさ ---------- */

const DIFFICULTY = {
  easy: {
    label: 'やさしい', chasers: 3, ghost: 0.74, pac: 1.06,
    fright: 1.8, frightMin: 6, confuse: 7.0, lives: 5,
    release: 2.0, idle: 8, elroy: 0, scatter: 1.6,
  },
  normal: {
    label: 'ふつう', chasers: 4, ghost: 0.88, pac: 1.02,
    fright: 1.3, frightMin: 4, confuse: 5.0, lives: 4,
    release: 1.5, idle: 6, elroy: 0.5, scatter: 1.25,
  },
  hard: {
    label: 'むずかしい', chasers: 4, ghost: 1.00, pac: 1.00,
    fright: 1.0, frightMin: 0, confuse: 3.5, lives: 3,
    release: 1.0, idle: 4, elroy: 1, scatter: 1.0,
  },
};

let difficulty = 'normal';
const D = () => DIFFICULTY[difficulty];

function levelSpec(L) {
  const d = D();
  const baseFright = FRIGHT_TIME[Math.min(L - 1, FRIGHT_TIME.length - 1)];
  return {
    pac:        (L === 1 ? 0.80 : L < 5 ? 0.90 : L < 21 ? 1.00 : 0.90) * d.pac,
    pacFright:  (L === 1 ? 0.90 : L < 5 ? 0.95 : 1.00) * d.pac,
    ghost:      (L === 1 ? 0.75 : L < 5 ? 0.85 : 0.95) * d.ghost,
    ghostFright:(L === 1 ? 0.50 : L < 5 ? 0.55 : 0.60) * d.ghost,
    tunnel:     (L === 1 ? 0.40 : L < 5 ? 0.45 : 0.50) * d.ghost,
    fright:     Math.max(baseFright * d.fright, d.frightMin),
    confuse:    d.confuse,
  };
}

// スキャッター / チェイスの切り替えスケジュール (秒)
// やさしいほど「散らばる」時間が長く、「追う」時間が短くなる
function schedule(L) {
  const s = D().scatter;
  const raw =
    L === 1 ? [[7, 'scatter'], [20, 'chase'], [7, 'scatter'], [20, 'chase'],
               [5, 'scatter'], [20, 'chase'], [5, 'scatter'], [Infinity, 'chase']]
  : L < 5   ? [[7, 'scatter'], [20, 'chase'], [7, 'scatter'], [20, 'chase'],
               [5, 'scatter'], [1033, 'chase'], [0.02, 'scatter'], [Infinity, 'chase']]
            : [[5, 'scatter'], [20, 'chase'], [5, 'scatter'], [20, 'chase'],
               [5, 'scatter'], [1037, 'chase'], [0.02, 'scatter'], [Infinity, 'chase']];
  return raw.map(([dur, m]) => [m === 'scatter' ? dur * s : dur / s, m]);
}

/* =========================================================================
   4. 迷路の描画キャッシュ
   ========================================================================= */

const CSS = getComputedStyle(document.documentElement);
const token = n => CSS.getPropertyValue(n).trim();

const C_WALL = token('--color-wall') || '#A5CFC2';
const C_WALL_LIGHT = token('--color-wall-light') || '#C6DFD7';
const C_MAZE_BG = token('--color-maze-bg') || '#FDFBF8';
const C_TEXT = token('--color-text-primary') || '#5A6560';
const C_PRIMARY = token('--color-primary') || '#F1AAA0';
const C_ACCENT_DARK = token('--color-accent-dark') || '#E8D78F';
const FONT = '"M PLUS Rounded 1c", "Zen Maru Gothic", sans-serif';

// 角ごとに半径を指定できる矩形パス
function roundRectPath(ctx, x, y, w, h, r) {
  const [tl, tr, br, bl] = r;
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  if (tr) ctx.arcTo(x + w, y, x + w, y + tr, tr);
  ctx.lineTo(x + w, y + h - br);
  if (br) ctx.arcTo(x + w, y + h, x + w - br, y + h, br);
  ctx.lineTo(x + bl, y + h);
  if (bl) ctx.arcTo(x, y + h, x, y + h - bl, bl);
  ctx.lineTo(x, y + tl);
  if (tl) ctx.arcTo(x, y, x + tl, y, tl);
  ctx.closePath();
}

// 巣の枠は nest.png で描くので、そこはタイル描画から外す
function isNestFrame(x, y) {
  return x >= HOUSE_RECT.x && x < HOUSE_RECT.x + HOUSE_RECT.w &&
         y >= HOUSE_RECT.y && y < HOUSE_RECT.y + HOUSE_RECT.h;
}

function wallPath() {
  const r = TILE * 0.46;
  const wallAt = (x, y) => tileType(x, y) === T.WALL && !isNestFrame(x, y);
  const path = new Path2D();
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (!wallAt(x, y)) continue;
      const n = wallAt(x, y - 1), s = wallAt(x, y + 1);
      const w = wallAt(x - 1, y), e = wallAt(x + 1, y);
      // 隣が壁の側は 0.5px はみ出させて継ぎ目を消す
      const x0 = x * TILE - (w ? 0.5 : 0);
      const y0 = y * TILE - (n ? 0.5 : 0);
      const x1 = (x + 1) * TILE + (e ? 0.5 : 0);
      const y1 = (y + 1) * TILE + (s ? 0.5 : 0);
      roundRectPath(path, x0, y0, x1 - x0, y1 - y0, [
        !n && !w ? r : 0,
        !n && !e ? r : 0,
        !s && !e ? r : 0,
        !s && !w ? r : 0,
      ]);
    }
  }
  return path;
}

function renderMaze(color) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const path = wallPath();

  // 壁全体を明るい色で塗り、同じ形を 2.5px 下にずらして本色を乗せると
  // 上端にだけ細いハイライトが残る (提供素材の壁と同じ質感)
  g.fillStyle = C_WALL_LIGHT;
  g.fill(path);

  g.save();
  g.clip(path);
  g.translate(0, 2.5);
  g.fillStyle = color;
  g.fill(path);
  g.restore();

  return c;
}

let mazeCanvas = null;
let mazeCanvasFlash = null;

function rebuildMazeArt() {
  mazeCanvas = renderMaze(C_WALL);
  mazeCanvasFlash = renderMaze(token('--color-accent') || '#F7E7A8');
}

/* =========================================================================
   5. アクター
   ========================================================================= */

const DIRS = {
  up:    { x: 0, y: -1 },
  left:  { x: -1, y: 0 },
  down:  { x: 0, y: 1 },
  right: { x: 1, y: 0 },
};
// 同点のときの優先順位 (本家と同じ 上 → 左 → 下 → 右)
const DIR_ORDER = [DIRS.up, DIRS.left, DIRS.down, DIRS.right];

function syncPos(a) {
  a.x = a.from.x + (a.to.x - a.from.x) * a.prog + 0.5;
  a.y = a.from.y + (a.to.y - a.from.y) * a.prog + 0.5;
}

function setTile(a, tx, ty, dir) {
  a.from = { x: tx, y: ty };
  a.to = { x: tx, y: ty };
  a.prog = 0;
  a.stopped = true;
  a.dir = dir || DIRS.left;
  syncPos(a);
}

// タイル中心から中心へ 1 区間ずつ進める。区間の終わりで onArrive が次の向きを決める
function graphStep(a, dist) {
  let guard = 0;
  while (dist > 1e-9 && guard++ < 64) {
    if (a.stopped) {
      a.onArrive();
      if (a.stopped) break;
    }
    const rem = 1 - a.prog;
    if (dist >= rem) {
      dist -= rem;
      const nx = a.to.x < 0 ? a.to.x + COLS : a.to.x >= COLS ? a.to.x - COLS : a.to.x;
      a.from = { x: nx, y: a.to.y };
      a.to = { x: nx, y: a.to.y };
      a.prog = 0;
      a.stopped = true;
      a.onArrive();
      if (a.stopped) break;
    } else {
      a.prog += dist;
      dist = 0;
    }
  }
  syncPos(a);
}

// 進行中でも反転だけは即座に許す (本家と同じ操作感)
function reverse(a) {
  if (a.stopped) return;
  const f = a.from;
  a.from = a.to;
  a.to = f;
  a.prog = 1 - a.prog;
  a.dir = { x: -a.dir.x, y: -a.dir.y };
}

const tileOf = a => ({ x: Math.floor(a.x), y: Math.floor(a.y) });

/* ---------- ぴよまる ---------- */

const pac = {
  from: { x: 0, y: 0 }, to: { x: 0, y: 0 }, prog: 0, stopped: true,
  dir: DIRS.left, want: null, x: 0, y: 0, anim: 0,
  onArrive() {
    const t = this.from;
    if (this.want && isOpen(t.x + this.want.x, t.y + this.want.y)) {
      this.dir = this.want;
      this.want = null;
    }
    if (isOpen(t.x + this.dir.x, t.y + this.dir.y)) {
      this.to = { x: t.x + this.dir.x, y: t.y + this.dir.y };
      this.stopped = false;
    }
    eatAt(t.x, t.y);
  },
};

function resetPac() {
  setTile(pac, PAC_START.x, PAC_START.y, DIRS.left);
  pac.want = null;
  pac.anim = 0;
}

/* ---------- おばけ ---------- */

// brain: speed  … 足の速さ (もこを 1.00 とした比)
//        whim   … 分かれ道でとつぜん気が変わる確率
//        chaseP … 気分が切り替わるとき「追う気」になる確率
//        span   … 気分がつづく秒数の範囲
function makeGhost(id, name, img, scatter, releaseDots, homeX, brain) {
  return {
    id, name, img, scatter, releaseDots, baseRelease: releaseDots, homeX,
    speed: brain.speed, whim: brain.whim, chaseP: brain.chaseP, span: brain.span,
    from: { x: 0, y: 0 }, to: { x: 0, y: 0 }, prog: 0, stopped: true,
    dir: DIRS.left, x: 0, y: 0,
    state: 'home',        // home | exit | graph | enter
    fright: false, eaten: false, inPlay: true, bound: 0,
    chasing: true, mood: 0, roam: { x: 13, y: 11 },
    path: [], wait: 0, bob: Math.random() * 6,
    onArrive() { ghostDecide(this); },
  };
}

const ghosts = [
  // もこ: まっすぐおいかける。いちばん速く、よそ見をしない
  makeGhost('moko',   'もこ',   'chaser-moko',   { x: 25, y: 0 },  -1, 13.5,
    { speed: 1.00, whim: 0.00, chaseP: 1.00, span: [9, 9] }),
  // みみこ: ゆっくり先回りする。足は遅いが 4 マス先に回りこむ
  makeGhost('mimiko', 'みみこ', 'chaser-mimiko', { x: 2,  y: 0 },   0, 13.5,
    { speed: 0.80, whim: 0.00, chaseP: 1.00, span: [9, 9] }),
  // ぽて: のんびり歩く。とても遅く、たいていはぶらぶらしている
  makeGhost('pote',   'ぽて',   'chaser-pote',   { x: 27, y: 30 }, 30, 11.5,
    { speed: 0.64, whim: 0.22, chaseP: 0.35, span: [4, 7] }),
  // くろん: 気まぐれに動く。分かれ道でよく気が変わる
  makeGhost('kuron',  'くろん', 'chaser-kuron',  { x: 0,  y: 30 }, 60, 15.5,
    { speed: 0.92, whim: 0.55, chaseP: 0.50, span: [1.5, 3.5] }),
];

function resetGhosts() {
  const d = D();
  ghosts.forEach((g, i) => {
    g.fright = false;
    g.eaten = false;
    g.path = [];
    g.wait = 0;
    g.bob = i * 1.7;
    g.chasing = true;
    g.mood = 0;
    g.bound = 0;
    g.roam = randomTile();
    g.inPlay = i < d.chasers;           // やさしいモードでは 4 人目はお休み
    g.releaseDots = g.baseRelease < 0 ? -1 : Math.round(g.baseRelease * d.release);
    if (g.inPlay && g.releaseDots < 0) {
      // もこだけは最初から巣の外
      g.state = 'graph';
      setTile(g, HOUSE_ENTRY.x, HOUSE_ENTRY.y, DIRS.left);
    } else {
      g.state = 'home';
      g.x = g.homeX;
      g.y = HOUSE_INNER_Y;
      g.dir = DIRS.up;
    }
  });
}

// 性格ごとの追いかけ先
function personalityTarget(g) {
  const p = tileOf(pac);
  if (g.id === 'mimiko') {
    // ゆっくり先回りする: 進行方向の 4 マス先に回りこむ
    const d = pac.dir;
    return { x: p.x + d.x * 4, y: p.y + d.y * 4 };
  }
  // もこはまっすぐ。ぽて・くろんも「追う気」のときはまっすぐ向かう
  return p;
}

// 気分の切り替え。ぽては「のんびり」、くろんは「気まぐれ」に見える
function updateMood(g, dt) {
  g.mood -= dt;
  if (g.mood > 0) return;
  const [lo, hi] = g.span;
  g.mood = lo + Math.random() * (hi - lo);
  g.chasing = Math.random() < g.chaseP;
  g.roam = randomTile();
}

function ghostDecide(g) {
  const t = g.from;

  // 目玉だけになって巣の入口まで戻ってきた
  if (g.eaten && t.x === HOUSE_ENTRY.x && t.y === HOUSE_ENTRY.y) {
    g.state = 'enter';
    g.path = [
      { x: HOUSE_COL_X, y: HOUSE_INNER_Y },
      { x: g.homeX, y: HOUSE_INNER_Y },
    ];
    return;
  }

  const back = { x: -g.dir.x, y: -g.dir.y };
  let opts = DIR_ORDER.filter(d =>
    isOpen(t.x + d.x, t.y + d.y) && !(d.x === back.x && d.y === back.y));
  if (!opts.length) opts = DIR_ORDER.filter(d => isOpen(t.x + d.x, t.y + d.y));
  if (!opts.length) return;

  let pick;
  // 逃げているとき・まよっているときは行き先を決めずに進む
  const adrift = !g.eaten && (g.fright || confuseTimer > 0);
  const whimsy = !g.eaten && mode !== 'scatter' && Math.random() < g.whim;
  if (adrift || whimsy) {
    pick = opts[(Math.random() * opts.length) | 0];
  } else {
    const target = g.eaten ? HOUSE_ENTRY
                 : mode === 'scatter' ? g.scatter
                 : g.chasing ? personalityTarget(g)
                 : g.roam;
    let best = Infinity;
    for (const d of opts) {
      const nx = t.x + d.x, ny = t.y + d.y;
      const dist = (nx - target.x) ** 2 + (ny - target.y) ** 2;
      if (dist < best) { best = dist; pick = d; }
    }
  }
  g.dir = pick;
  g.to = { x: t.x + pick.x, y: t.y + pick.y };
  g.stopped = false;
}

function ghostSpeed(g) {
  if (g.eaten) return BASE_SPEED * 2.0;
  if (g.state !== 'graph') return BASE_SPEED * 0.5;
  if (g.fright) return BASE_SPEED * spec.ghostFright * g.speed;
  const t = tileOf(g);
  if (t.y === TUNNEL_ROW && (t.x < 6 || t.x > 21)) return BASE_SPEED * spec.tunnel * g.speed;
  let s = spec.ghost * g.speed;
  if (g.id === 'moko') {                        // 残りが少ないともこが加速する
    const left = pelletsLeft;
    if (left <= 10) s += 0.12 * D().elroy;
    else if (left <= 20) s += 0.05 * D().elroy;
  }
  if (confuseTimer > 0) s *= 0.75;              // まよっている間はもたつく
  return BASE_SPEED * s;
}

// 巣の中／出入りは格子を無視して座標を直接動かす
function freeStep(g, dist) {
  let guard = 0;
  while (dist > 1e-9 && g.path.length && guard++ < 16) {
    const w = g.path[0];
    const dx = w.x - g.x, dy = w.y - g.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) { g.path.shift(); continue; }
    g.dir = Math.abs(dx) > Math.abs(dy)
      ? { x: Math.sign(dx), y: 0 }
      : { x: 0, y: Math.sign(dy) };
    if (d <= dist) { g.x = w.x; g.y = w.y; dist -= d; g.path.shift(); }
    else { g.x += dx / d * dist; g.y += dy / d * dist; dist = 0; }
  }
  if (!g.path.length) {
    if (g.state === 'exit') {
      g.state = 'graph';
      setTile(g, HOUSE_ENTRY.x, HOUSE_ENTRY.y, DIRS.left);
      g.fright = frightTimer > 0;
    } else if (g.state === 'enter') {
      g.state = 'home';
      g.eaten = false;
      g.fright = false;
      g.wait = 0.5;
      g.releaseDots = 0;   // 復活後はエサの数を待たずにすぐ出直す
    }
  }
}

function releaseGhost(g) {
  g.state = 'exit';
  g.path = [
    { x: HOUSE_COL_X, y: g.y },
    { x: HOUSE_COL_X, y: HOUSE_ENTRY.y + 0.5 },
  ];
}

/* =========================================================================
   6. ゲームの状態
   ========================================================================= */

let state = 'title';   // title | ready | play | dying | clear | gameover | paused
let prevState = null;
let stateTime = 0;

let level = 1;
let spec = levelSpec(1);
let sched = schedule(1);
let schedIndex = 0;
let schedTimer = 0;
let mode = 'scatter';

let score = 0;
let highScore = 0;
let lives = 3;
let extraLifeGiven = false;

let pelletsLeft = 0;
let dotCounter = 0;      // 巣からの解放判定に使う
let noDotTimer = 0;
let frightTimer = 0;
let confuseTimer = 0;    // ボーナスアイテムで おばけがまよっている残り時間
let ghostChain = 0;      // 連続で食べた数
let fruit = null;        // { t, x, y, kind }
let fruitSpawned = 0;
let popups = [];

// たべものの効果
let tripleTimer = 0;     // さくらんぼ: スコア 3 倍 (ぴよまるがピンクになる)
let clearTimer = 0;       // みかん: 半透明になる
let minis = [];          // いちご大福: ミニぴよまる
let blackPiyo = null;    // ぶどう: おばけを 1 人つかまえるブラックぴよまる

// 祝福エフェクト
const CELEBRATIONS = [1000, 3000, 5000, 10000, 15000, 30000];
const CELEBRATION_TEXT = [
  '1000てん とっぱ!', '3000てん とっぱ!', '5000てん とっぱ!',
  '10000てん とっぱ!!', '15000てん とっぱ!!', '30000てん とっぱ!!!',
];
let celebIndex = 0;
let particles = [];
let banner = null;       // { text, t, mode }
let flashTimer = 0;

/* =========================================================================
   7. DOM
   ========================================================================= */

const $ = id => document.getElementById(id);
const elScore = $('score');
const elHigh = $('highScore');
const elStage = $('stageBadge');
const elLives = $('lives');
const elGauge = $('gauge');
const elGaugeFill = $('gaugeFill');
const elOverlay = $('overlay');
const elEyebrow = $('panelEyebrow');
const elTitle = $('panelTitle');
const elText = $('panelText');
const elPanelScore = $('panelScore');
const elPanelScoreValue = $('panelScoreValue');
const elPrimary = $('primaryBtn');
const elHint = $('panelHint');
const elToast = $('toast');
const elSoundBtn = $('soundBtn');
const elSoundIcon = $('soundIcon');
const elDiffSeg = $('diffSeg');
const elDiffNote = $('diffNote');
const elDiffLabel = $('diffLabel');
const canvas = $('game');
const ctx = canvas.getContext('2d');

function setupCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingQuality = 'high';
}

function bump(el) {
  el.classList.remove('is-bump');
  void el.offsetWidth;
  el.classList.add('is-bump');
}

function updateScore(add) {
  score += add * (tripleTimer > 0 ? 3 : 1);   // さくらんぼ中は 3 倍
  elScore.textContent = score.toLocaleString('ja-JP');
  while (celebIndex < CELEBRATIONS.length && score >= CELEBRATIONS[celebIndex]) {
    celebrate(celebIndex);
    celebIndex++;
  }
  if (add >= 50) bump(elScore);   // エサ 1 粒ごとに跳ねるとうるさいので
  if (!extraLifeGiven && score >= 10000) {
    extraLifeGiven = true;
    lives++;
    drawLives();
    toast('1UP! ぴよまるがふえた');
    sfx.extra();
  }
  if (score > highScore) {
    highScore = score;
    elHigh.textContent = highScore.toLocaleString('ja-JP');
    try { localStorage.setItem(highKey(), String(highScore)); } catch (e) { /* noop */ }
  }
}

// ハイスコアは むずかしさごとに分けて持つ
const highKey = () => `piyomaru.high.${difficulty}`;

function loadHighScore() {
  highScore = 0;
  try { highScore = Number(localStorage.getItem(highKey())) || 0; } catch (e) { /* noop */ }
  elHigh.textContent = highScore.toLocaleString('ja-JP');
}

function drawLives() {
  elLives.innerHTML = '';
  for (let i = 0; i < Math.max(0, lives - 1); i++) {
    const img = document.createElement('img');
    img.src = 'png/ui-life-icon.png';
    img.alt = '';
    elLives.appendChild(img);
  }
}

let toastTimer = null;
function toast(msg) {
  elToast.textContent = msg;
  elToast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { elToast.hidden = true; }, 1800);
}

function showPanel({ eyebrow = '', title, text = '', showScore = false, showDiff = false, button, hint }) {
  elEyebrow.textContent = eyebrow;
  elTitle.textContent = title;
  elText.textContent = text;
  elDiffSeg.hidden = !showDiff;
  elPanelScore.hidden = !showScore;
  elPanelScoreValue.textContent = score.toLocaleString('ja-JP');
  elPrimary.textContent = button;
  elHint.textContent = hint || '';
  elOverlay.hidden = false;
  elPrimary.focus({ preventScroll: true });
}

const hidePanel = () => { elOverlay.hidden = true; };

/* ---------- むずかしさの切り替え ---------- */

const DIFF_NOTE = {
  easy:   'おいかけっこは 3 人だけ。\nみんなゆっくりで、のこり 5 機。',
  normal: 'おいかけっこは 4 人。\n少しはやくなって、のこり 4 機。',
  hard:   'おいかけっこは 4 人が本気。\nのこり 3 機で、もこが終盤に加速。',
};

function syncDiffUI() {
  for (const btn of elDiffSeg.querySelectorAll('.seg__btn')) {
    btn.setAttribute('aria-checked', String(btn.dataset.diff === difficulty));
  }
  elDiffNote.textContent = DIFF_NOTE[difficulty];
  elDiffLabel.textContent = D().label;
}

function setDifficulty(id) {
  if (!DIFFICULTY[id] || id === difficulty) return;
  difficulty = id;
  try { localStorage.setItem('piyomaru.diff', id); } catch (e) { /* noop */ }
  spec = levelSpec(level);
  sched = schedule(level);
  loadHighScore();
  syncDiffUI();
  resetGhosts();   // 人数と配置をタイトル画面の表示にも反映する
  if (state === 'title' || state === 'gameover') {
    lives = D().lives;
    drawLives();
  }
}

/* =========================================================================
   8. 効果音 (WebAudio の簡易シンセ)
   ========================================================================= */

const sfx = (() => {
  let ac = null;
  let on = true;
  try { on = localStorage.getItem('piyomaru.sound') !== 'off'; } catch (e) { /* noop */ }

  const ensure = () => {
    if (!on) return null;
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ac = new AC();
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  };

  function tone(freq, dur, type = 'square', vol = 0.05, slideTo = null, delay = 0) {
    const c = ensure();
    if (!c) return;
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  let wakaHi = false;
  return {
    get enabled() { return on; },
    toggle() {
      on = !on;
      try { localStorage.setItem('piyomaru.sound', on ? 'on' : 'off'); } catch (e) { /* noop */ }
      if (on) { ensure(); tone(660, 0.1, 'triangle', 0.05); }
      return on;
    },
    unlock() { ensure(); },
    waka() { wakaHi = !wakaHi; tone(wakaHi ? 420 : 320, 0.055, 'square', 0.035); },
    power() { tone(220, 0.35, 'triangle', 0.06, 880); },
    ghost() {
      tone(523, 0.09, 'square', 0.06);
      tone(784, 0.09, 'square', 0.06, null, 0.09);
      tone(1046, 0.14, 'square', 0.06, null, 0.18);
    },
    fruit() {
      tone(880, 0.1, 'triangle', 0.06);
      tone(1174, 0.18, 'triangle', 0.06, null, 0.1);
    },
    death() { tone(600, 0.9, 'sawtooth', 0.06, 90); },
    extra() {
      tone(784, 0.1, 'triangle', 0.06);
      tone(988, 0.1, 'triangle', 0.06, null, 0.11);
      tone(1318, 0.22, 'triangle', 0.06, null, 0.22);
    },
    start() {
      [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.14, 'triangle', 0.05, null, i * 0.13));
    },
    clear() {
      [659, 784, 1046, 1318, 1568].forEach((f, i) => tone(f, 0.16, 'triangle', 0.05, null, i * 0.11));
    },
    celebrate(level) {
      const tunes = [
        [523, 659, 784],
        [587, 740, 880, 1109],
        [659, 831, 988, 1319],
        [523, 659, 784, 1046, 1319],
        [440, 554, 659, 880, 1109, 1319],
        [523, 659, 784, 1046, 1319, 1568, 2093],
      ];
      (tunes[level] || tunes[0]).forEach((f, i) =>
        tone(f, 0.2, 'triangle', 0.055, null, i * 0.1));
    },
  };
})();

/* =========================================================================
   9. ゲーム進行
   ========================================================================= */

function setState(s) {
  state = s;
  stateTime = 0;
}

function startGame() {
  score = 0;
  lives = D().lives;
  level = 1;
  extraLifeGiven = false;
  celebIndex = 0;
  elScore.textContent = '0';
  drawLives();
  sfx.start();
  startLevel();
}

function startLevel() {
  spec = levelSpec(level);
  sched = schedule(level);
  schedIndex = 0;
  schedTimer = 0;
  mode = sched[0][1];
  newMaze();          // ステージごとに迷路を作り直す
  rebuildMazeArt();
  buildPellets();
  pelletsLeft = totalPellets;
  fruit = null;
  fruitSpawned = 0;
  popups = [];
  particles = [];
  banner = null;
  flashTimer = 0;
  elStage.textContent = `ステージ ${level}`;
  resetRound();
}

function resetRound() {
  resetPac();
  resetGhosts();
  frightTimer = 0;
  confuseTimer = 0;
  tripleTimer = 0;
  clearTimer = 0;
  minis = [];
  blackPiyo = null;
  ghosts.forEach(g => { g.bound = 0; });
  ghostChain = 0;
  dotCounter = 0;
  noDotTimer = 0;
  hidePanel();
  setState('ready');
}

function loseLife() {
  lives--;
  drawLives();
  if (lives <= 0) {
    setState('gameover');
    showPanel({
      eyebrow: `ステージ ${level} まで`,
      title: 'ゲームオーバー',
      text: 'おばけにつかまっちゃった…',
      showScore: true,
      showDiff: true,
      button: 'もういちど',
      hint: 'Enter / スペースでもはじめられます',
    });
  } else {
    resetRound();
  }
}

function eatAt(tx, ty) {
  if (tx < 0 || tx >= COLS || ty < 0 || ty >= ROWS) return;
  const p = pellets[ty][tx];
  if (!p) return;
  pellets[ty][tx] = 0;
  pelletsLeft--;
  dotCounter++;
  noDotTimer = 0;

  if (p === 1) {
    updateScore(10);
    sfx.waka();
  } else {
    updateScore(50);
    sfx.power();
    if (spec.fright > 0) {
      frightTimer = spec.fright;
      ghostChain = 0;
      for (const g of ghosts) {
        if (!g.inPlay) continue;
        if (g.state === 'graph' && !g.eaten) {
          g.fright = true;
          reverse(g);
        }
      }
    }
  }

  // たべものの出現。1 ステージに 4 回、種類も場所も毎回ランダム
  const eaten = totalPellets - pelletsLeft;
  if (fruitSpawned < 4 && eaten >= Math.round(totalPellets * (fruitSpawned + 1) / 5)) {
    fruitSpawned++;
    spawnFruit();
  }

  if (pelletsLeft <= 0) {
    setState('clear');
    sfx.clear();
  }
}

function addPopup(x, y, text) {
  popups.push({ x, y, text, t: 0 });
}

// パワーゲージの DOM 更新は 1 フレーム 1 回だけ (simulate は 120Hz で回るため)
let gaugeShown = false;
function syncGauge() {
  const power = frightTimer > 0;                 // パワーエサ (食べられる)
  const lost = !power && confuseTimer > 0;       // ボーナスで まよっている
  const show = power || lost;
  if (show !== gaugeShown) {
    gaugeShown = show;
    elGauge.hidden = !show;
  }
  if (!show) return;
  const span = power ? spec.fright : spec.confuse;
  const left = power ? frightTimer : confuseTimer;
  const ratio = span > 0 ? Math.max(0, Math.min(1, left / span)) : 0;
  elGaugeFill.style.transform = `scaleX(${ratio})`;
  elGaugeFill.classList.toggle('is-confused', lost);
  elGaugeFill.classList.toggle('is-low', power && frightTimer < 2);
}

/* ---------- モード進行 ---------- */

function updateModes(dt) {
  if (confuseTimer > 0) confuseTimer = Math.max(0, confuseTimer - dt);

  if (frightTimer > 0) {
    frightTimer -= dt;
    if (frightTimer <= 0) {
      frightTimer = 0;
      ghosts.forEach(g => { g.fright = false; });
    }
    return;   // パワー中はスキャッター／チェイスのタイマーを止める
  }

  const [dur, m] = sched[schedIndex];
  schedTimer += dt;
  if (schedTimer >= dur && schedIndex < sched.length - 1) {
    schedIndex++;
    schedTimer = 0;
    mode = sched[schedIndex][1];
    ghosts.forEach(g => {
      if (g.inPlay && g.state === 'graph' && !g.eaten) reverse(g);
    });
  } else if (mode !== m) {
    mode = m;
  }
}

function updateRelease(dt) {
  noDotTimer += dt;
  const waiting = ghosts.filter(g => g.inPlay && g.state === 'home' && g.wait <= 0);
  if (!waiting.length) return;
  const next = waiting[0];
  if (dotCounter >= next.releaseDots || noDotTimer > D().idle) {
    noDotTimer = 0;
    releaseGhost(next);
  }
}

/* ---------- 1 ステップ ---------- */

function simulate(dt) {
  if (state === 'play') {
    updateModes(dt);
    updateRelease(dt);

    // ぴよまる: 反転だけは区間の途中でも受け付ける
    // (停止中は onArrive 側で処理するので want は消さない)
    if (pac.want && !pac.stopped &&
        pac.want.x === -pac.dir.x && pac.want.y === -pac.dir.y) {
      reverse(pac);
      pac.want = null;
    }
    const pacSpeed = BASE_SPEED * (frightTimer > 0 ? spec.pacFright : spec.pac);
    graphStep(pac, pacSpeed * dt);
    if (!pac.stopped) pac.anim += dt;

    // たべものの効果のタイマー
    if (tripleTimer > 0) tripleTimer = Math.max(0, tripleTimer - dt);
    if (clearTimer > 0) clearTimer = Math.max(0, clearTimer - dt);
    if (blackPiyo) {
      blackPiyo.t -= dt;
      if (blackPiyo.t <= 0) blackPiyo = null;
    }

    // ミニぴよまる
    for (const m of minis) {
      m.life -= dt;
      graphStep(m, BASE_SPEED * 0.85 * dt);
      if (!m.stopped) m.anim += dt;
    }
    minis = minis.filter(m => m.life > 0);

    // おばけ
    for (const g of ghosts) {
      if (!g.inPlay) continue;
      updateMood(g, dt);
      if (g.bound > 0) {                 // ブラックぴよまるに つかまっている
        g.bound -= dt;
        continue;
      }
      const sp = ghostSpeed(g) * dt;
      if (g.state === 'graph') {
        graphStep(g, sp);
      } else if (g.state === 'home') {
        g.bob += dt * 3.2;
        g.y = HOUSE_INNER_Y + Math.sin(g.bob) * 0.22;
        if (g.wait > 0) g.wait -= dt;
      } else {
        freeStep(g, sp);
      }
    }

    checkCollisions();
  }

  // たべもの
  if (fruit && state === 'play') {
    fruit.t -= dt;
    if (fruit.t <= 0) fruit = null;
  }

  // スコア表示・お祝い
  popups = popups.filter(p => (p.t += dt) < 0.9);
  updateParticles(dt);
}

function checkCollisions() {
  for (const g of ghosts) {
    if (!g.inPlay) continue;
    if (g.state !== 'graph' || g.eaten) continue;

    // つかまっている間は こちらを捕まえられない。ミニぴよまるは追い払える
    if (g.bound > 0) continue;
    if (minis.length) {
      minis = minis.filter(m => Math.hypot(g.x - m.x, g.y - m.y) > 0.7);
    }

    if (Math.hypot(g.x - pac.x, g.y - pac.y) > 0.72) continue;

    if (g.fright) {
      ghostChain = Math.min(ghostChain + 1, 4);
      const pts = 200 * Math.pow(2, ghostChain - 1);
      updateScore(pts);
      addPopup(g.x, g.y, String(pts));
      g.eaten = true;
      g.fright = false;
      sfx.ghost();
      // 進行中の区間はそのまま走り切り、次のタイルで巣に向き直る
    } else {
      setState('dying');
      sfx.death();
      return;
    }
  }

  // たべもの
  if (fruit && Math.hypot(fruit.x - pac.x, fruit.y - pac.y) < 0.8) {
    const kind = fruit.kind;
    addPopup(fruit.x, fruit.y, String(kind.pts));
    fruit = null;
    updateScore(kind.pts);
    sfx.fruit();
    applyFruit(kind);
  }
}

// ボーナスアイテムを取ると おいかけっこのみんながまよう
// (パワーエサとちがって食べられるようにはならないので、ぶつかればアウト)
function startConfusion(seconds) {
  confuseTimer = Math.max(confuseTimer, seconds);
  for (const g of ghosts) {
    if (!g.inPlay) continue;
    if (g.state === 'graph' && !g.eaten && !g.fright) reverse(g);
  }
}

/* =========================================================================
   9b. たべものと その効果
   ========================================================================= */

// ぴよまるから少し離れた通路にたべものを置く
function spawnFruit() {
  const cands = OPEN_TILES.filter(t =>
    !noPelletZone(t.x, t.y) && Math.hypot(t.x + 0.5 - pac.x, t.y + 0.5 - pac.y) > 5);
  const pool = cands.length ? cands : OPEN_TILES;
  const t = pool[(Math.random() * pool.length) | 0];
  fruit = { t: 9.5, x: t.x + 0.5, y: t.y + 0.5, kind: randomFruitKind() };
  toast(`${fruit.kind.label}が でたよ!`);
}

function applyFruit(kind) {
  switch (kind.id) {
    case 'cherry':                       // ぴよまるがピンクに。5 秒間スコア 3 倍
      tripleTimer = EFFECT_TIME;
      break;
    case 'mikan':                        // 半透明になり おいかけっこがまよう
      clearTimer = EFFECT_TIME;
      startConfusion(EFFECT_TIME);
      break;
    case 'grape':                        // ブラックぴよまるが 1 人つかまえる
      spawnBlackPiyo();
      break;
    case 'daifuku':                      // ミニぴよまるが 4 体でエサを食べる
      spawnMinis();
      break;
  }
  toast(kind.note);
}

/* ---------- いちご大福: ミニぴよまる ---------- */

// d の向きに n マス先までエサがあるか
function pelletAhead(x, y, d, n) {
  for (let i = 1; i <= n; i++) {
    const nx = ((x + d.x * i) % COLS + COLS) % COLS;
    const ny = y + d.y * i;
    if (ny < 0 || ny >= ROWS || !isOpen(nx, ny)) return false;
    if (pellets[ny][nx]) return true;
  }
  return false;
}

function miniDecide(m) {
  const t = m.from;
  eatAt(t.x, t.y);
  const back = { x: -m.dir.x, y: -m.dir.y };
  let opts = DIR_ORDER.filter(d =>
    isOpen(t.x + d.x, t.y + d.y) && !(d.x === back.x && d.y === back.y));
  if (!opts.length) opts = DIR_ORDER.filter(d => isOpen(t.x + d.x, t.y + d.y));
  if (!opts.length) return;
  const tasty = opts.filter(d => pelletAhead(t.x, t.y, d, 5));
  const pool = tasty.length ? tasty : opts;
  const pick = pool[(Math.random() * pool.length) | 0];
  m.dir = pick;
  m.to = { x: t.x + pick.x, y: t.y + pick.y };
  m.stopped = false;
}

function spawnMinis() {
  minis = [];
  const pool = OPEN_TILES.filter(t => !noPelletZone(t.x, t.y));
  for (let i = 0; i < 4; i++) {
    const t = pool.length ? pool[(Math.random() * pool.length) | 0] : PAC_START;
    const m = {
      from: { x: 0, y: 0 }, to: { x: 0, y: 0 }, prog: 0, stopped: true,
      dir: DIRS.left, x: 0, y: 0, life: EFFECT_TIME, anim: Math.random(),
      color: MINI_COLORS[i % MINI_COLORS.length],
      onArrive() { miniDecide(this); },
    };
    setTile(m, t.x, t.y, DIR_ORDER[(Math.random() * 4) | 0]);
    minis.push(m);
  }
}

/* ---------- ぶどう: ブラックぴよまる ---------- */

function spawnBlackPiyo() {
  const cands = ghosts.filter(g =>
    g.inPlay && g.state === 'graph' && !g.eaten && !g.bound);
  if (!cands.length) return;
  let best = cands[0], bd = Infinity;
  for (const g of cands) {
    const d = Math.hypot(g.x - pac.x, g.y - pac.y);
    if (d < bd) { bd = d; best = g; }
  }
  best.bound = EFFECT_TIME;
  blackPiyo = { g: best, t: EFFECT_TIME };
}

/* ---------- 祝福エフェクト ---------- */

function celebrate(i) {
  banner = { text: CELEBRATION_TEXT[i], t: 0, mode: i };
  particles = particles.slice(-40);
  const rnd = (a, b) => a + Math.random() * (b - a);

  if (i === 0) {                                  // 紙吹雪
    for (let n = 0; n < 70; n++) {
      particles.push({ k: 'confetti', x: rnd(0, COLS), y: rnd(-6, 0),
        vx: rnd(-0.6, 0.6), vy: rnd(3, 6), rot: rnd(0, 6), vr: rnd(-6, 6),
        c: ['#F1AAA0', '#BFDCD3', '#F7E7A8', '#CFA9C8'][n % 4], t: 0, life: 2.6 });
    }
  } else if (i === 1) {                           // 波紋
    for (let n = 0; n < 5; n++) {
      particles.push({ k: 'ring', x: COLS / 2, y: ROWS / 2,
        r: 0, vr: 9, delay: n * 0.16, c: '#BFDCD3', t: 0, life: 1.8 });
    }
  } else if (i === 2) {                           // 星がはじける
    for (let n = 0; n < 40; n++) {
      const a = (n / 40) * Math.PI * 2 + rnd(-0.1, 0.1);
      const s = rnd(6, 13);
      particles.push({ k: 'star', x: COLS / 2, y: ROWS / 2,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s, rot: rnd(0, 6), vr: rnd(-8, 8),
        c: '#F7E7A8', t: 0, life: 1.6 });
    }
  } else if (i === 3) {                           // 花火
    for (let b = 0; b < 5; b++) {
      const cx = rnd(4, COLS - 4), cy = rnd(4, ROWS - 8);
      for (let n = 0; n < 26; n++) {
        const a = (n / 26) * Math.PI * 2;
        const s = rnd(5, 10);
        particles.push({ k: 'spark', x: cx, y: cy,
          vx: Math.cos(a) * s, vy: Math.sin(a) * s, delay: b * 0.35,
          c: ['#F1AAA0', '#F7E7A8', '#BFDCD3', '#CFA9C8', '#EFC780'][b], t: 0, life: 1.5 });
      }
    }
  } else if (i === 4) {                           // ぴよまるのパレード
    for (let n = 0; n < 7; n++) {
      particles.push({ k: 'parade', x: -2 - n * 3.2, y: rnd(3, ROWS - 4),
        vx: rnd(7, 10), vy: 0, bob: rnd(0, 6), t: 0, life: 4.2 });
    }
  } else {                                        // 虹色フラッシュ + 大量の紙吹雪
    flashTimer = 0.9;
    for (let n = 0; n < 150; n++) {
      particles.push({ k: 'confetti', x: rnd(0, COLS), y: rnd(-10, 0),
        vx: rnd(-1.2, 1.2), vy: rnd(4, 9), rot: rnd(0, 6), vr: rnd(-9, 9),
        c: `hsl(${(n * 23) % 360} 70% 72%)`, t: 0, life: 3.6 });
    }
  }
  sfx.celebrate(i);
}

function updateParticles(dt) {
  if (flashTimer > 0) flashTimer = Math.max(0, flashTimer - dt);
  if (banner) { banner.t += dt; if (banner.t > 2.4) banner = null; }
  if (!particles.length) return;
  for (const p of particles) {
    p.t += dt;
    if (p.delay && p.t < p.delay) continue;
    if (p.k === 'ring') { p.r += p.vr * dt; continue; }
    p.x += (p.vx || 0) * dt;
    p.y += (p.vy || 0) * dt;
    if (p.k === 'confetti') { p.vy += 2 * dt; p.rot += p.vr * dt; }
    if (p.k === 'star') { p.vy += 6 * dt; p.rot += p.vr * dt; }
    if (p.k === 'spark') { p.vy += 7 * dt; p.vx *= 0.97; p.vy *= 0.97; }
  }
  particles = particles.filter(p => p.t < (p.delay || 0) + p.life);
}

/* =========================================================================
   10. 描画
   ========================================================================= */

function drawSprite(img, cx, cy, h, alpha = 1, rot = 0, scale = 1, flipX = false, flipY = false) {
  if (!img) return;
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return;
  const dh = h * Math.max(0, scale);
  const dw = dh * iw / ih;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.translate(cx, cy);
  if (rot) ctx.rotate(rot);
  if (flipX || flipY) ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
  ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
}

function dirName(d) {
  if (d.y < 0) return 'up';
  if (d.y > 0) return 'down';
  if (d.x < 0) return 'left';
  return 'right';
}

// png/new の素材は 4 方向とも専用絵がある
function dirSprite(prefix, dir, open) {
  const frame = open ? 'open' : 'closed';
  return { img: IMG[`${prefix}-${dirName(dir)}-${frame}`], fx: false, fy: false };
}

function drawPellets(t) {
  const dot = IMG['item-dot'];
  const pulse = 1 + Math.sin(t * 5) * 0.10;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const p = pellets[y][x];
      if (!p) continue;
      const cx = (x + 0.5) * TILE;
      const cy = (y + 0.5) * TILE;
      if (p === 1) {
        drawSprite(dot, cx, cy, TILE * 0.30);
      } else {
        ctx.save();
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = C_PRIMARY;
        ctx.beginPath();
        ctx.arc(cx, cy, TILE * 0.52 * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        drawSprite(dot, cx, cy, TILE * 0.72 * pulse);
      }
    }
  }
}

function drawGhost(g, t) {
  const cx = g.x * TILE;
  const cy = g.y * TILE;
  const h = TILE * 1.55;

  if (g.eaten) {
    drawSprite(IMG['chaser-eyes-only'], cx, cy, h);
    return;
  }
  if (g.fright) {
    // 残り 2 秒を切ったら白と交互に点滅
    const flashing = frightTimer < 2 && Math.floor(frightTimer * 5) % 2 === 0;
    drawSprite(flashing ? IMG['chaser-scared-white'] : IMG['chaser-scared'], cx, cy, h);
    return;
  }
  // ふわふわ上下に揺れる。まよっている間はふらついて「?」が出る
  const lost = confuseTimer > 0;
  const bob = Math.sin(t * 6 + g.bob) * TILE * 0.05;
  const tilt = lost ? Math.sin(t * 9 + g.bob) * 0.28 : 0;
  drawSprite(IMG[g.img], cx, cy + bob, h, 1, tilt);
  if (lost) drawQuestion(cx + TILE * 0.6, cy - TILE * 0.8, t + g.bob);
}

function drawQuestion(x, y, t) {
  ctx.save();
  ctx.font = `700 ${TILE * 0.85}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 5;
  ctx.strokeStyle = C_MAZE_BG;
  const yy = y + Math.sin(t * 5) * TILE * 0.12;
  ctx.strokeText('?', x, yy);
  ctx.fillStyle = C_ACCENT_DARK;
  ctx.fillText('?', x, yy);
  ctx.restore();
}

function drawPac(t) {
  const cx = pac.x * TILE;
  const cy = pac.y * TILE;
  const h = TILE * 1.62;
  const d = dirName(pac.dir);

  if (state === 'dying') {
    const k = Math.min(stateTime / 1.25, 1);
    const img = IMG[`piyomaru-${d}-open`];
    drawSprite(img, cx, cy, h, 1 - k, k * Math.PI * 2, 1 - k * 0.85);
    return;
  }

  const moving = !pac.stopped && (state === 'play');
  const open = moving ? Math.floor(pac.anim * 11) % 2 === 0 : false;
  const squash = state === 'ready' ? 1 + Math.sin(t * 6) * 0.04 : 1;
  // みかん中は半透明、さくらんぼ中はピンクぴよまるに変身
  const alpha = clearTimer > 0 ? 0.42 + Math.sin(t * 7) * 0.08 : 1;

  if (tripleTimer > 0) {
    const s = dirSprite('pink', pac.dir, open);
    if (s.img) { drawSprite(s.img, cx, cy, h * 1.04, alpha, 0, squash, s.fx, s.fy); return; }
  }
  const img = IMG[`piyomaru-${d}-${open ? 'open' : 'closed'}`];
  drawSprite(img, cx, cy, h, alpha, 0, squash);
}

function drawMinis(t) {
  for (const m of minis) {
    const open = Math.floor(m.anim * 13) % 2 === 0;
    const s = dirSprite(`mini-${m.color}`, m.dir, open);
    const fade = Math.min(1, Math.max(0, m.life));
    const pop = Math.min(1, Math.max(0, (EFFECT_TIME - m.life) / 0.25));
    drawSprite(s.img, m.x * TILE, m.y * TILE + Math.sin(t * 9 + m.anim) * TILE * 0.06,
      TILE * 1.05, fade, 0, pop, s.fx, s.fy);
  }
}

function drawBlackPiyo(t) {
  if (!blackPiyo) return;
  const g = blackPiyo.g;
  const a = t * 3;
  // つかまえたおばけの まわりをぐるぐる回る。進む向きに顔を向ける
  const movingLeft = -Math.sin(a) < 0;
  const img = (movingLeft ? IMG['piyomaru-black-left'] : IMG['piyomaru-black'])
    || IMG['piyomaru-black'] || IMG['piyomaru-right-closed'];
  const cx = g.x * TILE + Math.cos(a) * TILE * 0.62;
  const cy = g.y * TILE + Math.sin(a) * TILE * 0.36 - TILE * 0.1;
  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = C_TEXT;
  ctx.beginPath();
  ctx.arc(g.x * TILE, g.y * TILE, TILE * 0.85, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  drawSprite(img, cx, cy, TILE * 1.15);
}

function drawParticles() {
  for (const p of particles) {
    const age = p.t - (p.delay || 0);
    if (age < 0) continue;
    const k = age / p.life;
    const x = p.x * TILE, y = p.y * TILE;
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - k * k);
    if (p.k === 'confetti') {
      ctx.translate(x, y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.c;
      ctx.fillRect(-TILE * 0.18, -TILE * 0.1, TILE * 0.36, TILE * 0.2);
    } else if (p.k === 'ring') {
      ctx.strokeStyle = p.c;
      ctx.lineWidth = TILE * 0.3;
      ctx.beginPath();
      ctx.arc(x, y, p.r * TILE, 0, Math.PI * 2);
      ctx.stroke();
    } else if (p.k === 'star') {
      ctx.translate(x, y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.c;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? TILE * 0.16 : TILE * 0.4;
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
    } else if (p.k === 'spark') {
      ctx.fillStyle = p.c;
      ctx.beginPath();
      ctx.arc(x, y, TILE * 0.16, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.k === 'parade') {
      const img = IMG['piyomaru-right-open'];
      drawSprite(img, x, y + Math.sin(age * 9 + p.bob) * TILE * 0.5, TILE * 1.5,
        Math.max(0, 1 - k * k));
    }
    ctx.restore();
  }
}

function drawBanner() {
  if (!banner) return;
  const k = Math.min(banner.t / 0.3, 1);
  const out = banner.t > 2.0 ? 1 - (banner.t - 2.0) / 0.4 : 1;
  ctx.save();
  ctx.globalAlpha = Math.max(0, out);
  ctx.translate(W / 2, H * 0.30);
  ctx.scale(0.7 + k * 0.3, 0.7 + k * 0.3);
  ctx.font = `700 ${TILE * 1.25}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 9;
  ctx.strokeStyle = C_MAZE_BG;
  ctx.strokeText(banner.text, 0, 0);
  ctx.fillStyle = banner.mode >= 3 ? C_PRIMARY : C_ACCENT_DARK;
  ctx.fillText(banner.text, 0, 0);
  ctx.restore();
}

function drawCenterText(text, y, size, color) {
  ctx.save();
  ctx.font = `700 ${size}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 6;
  ctx.strokeStyle = C_MAZE_BG;
  ctx.strokeText(text, W / 2, y);
  ctx.fillStyle = color;
  ctx.fillText(text, W / 2, y);
  ctx.restore();
}

function draw(t) {
  ctx.fillStyle = C_MAZE_BG;
  ctx.fillRect(0, 0, W, H);

  const flash = state === 'clear' && Math.floor(stateTime * 6) % 2 === 1;
  ctx.drawImage(flash ? mazeCanvasFlash : mazeCanvas, 0, 0, W, H);

  // おばけの巣
  ctx.drawImage(IMG['nest'],
    HOUSE_RECT.x * TILE, HOUSE_RECT.y * TILE,
    HOUSE_RECT.w * TILE, HOUSE_RECT.h * TILE);
  // 扉 (おばけだけが通れる)
  const doorR = TILE * 0.15;
  ctx.fillStyle = C_PRIMARY;
  ctx.beginPath();
  roundRectPath(ctx, 12.9 * TILE, 12.12 * TILE, 2.2 * TILE, doorR * 2,
    [doorR, doorR, doorR, doorR]);
  ctx.fill();

  drawPellets(t);

  if (fruit) {
    const blink = fruit.t < 2.5 && Math.floor(fruit.t * 6) % 2 === 0;
    const wobble = Math.sin(t * 4) * 0.08;
    // 場所が毎回ちがうので、ふんわり光らせて見つけやすくする
    ctx.save();
    ctx.globalAlpha = 0.22 + Math.sin(t * 5) * 0.08;
    ctx.fillStyle = C_ACCENT_DARK;
    ctx.beginPath();
    ctx.arc(fruit.x * TILE, fruit.y * TILE, TILE * 0.95, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    drawSprite(IMG[fruit.kind.img], fruit.x * TILE, fruit.y * TILE,
      TILE * 1.45, blink ? 0.35 : 1, wobble);
  }

  if (state !== 'dying') {
    for (const g of ghosts) {
      if (!g.inPlay) continue;
      drawGhost(g, t);
      // トンネル通過中は反対側にも描く
      if (g.x < 1) drawGhostAt(g, g.x + COLS, t);
      else if (g.x > COLS - 1) drawGhostAt(g, g.x - COLS, t);
    }
  }

  drawBlackPiyo(t);
  drawMinis(t);

  drawPac(t);
  if (pac.x < 1) drawPacAt(pac.x + COLS);
  else if (pac.x > COLS - 1) drawPacAt(pac.x - COLS);

  // 得点ポップ
  for (const p of popups) {
    const k = p.t / 0.9;
    ctx.save();
    ctx.globalAlpha = 1 - k * k;
    ctx.font = `700 ${TILE * 0.72}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 5;
    ctx.strokeStyle = C_MAZE_BG;
    const py = (p.y - k * 0.7) * TILE;
    ctx.strokeText(p.text, p.x * TILE, py);
    ctx.fillStyle = C_PRIMARY;
    ctx.fillText(p.text, p.x * TILE, py);
    ctx.restore();
  }

  // みかん (半透明) の残り時間カウント
  if (clearTimer > 0) {
    drawCenterText(`とうめい ${Math.ceil(clearTimer)}`, 8.6 * TILE, TILE * 1.05, C_TEXT);
  }

  if (state === 'ready') {
    drawCenterText('READY!', 17.5 * TILE, TILE * 1.15, C_ACCENT_DARK);
  }
  if (state === 'clear') {
    drawCenterText('ステージクリア!', 17.5 * TILE, TILE * 1.0, C_TEXT);
  }

  // お祝い
  if (flashTimer > 0) {
    ctx.save();
    ctx.globalAlpha = Math.min(0.55, flashTimer * 0.6);
    const grad = ctx.createLinearGradient(0, 0, W, H);
    for (let i = 0; i <= 6; i++) grad.addColorStop(i / 6, `hsl(${i * 60} 80% 72%)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
  drawParticles();
  drawBanner();
}

function drawGhostAt(g, x, t) {
  const real = g.x;
  g.x = x;
  drawGhost(g, t);
  g.x = real;
}

function drawPacAt(x) {
  const real = pac.x;
  pac.x = x;
  drawPac(0);
  pac.x = real;
}

/* =========================================================================
   11. メインループ
   ========================================================================= */

const FIXED = 1 / 120;
let acc = 0;
let last = 0;
let clock = 0;

function frame(now) {
  requestAnimationFrame(frame);
  if (!last) last = now;
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25;
  clock += dt;

  if (state !== 'paused' && state !== 'title' && state !== 'gameover') {
    stateTime += dt;
    acc += dt;
    let steps = 0;
    while (acc >= FIXED && steps++ < 16) {
      simulate(FIXED);
      acc -= FIXED;
    }
    acc = Math.min(acc, FIXED);

    if (state === 'ready' && stateTime > (level === 1 && lives === D().lives ? 2.4 : 1.6)) {
      setState('play');
    } else if (state === 'dying' && stateTime > 1.7) {
      loseLife();
    } else if (state === 'clear' && stateTime > 2.2) {
      level++;
      startLevel();
    }
  }

  syncGauge();
  draw(clock);
}

/* =========================================================================
   12. 入力
   ========================================================================= */

function setDir(name) {
  const d = DIRS[name];
  if (!d) return;
  pac.want = d;
  sfx.unlock();
}

const KEYMAP = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', a: 'left', s: 'down', d: 'right',
  W: 'up', A: 'left', S: 'down', D: 'right',
};

window.addEventListener('keydown', e => {
  if (KEYMAP[e.key]) {
    e.preventDefault();
    setDir(KEYMAP[e.key]);
    return;
  }
  if (e.key === ' ' || e.key === 'Enter') {
    // ボタンにフォーカスがある場合はブラウザ既定の click に任せる (二重発火の防止)
    if (document.activeElement === elPrimary) return;
    e.preventDefault();
    if (!elOverlay.hidden) elPrimary.click();
    return;
  }
  if (e.key === 'p' || e.key === 'P') { e.preventDefault(); togglePause(); }
  if (e.key === 'm' || e.key === 'M') { e.preventDefault(); elSoundBtn.click(); }
});

/* ---------- D-pad ----------------------------------------------------------
   スマートフォンで押しにくかったので、ボタンを個別に叩くのではなく
   「パッドのどこを触っているか」で向きを決める方式にした。
   中心からの角度で判定するので四隅でも反応し、指を滑らせれば向きが変わる。
-------------------------------------------------------------------------- */
(() => {
  const pad = $('dpad');
  if (!pad) return;
  const btns = {};
  for (const b of pad.querySelectorAll('.dpad__btn')) btns[b.dataset.dir] = b;

  let active = null;      // 押している指の pointerId
  let current = null;     // いま光らせている向き

  const highlight = dir => {
    if (current === dir) return;
    if (current && btns[current]) btns[current].classList.remove('is-on');
    if (dir && btns[dir]) btns[dir].classList.add('is-on');
    current = dir;
  };

  // パッド中心からの位置で向きを決める。中心の小さな円は無反応
  function dirAt(clientX, clientY) {
    const r = pad.getBoundingClientRect();
    const dx = clientX - (r.left + r.width / 2);
    const dy = clientY - (r.top + r.height / 2);
    if (Math.hypot(dx, dy) < r.width * 0.12) return null;
    return Math.abs(dx) > Math.abs(dy)
      ? (dx > 0 ? 'right' : 'left')
      : (dy > 0 ? 'down' : 'up');
  }

  const apply = e => {
    const dir = dirAt(e.clientX, e.clientY);
    if (!dir) return;
    setDir(dir);
    highlight(dir);
  };

  pad.addEventListener('pointerdown', e => {
    e.preventDefault();
    active = e.pointerId;
    pad.setPointerCapture(e.pointerId);
    apply(e);
  });
  pad.addEventListener('pointermove', e => {
    if (e.pointerId !== active) return;
    e.preventDefault();
    apply(e);
  });
  const end = e => {
    if (e.pointerId !== active) return;
    active = null;
    highlight(null);
  };
  pad.addEventListener('pointerup', end);
  pad.addEventListener('pointercancel', end);
  pad.addEventListener('contextmenu', e => e.preventDefault());

  // キーボード / 支援技術から個々のボタンを使う場合の受け口
  for (const b of pad.querySelectorAll('.dpad__btn')) {
    b.addEventListener('click', e => {
      e.preventDefault();
      setDir(b.dataset.dir);
    });
  }
})();

// スワイプ
(() => {
  let sx = 0, sy = 0, active = false;
  const stage = $('stageInner');
  stage.addEventListener('touchstart', e => {
    const t = e.changedTouches[0];
    sx = t.clientX; sy = t.clientY; active = true;
  }, { passive: true });
  stage.addEventListener('touchmove', e => {
    if (!active) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.hypot(dx, dy) < 26) return;
    setDir(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    active = false;
  }, { passive: true });
  stage.addEventListener('touchend', () => { active = false; }, { passive: true });
})();

function togglePause() {
  if (state === 'paused') {
    setState(prevState || 'play');
    hidePanel();
  } else if (state === 'play' || state === 'ready') {
    prevState = state;
    setState('paused');
    showPanel({
      title: 'ポーズ',
      text: 'ひとやすみ中',
      button: 'つづける',
      hint: 'P キーでも切り替えられます',
    });
  }
}

$('pauseBtn').addEventListener('click', togglePause);

elPrimary.addEventListener('click', () => {
  sfx.unlock();
  if (state === 'title' || state === 'gameover') {
    hidePanel();
    startGame();
  } else if (state === 'paused') {
    togglePause();
  }
});

for (const btn of elDiffSeg.querySelectorAll('.seg__btn')) {
  btn.addEventListener('click', () => {
    sfx.unlock();
    setDifficulty(btn.dataset.diff);
  });
}

elSoundBtn.addEventListener('click', () => {
  const on = sfx.toggle();
  elSoundBtn.setAttribute('aria-pressed', String(on));
  elSoundIcon.textContent = on ? '♪' : '×';
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && (state === 'play' || state === 'ready')) togglePause();
});

/* =========================================================================
   13. 起動
   ========================================================================= */

async function boot() {
  setupCanvas();
  await loadImages();

  IMG['chaser-scared-white'] = makeTinted(IMG['chaser-scared'], '#FFFFFF', 0.72);
  newMaze();
  rebuildMazeArt();

  try {
    const saved = localStorage.getItem('piyomaru.diff');
    if (DIFFICULTY[saved]) difficulty = saved;
  } catch (e) { /* noop */ }
  spec = levelSpec(level);
  sched = schedule(level);
  loadHighScore();
  syncDiffUI();

  elSoundBtn.setAttribute('aria-pressed', String(sfx.enabled));
  elSoundIcon.textContent = sfx.enabled ? '♪' : '×';

  buildPellets();
  pelletsLeft = totalPellets;
  lives = D().lives;
  resetPac();
  resetGhosts();
  drawLives();

  showPanel({
    eyebrow: 'PIYOMARU PAKKUN',
    title: 'ぴよまるパックン',
    text: 'エサをぜんぶ食べたらステージクリア。\n大きなエサを食べるとおばけを追いかえせます。',
    showDiff: true,
    button: 'はじめる',
    hint: 'やじるしキー / WASD でうごく ・ P でポーズ',
  });

  window.addEventListener('resize', setupCanvas);
  requestAnimationFrame(frame);
}

boot();
})();
