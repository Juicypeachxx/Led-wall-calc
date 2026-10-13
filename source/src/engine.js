/* ============================================================
   ENGINE — catalog, project model and all calculations.
   Pure functions only (no DOM), so it can be unit-tested in Node.
   Units: millimetres for geometry, pixels for resolution,
   kilograms and watts for weight and power.
   ============================================================ */

const VERSION = 1;

/* ---------- small helpers ---------- */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const num = (v, d = 0) => { const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : d; };
const int = (v, d = 0) => Math.round(num(v, d));
const sum = (arr, f = (x) => x) => arr.reduce((a, x) => a + f(x), 0);
const gcd = (a, b) => { a = Math.abs(Math.round(a)); b = Math.abs(Math.round(b)); while (b) { [a, b] = [b, a % b]; } return a || 1; };
const rad = (d) => d * Math.PI / 180;
const uid = (p = '') => p + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
const deepClone = (o) => JSON.parse(JSON.stringify(o));

/* ---------- colours ---------- */
const SCREEN_COLORS = ['#5B6CFF', '#2FB59B', '#E58A3A', '#C058D6', '#3BA7E8', '#D9534F', '#8DBF3F', '#E2B93B'];
const PORT_COLORS = ['#3B82F6', '#EF4444', '#22C55E', '#EAB308', '#D946EF', '#06B6D4', '#F97316', '#8B5CF6',
  '#84CC16', '#EC4899', '#14B8A6', '#B45309', '#64748B', '#F43F5E', '#0EA5E9', '#10B981'];
const CIRCUIT_COLORS = ['#F59E0B', '#10B981', '#6366F1', '#EF4444', '#06B6D4', '#A855F7', '#84CC16', '#F43F5E',
  '#0EA5E9', '#D97706', '#14B8A6', '#E879F9'];

/* ---------- panel catalog ---------- */
function P(id, name, w, h, px, py, kg, wMax, wAvg) { return { id, name, w, h, px, py, kg, wMax, wAvg, builtin: true }; }
// Generic presets. Weight and power are typical mid-range values for the class of cabinet
// (real products vary, e.g. 7.5–11.5 kg and 160–200 W max for 500×500 rental cabinets);
// replace them with your product's datasheet values via a custom panel.
const BUILTIN_PANELS = [
  P('g5050-19', 'Generic 500×500 P1.9', 500, 500, 256, 256, 8.5, 180, 60),
  P('g5050-26', 'Generic 500×500 P2.6', 500, 500, 192, 192, 8.5, 180, 60),
  P('g5050-29', 'Generic 500×500 P2.9', 500, 500, 168, 168, 8.5, 180, 60),
  P('g5050-39', 'Generic 500×500 P3.9', 500, 500, 128, 128, 8.5, 180, 60),
  P('g5050-48', 'Generic 500×500 P4.8', 500, 500, 104, 104, 8.5, 180, 60),
  P('g50100-26', 'Generic 500×1000 P2.6', 500, 1000, 192, 384, 13.5, 360, 120),
  P('g50100-29', 'Generic 500×1000 P2.9', 500, 1000, 168, 336, 13.5, 340, 115),
  P('g50100-39', 'Generic 500×1000 P3.9', 500, 1000, 128, 256, 13.5, 320, 110),
  P('g50100-48', 'Generic 500×1000 P4.8', 500, 1000, 104, 208, 13.5, 300, 100),
  P('g600-09', 'Generic 600×337.5 P0.9', 600, 337.5, 640, 360, 5.5, 100, 35),
  P('g600-12', 'Generic 600×337.5 P1.2', 600, 337.5, 480, 270, 5.5, 90, 30),
  P('g600-15', 'Generic 600×337.5 P1.5', 600, 337.5, 384, 216, 5.5, 90, 30),
  P('g640-25', 'Generic 640×480 P2.5', 640, 480, 256, 192, 8, 200, 65),
  P('g960-5', 'Generic 960×960 P5 outdoor', 960, 960, 192, 192, 28, 750, 250),
  P('g960-10', 'Generic 960×960 P10 outdoor', 960, 960, 96, 96, 26, 700, 230),
  P('g1000-59', 'Generic 1000×1000 P5.9 outdoor', 1000, 1000, 168, 168, 30, 800, 270),
];

function allPanels(project) { return [...BUILTIN_PANELS, ...((project && project.catalog) || [])]; }
function findPanel(project, id) {
  return ((project && project.catalog) || []).find((p) => p.id === id) || BUILTIN_PANELS.find((p) => p.id === id) || null;
}
function getPanel(project, id) { return findPanel(project, id) || BUILTIN_PANELS[3]; }
function pitchOf(p) { return p.w / p.px; }
function fmtPitch(p) { return (Math.round(pitchOf(p) * 1000) / 1000).toFixed(3); }

/* ---------- screen kinds (presets for "Add screen") ---------- */
const KINDS = {
  main: { label: 'Main', panel: 'g50100-39', cols: 16, rows: 4 },
  side: { label: 'Side', panel: 'g5050-39', cols: 4, rows: 6 },
  totem: { label: 'Totem', panel: 'g50100-39', cols: 2, rows: 4 },
  banner: { label: 'Banner / fascia', panel: 'g5050-39', cols: 20, rows: 1 },
  dj: { label: 'DJ booth front', panel: 'g5050-39', cols: 6, rows: 2 },
  arc: { label: 'Arc / cylinder', panel: 'g5050-39', cols: 16, rows: 4, shape: 'concave', angle: 7.5 },
  free: { label: 'Free', panel: 'g5050-39', cols: 4, rows: 3 },
};
const KIND_ORDER = ['main', 'side', 'totem', 'banner', 'dj', 'arc', 'free'];

/* ---------- NovaStar controllers (from NovaStar specifications; capacities at 8-bit) ----------
   ports: Gigabit Ethernet outputs · capacity: total pixels one unit drives · maxW/maxH: widest and
   tallest image one unit outputs. The MCTRL boxes have no scaler, so their limits are those of the
   input signal. "auto" marks the all-in-one VX Pro series, used for automatic suggestions. */
const CONTROLLERS = [
  { id: 'vx400pro', name: 'VX400 Pro', ports: 4, capacity: 2600000, maxW: 10240, maxH: 8192, auto: true },
  { id: 'vx600pro', name: 'VX600 Pro', ports: 6, capacity: 3900000, maxW: 10240, maxH: 8192, auto: true },
  { id: 'vx1000pro', name: 'VX1000 Pro', ports: 10, capacity: 6500000, maxW: 10240, maxH: 8192, auto: true },
  { id: 'vx2000pro', name: 'VX2000 Pro', ports: 20, capacity: 13000000, maxW: 16384, maxH: 8192, auto: true },
  { id: 'mctrl300', name: 'MCTRL300', ports: 2, capacity: 1300000, maxW: 3840, maxH: 3840 },
  { id: 'mctrl660pro', name: 'MCTRL660 PRO', ports: 6, capacity: 2300000, maxW: 3840, maxH: 3840 },
  { id: 'mctrl4k', name: 'MCTRL4K', ports: 16, capacity: 8294400, maxW: 3840, maxH: 3840 },
];

/* ---------- defaults ---------- */
function defaultSettings() {
  return {
    portCapacity: 650000, portPrefix: 'P', backup: false, controller: 'auto',
    voltage: 230, circuitAmps: 16, loadFactor: 0.8, powerFactor: 0.95, powerBasis: 'max',
    snap: 50,
    venue: '', address: '', contact: '', phone: '', setup: '', eventDate: '', teardown: '', preparedBy: '', notes: '',
    report3D: true, reportPower: true, reportPacking: true,
  };
}

function defaultScreen(kind = 'free') {
  const k = KINDS[kind] || KINDS.free;
  return {
    id: uid('s-'), name: k.label, kind, color: SCREEN_COLORS[0],
    x: 0, y: 0, z: 0, yaw: 0,
    panel: k.panel, sizeMode: 'grid', cols: k.cols, rows: k.rows,
    tw: 4, th: 2.5, fit: 'nearest',
    mix: { small: 'g5050-39', big: 'g50100-39', w: 4, h: 2.5, stock: 20 },
    shape: k.shape || 'flat', angle: k.angle || 5,
    holes: [],
    data: { dir: 'h', start: 'bl', path: 'snake', split: 'lines' },
  };
}

function blankProject() {
  const s = defaultScreen('main');
  s.name = 'Main screen'; s.cols = 8; s.rows = 4; s.panel = 'g50100-39'; s.y = 1000;
  return { v: VERSION, id: uid('p-'), name: 'Untitled project', client: '', revision: 'A',
    created: new Date().toISOString(), updated: new Date().toISOString(),
    settings: defaultSettings(), catalog: [], screens: [s] };
}

function exampleProject() {
  const main = Object.assign(defaultScreen('main'), { name: 'Main screen', color: SCREEN_COLORS[0], cols: 19, rows: 4, panel: 'g50100-39', x: 0, y: 1000 });
  const left = Object.assign(defaultScreen('side'), { name: 'Side left', color: SCREEN_COLORS[1], cols: 4, rows: 6, panel: 'g5050-39', x: -6750, y: 1500, yaw: 15 });
  const right = Object.assign(defaultScreen('side'), { name: 'Side right', color: SCREEN_COLORS[2], cols: 4, rows: 6, panel: 'g5050-39', x: 6750, y: 1500, yaw: -15 });
  const dj = Object.assign(defaultScreen('dj'), { name: 'DJ booth front', color: SCREEN_COLORS[3], cols: 6, rows: 2, panel: 'g5050-39', x: 0, y: 0, z: 2500 });
  return { v: VERSION, id: uid('p-'), name: 'Example: festival stage', client: 'Example client', revision: 'A',
    created: new Date().toISOString(), updated: new Date().toISOString(), example: true,
    settings: Object.assign(defaultSettings(), { venue: 'Main stage' }), catalog: [], screens: [main, left, right, dj] };
}

/* ---------- validation / migration (used for imports and stored data) ---------- */
function normalizeProject(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('The file is not a project.');
  if (!Array.isArray(raw.screens)) throw new Error('The file has no screens list.');
  const p = {
    v: VERSION,
    id: typeof raw.id === 'string' && /^[A-Za-z0-9_.~:@+-]{1,60}$/.test(raw.id) ? raw.id : uid('p-'),
    name: String(raw.name || 'Imported project').slice(0, 120),
    client: String(raw.client || '').slice(0, 120),
    revision: String(raw.revision || 'A').slice(0, 12),
    created: raw.created || new Date().toISOString(),
    updated: raw.updated || new Date().toISOString(),
    example: !!raw.example,
    settings: Object.assign(defaultSettings(), raw.settings || {}),
    catalog: [], screens: [],
  };
  const st = p.settings;
  st.portCapacity = int(st.portCapacity, 650000) > 0 ? clamp(int(st.portCapacity, 650000), 1000, 1e9) : 650000;
  st.voltage = clamp(num(st.voltage, 230), 50, 1000);
  st.circuitAmps = clamp(num(st.circuitAmps, 16), 1, 1000);
  st.loadFactor = clamp(num(st.loadFactor, 0.8), 0.1, 1);
  st.powerFactor = clamp(num(st.powerFactor, 0.95), 0.5, 1);
  st.snap = clamp(int(st.snap, 50), 1, 5000);
  st.powerBasis = st.powerBasis === 'avg' ? 'avg' : 'max';
  st.portPrefix = String(st.portPrefix || 'P').slice(0, 4);
  st.backup = st.backup === true;
  st.controller = CONTROLLERS.some((c) => c.id === st.controller) ? st.controller : 'auto';
  for (const k of ['venue', 'address', 'contact', 'phone', 'setup', 'eventDate', 'teardown', 'preparedBy']) st[k] = String(st[k] ?? '').slice(0, 160);
  st.notes = String(st.notes ?? '').slice(0, 2000);
  for (const k of ['report3D', 'reportPower', 'reportPacking']) st[k] = st[k] !== false;
  for (const c of (raw.catalog || [])) {
    if (!c || typeof c !== 'object') continue;
    p.catalog.push(normalizePanel(c));
  }
  for (const rs of raw.screens.filter((x) => x && typeof x === 'object' && !Array.isArray(x)).slice(0, 64)) {
    const d = defaultScreen(KINDS[rs && rs.kind] ? rs.kind : 'free');
    const s = Object.assign(d, rs || {});
    s.id = typeof s.id === 'string' && s.id ? s.id.slice(0, 40) : uid('s-');
    s.name = String(s.name || 'Screen').slice(0, 80);
    s.color = /^#[0-9a-fA-F]{6}$/.test(s.color) ? s.color : SCREEN_COLORS[0];
    s.x = num(s.x); s.y = num(s.y); s.z = num(s.z); s.yaw = clamp(num(s.yaw), -180, 180);
    s.cols = clamp(int(s.cols, 4), 1, 200); s.rows = clamp(int(s.rows, 3), 1, 100);
    s.tw = clamp(num(s.tw, 4), 0.1, 200); s.th = clamp(num(s.th, 2.5), 0.1, 100);
    s.sizeMode = ['grid', 'meters', 'mix'].includes(s.sizeMode) ? s.sizeMode : 'grid';
    s.fit = ['nearest', 'down', 'up'].includes(s.fit) ? s.fit : 'nearest';
    s.mix = Object.assign(defaultScreen().mix, s.mix || {});
    s.mix.w = clamp(num(s.mix.w, 4), 0.1, 200); s.mix.h = clamp(num(s.mix.h, 2.5), 0.1, 100); s.mix.stock = clamp(int(s.mix.stock, 0), 0, 100000);
    s.shape = ['flat', 'concave', 'convex'].includes(s.shape) ? s.shape : 'flat';
    s.angle = clamp(num(s.angle, 5), 0.5, 45);
    s.holes = Array.isArray(s.holes) ? s.holes.filter((k) => typeof k === 'string' && /^\d+,\d+$/.test(k)).slice(0, 20000) : [];
    s.data = Object.assign({ dir: 'h', start: 'bl', path: 'snake', split: 'lines' }, s.data || {});
    if (!['h', 'v'].includes(s.data.dir)) s.data.dir = 'h';
    if (!['bl', 'br', 'tl', 'tr'].includes(s.data.start)) s.data.start = 'bl';
    if (!['snake', 'z'].includes(s.data.path)) s.data.path = 'snake';
    if (!['lines', 'fill'].includes(s.data.split)) s.data.split = 'lines';
    if (!findPanel(p, s.panel)) s.panel = BUILTIN_PANELS[3].id;
    if (!findPanel(p, s.mix.small)) s.mix.small = 'g5050-39';
    if (!findPanel(p, s.mix.big)) s.mix.big = 'g50100-39';
    p.screens.push(s);
  }
  // unique screen ids
  const seen = new Set();
  for (const s of p.screens) { while (seen.has(s.id)) s.id = uid('s-'); seen.add(s.id); }
  return p;
}

function normalizePanel(c) {
  const opt = (v) => (v === '' || v === null || v === undefined || !Number.isFinite(num(v, NaN)) ? null : Math.max(0, num(v)));
  return {
    id: typeof c.id === 'string' && c.id ? c.id.slice(0, 40) : uid('c-'),
    name: String(c.name || 'Custom panel').slice(0, 80),
    w: clamp(num(c.w, 500), 10, 5000), h: clamp(num(c.h, 500), 10, 5000),
    px: clamp(int(c.px, 128), 1, 8192), py: clamp(int(c.py, 128), 1, 8192),
    kg: opt(c.kg), wMax: opt(c.wMax), wAvg: opt(c.wAvg), builtin: false,
  };
}

/* ---------- formatting ---------- */
const fmtInt = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '—');
function fmtNum(n, maxDec = 2) {
  if (!Number.isFinite(n)) return '—';
  const f = Math.pow(10, maxDec);
  return (Math.round(n * f) / f).toLocaleString('en-US', { maximumFractionDigits: maxDec });
}
const fmtM = (mm, dec = 3) => fmtNum(mm / 1000, dec);           // 9500 -> "9.5"
const fmtSize = (wmm, hmm) => `${fmtM(wmm)} × ${fmtM(hmm)} m`;
const fmtRes = (w, h) => `${fmtInt(w)} × ${fmtInt(h)}`;
function colLetter(i) { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
function slug(s) { return String(s || 'project').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'project'; }

function ratioInfo(w, h) {
  if (!(w > 0) || !(h > 0)) return { text: '—', delta: 0, value: 0 };
  const g = gcd(w, h); const a = Math.round(w / g), b = Math.round(h / g);
  const text = a <= 32 && b <= 32 ? `${a}:${b}` : `${(w / h).toFixed(2)}:1`;
  return { text, delta: (w / h) / (16 / 9) - 1, value: w / h };
}
function fmtDelta(d) { const v = d * 100; return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}% vs 16:9`; }

/* ---------- size resolution ---------- */
function resolveRows(project, s, warnings, info) {
  const EPS = 1e-6;
  if (s.sizeMode === 'mix') {
    const small = getPanel(project, s.mix.small), big = getPanel(project, s.mix.big);
    if (Math.abs(small.w - big.w) > 0.01) warnings.push('The two mixed panels have different widths, so columns will not line up.');
    if (Math.abs(pitchOf(small) - pitchOf(big)) > 0.001) warnings.push('The two mixed panels have different pixel pitch.');
    const colW = small.w;
    const cols = clamp(Math.round(s.mix.w * 1000 / colW), 1, 200);
    const totalH = s.mix.h * 1000;
    const bigByStock = Math.floor(s.mix.stock / cols);
    const bigByHeight = Math.floor(totalH / big.h + EPS);
    const bigRows = clamp(Math.min(bigByStock, bigByHeight), 0, 100);
    const rest = totalH - bigRows * big.h;
    let smallRows = clamp(Math.round(rest / small.h), 0, 100 - bigRows);
    if (bigRows + smallRows === 0) smallRows = 1;
    info.mix = { bigRows, smallRows, bigUsed: bigRows * cols, smallUsed: smallRows * cols, bigLeft: Math.max(0, s.mix.stock - bigRows * cols), targetW: s.mix.w * 1000, targetH: totalH };
    info.target = { w: s.mix.w * 1000, h: totalH };
    return { cols, rowPanels: [...Array(bigRows).fill(big), ...Array(smallRows).fill(small)] };
  }
  const p = getPanel(project, s.panel);
  let cols = s.cols, rows = s.rows;
  if (s.sizeMode === 'meters') {
    const f = s.fit === 'down' ? (x) => Math.floor(x + EPS) : s.fit === 'up' ? (x) => Math.ceil(x - EPS) : (x) => Math.round(x);
    cols = f(s.tw * 1000 / p.w); rows = f(s.th * 1000 / p.h);
    info.target = { w: s.tw * 1000, h: s.th * 1000 };
  }
  cols = clamp(int(cols, 1), 1, 200); rows = clamp(int(rows, 1), 1, 100);
  return { cols, rowPanels: Array(rows).fill(p) };
}

/* ---------- routing (data ports / power circuits) ---------- */
function orderLines(grid, cols, R, pat) {
  const dir = pat.dir === 'v' ? 'v' : 'h';
  const start = ['bl', 'br', 'tl', 'tr'].includes(pat.start) ? pat.start : 'bl';
  const snake = pat.path !== 'z';
  const lines = [];
  if (dir === 'h') {
    const bottomFirst = start[0] === 'b';
    let forward = start[1] === 'l';
    for (let i = 0; i < R; i++) {
      const r = bottomFirst ? i : R - 1 - i;
      const line = [];
      for (let j = 0; j < cols; j++) { const c = forward ? j : cols - 1 - j; const cell = grid[r][c]; if (cell && cell.active) line.push(cell); }
      if (line.length) { lines.push(line); if (snake) forward = !forward; }
    }
  } else {
    const leftFirst = start[1] === 'l';
    let up = start[0] === 'b';
    for (let i = 0; i < cols; i++) {
      const c = leftFirst ? i : cols - 1 - i;
      const line = [];
      for (let j = 0; j < R; j++) { const r = up ? j : R - 1 - j; const cell = grid[r][c]; if (cell && cell.active) line.push(cell); }
      if (line.length) { lines.push(line); if (snake) up = !up; }
    }
  }
  return lines;
}

function splitBalanced(line, cap, wf) {
  const total = sum(line, wf);
  const k = Math.max(1, Math.ceil(total / cap));
  const chunks = []; let cur = [], load = 0, done = 0;
  for (const cell of line) {
    const w = wf(cell);
    const left = Math.max(1, k - chunks.length);
    const target = (total - done) / left;
    if (cur.length && (load + w > cap || (left > 1 && load + w / 2 > target))) { chunks.push(cur); done += load; cur = []; load = 0; }
    cur.push(cell); load += w;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

function splitLines(lines, cap, wf, mode) {
  const groups = [];
  const push = (cells) => { if (cells.length) groups.push({ cells, load: sum(cells, wf) }); };
  if (!(cap > 0)) { push(lines.flat()); return groups; }
  if (mode === 'fill') {
    let cur = [], load = 0;
    for (const line of lines) for (const cell of line) {
      const w = wf(cell);
      if (cur.length && load + w > cap) { push(cur); cur = []; load = 0; }
      cur.push(cell); load += w;
    }
    push(cur); return groups;
  }
  let cur = [], load = 0;
  for (const line of lines) {
    const lw = sum(line, wf);
    if (lw > cap) { push(cur); cur = []; load = 0; for (const ch of splitBalanced(line, cap, wf)) push(ch); continue; }
    if (cur.length && load + lw > cap) { push(cur); cur = []; load = 0; }
    cur = cur.concat(line); load += lw;
  }
  push(cur); return groups;
}

/* ---------- the main per-screen computation ---------- */
function computeScreen(project, s) {
  const st = project.settings || defaultSettings();
  const warnings = [], info = {};
  const { cols, rowPanels } = resolveRows(project, s, warnings, info);
  const R = rowPanels.length;
  const holes = new Set(s.holes || []);

  const rowY = [], rowPy = rowPanels.map((p) => p.py);
  let yAcc = 0; for (let r = 0; r < R; r++) { rowY.push(yAcc); yAcc += rowPanels[r].h; }
  const H = yAcc;
  const W = Math.max(...rowPanels.map((p) => p.w * cols));
  const resW = Math.max(...rowPanels.map((p) => p.px * cols));
  const resH = sum(rowPy);
  const pyTop = []; { let a = 0; for (let r = R - 1; r >= 0; r--) { pyTop[r] = a; a += rowPy[r]; } }

  const cells = [], grid = [];
  for (let r = 0; r < R; r++) {
    const p = rowPanels[r]; grid[r] = [];
    for (let c = 0; c < cols; c++) {
      const key = c + ',' + r;
      const cell = { c, r, key, panel: p, x: c * p.w, y: rowY[r], w: p.w, h: p.h, px0: c * p.px, py0: pyTop[r], pw: p.px, ph: p.py,
        active: !holes.has(key), build: 0, port: -1, seq: 0, circ: -1, cseq: 0 };
      cells.push(cell); grid[r][c] = cell;
    }
  }
  const active = cells.filter((c) => c.active);

  // build order numbers: vertical serpentine from bottom-left (typical ground-stack build order)
  { let n = 0; for (let c = 0; c < cols; c++) { const up = c % 2 === 0; for (let i = 0; i < R; i++) { const r = up ? i : R - 1 - i; const cell = grid[r][c]; if (cell.active) cell.build = ++n; } } }

  // counts by panel type
  const byPanel = {};
  for (const c of active) { const k = c.panel.id; (byPanel[k] = byPanel[k] || { panel: c.panel, count: 0 }).count++; }

  const pixels = sum(active, (c) => c.pw * c.ph);
  const area = sum(active, (c) => c.w * c.h) / 1e6;
  const envelope = (W * H) / 1e6;
  const hasAll = (f) => active.length > 0 && active.every((c) => Number.isFinite(c.panel[f]) && c.panel[f] !== null);
  const weight = hasAll('kg') ? sum(active, (c) => c.panel.kg) : null;
  // heaviest column: what one flown column of cabinets weighs (cabinets only, no rigging)
  let heaviestCol = null;
  if (weight !== null) {
    const colKg = new Array(cols).fill(0);
    for (const c of active) colKg[c.c] += c.panel.kg;
    let best = 0; for (let i = 1; i < cols; i++) if (colKg[i] > colKg[best] + 1e-9) best = i;
    heaviestCol = { col: best, kg: colKg[best] };
  }
  const wMax = hasAll('wMax') ? sum(active, (c) => c.panel.wMax) : null;
  const wAvg = hasAll('wAvg') ? sum(active, (c) => c.panel.wAvg) : null;
  const ratio = ratioInfo(resW, resH);

  // data routing
  const lines = orderLines(grid, cols, R, s.data || {});
  const portCap = clamp(int(st.portCapacity, 650000), 1000, 1e9);
  const dataGroups = splitLines(lines, portCap, (c) => c.pw * c.ph, (s.data || {}).split);
  const ports = dataGroups.map((g, i) => {
    g.cells.forEach((c, j) => { c.port = i; c.seq = j + 1; });
    return { i, label: `${st.portPrefix || 'P'}${i + 1}`, color: PORT_COLORS[i % PORT_COLORS.length], cells: g.cells, load: g.load, cap: portCap, count: g.cells.length };
  });
  if (ports.some((p) => p.load > p.cap)) warnings.push('A single cabinet has more pixels than one data port carries.');

  // power routing (same path as data)
  let power = null;
  const basisKey = st.powerBasis === 'avg' ? 'wAvg' : 'wMax';
  // same limits as normalizeProject, so a half-typed setting can never produce nonsense
  const volts = clamp(num(st.voltage, 230), 50, 1000), amps = clamp(num(st.circuitAmps, 16), 1, 1000);
  const loadShare = clamp(num(st.loadFactor, 0.8), 0.1, 1), pf = clamp(num(st.powerFactor, 1), 0.5, 1);
  // breaker limits current: usable real power = V × A × load share × power factor
  const circuitW = volts * amps * loadShare * pf;
  if (hasAll(basisKey) && circuitW > 0) {
    const pg = splitLines(lines, circuitW, (c) => c.panel[basisKey], 'fill');
    const circuits = pg.map((g, i) => {
      g.cells.forEach((c, j) => { c.circ = i; c.cseq = j + 1; });
      return { i, label: `C${i + 1}`, color: CIRCUIT_COLORS[i % CIRCUIT_COLORS.length], cells: g.cells, load: g.load, cap: circuitW, count: g.cells.length, amps: g.load / (volts * pf) };
    });
    if (circuits.some((c) => c.load > c.cap)) warnings.push('A single cabinet draws more than one circuit allows.');
    power = { circuits, circuitW, basis: basisKey, pf };
  }

  // curve
  let curve = null;
  const colW = rowPanels[0].w;
  if (s.shape === 'concave' || s.shape === 'convex') {
    const a = clamp(num(s.angle, 5), 0.5, 45);
    const arcRaw = a * cols;
    const arc = Math.min(360, arcRaw);
    const rIn = (colW / 2) / Math.tan(rad(a) / 2);
    const rOut = Math.hypot(rIn, colW / 2);
    const closed = arcRaw >= 359.999;
    const chord = closed ? 2 * rOut : 2 * rOut * Math.sin(rad(arc) / 2);
    const mid = cols % 2 === 0 ? rOut : rIn;      // distance from the curve centre to the middle of the wall
    const depth = closed ? 2 * rOut : mid - rOut * Math.cos(rad(arc) / 2);
    if (arcRaw > 360.001) warnings.push(`The curve goes past a full circle (${cols} columns × ${fmtNum(a)}° = ${fmtNum(arcRaw)}°).`);
    curve = { shape: s.shape, angle: a, arc, closed, rIn, rOut, chord, depth };
  }

  if (info.target) {
    const dw = W - info.target.w, dh = H - info.target.h;
    info.target.dw = dw; info.target.dh = dh;
  }

  return {
    id: s.id, screen: s, cols, rows: R, rowPanels, rowY, W, H, resW, resH, cells, grid, active,
    count: active.length, holes: cells.length - active.length, byPanel, pixels, area, envelope,
    weight, heaviestCol, wMax, wAvg, ratio, ports, power, curve, colW, warnings, info, lines,
  };
}

function holesInGrid(s, comp) {
  return (s.holes || []).filter((k) => { const [c, r] = k.split(',').map(Number); return c < comp.cols && r < comp.rows; });
}

/* ---------- project totals ---------- */
function computeTotals(project, comps) {
  const list = project.screens.map((s) => comps[s.id]).filter(Boolean);
  const tot = { screens: list.length, cabinets: sum(list, (c) => c.count), pixels: sum(list, (c) => c.pixels), area: sum(list, (c) => c.area),
    ports: sum(list, (c) => c.ports.length), circuits: list.every((c) => c.power) ? sum(list, (c) => c.power.circuits.length) : null,
    backupPorts: project.settings && project.settings.backup ? sum(list, (c) => c.ports.length) : 0,
    weight: list.every((c) => c.weight !== null) ? sum(list, (c) => c.weight) : null,
    wMax: list.every((c) => c.wMax !== null) ? sum(list, (c) => c.wMax) : null,
    wAvg: list.every((c) => c.wAvg !== null) ? sum(list, (c) => c.wAvg) : null };
  const byPanel = {};
  for (const c of list) for (const k in c.byPanel) { const b = c.byPanel[k]; (byPanel[k] = byPanel[k] || { panel: b.panel, count: 0 }).count += b.count; }
  tot.byPanel = byPanel;
  return tot;
}

/* ---------- controller plan: which NovaStar unit(s), and what each output feeds ---------- */
function controllerById(id) { return CONTROLLERS.find((d) => d.id === id) || null; }
function screenFitsController(D, comp) { return comp.resW <= D.maxW && comp.resH <= D.maxH; }

// Fills units in screen order. A screen stays on one unit when it fits on a fresh one.
// With backup on, each unit takes half its outputs as main ports and uses the other half for their backups.
function assignControllers(project, comps, D) {
  const backup = !!(project.settings && project.settings.backup);
  const per = backup ? Math.floor(D.ports / 2) : D.ports;
  if (per < 1) return [];
  const units = [];
  let cur = null;
  const open = () => { cur = { mains: [], pixels: 0 }; units.push(cur); };
  for (const s of project.screens) {
    const c = comps[s.id]; if (!c || !c.ports.length) continue;
    const px = sum(c.ports, (p) => p.load);
    if (cur && cur.mains.length && (cur.mains.length + c.ports.length > per || cur.pixels + px > D.capacity) && c.ports.length <= per && px <= D.capacity) open();
    for (const p of c.ports) {
      if (!cur || cur.mains.length >= per || cur.pixels + p.load > D.capacity) open();
      cur.mains.push({ screen: s, comp: c, port: p });
      cur.pixels += p.load;
    }
  }
  // outputs: main ports first, then their backups in the same order
  units.forEach((u, ui) => {
    u.index = ui; u.rows = [];
    u.mains.forEach((m, k) => u.rows.push({ out: k + 1, role: 'main', screen: m.screen, comp: m.comp, port: m.port, at: m.port.cells[0] }));
    if (backup) u.mains.forEach((m, k) => u.rows.push({ out: u.mains.length + k + 1, role: 'backup', backupOf: k + 1, screen: m.screen, comp: m.comp, port: m.port, at: m.port.cells[m.port.cells.length - 1] }));
    u.used = u.rows.length;
  });
  return units;
}

function planControllers(project, comps) {
  const st = project.settings || defaultSettings();
  const shown = project.screens.filter((s) => comps[s.id] && comps[s.id].ports.length);
  const mains = sum(shown, (s) => comps[s.id].ports.length);
  if (!mains) return null;
  const pixels = sum(shown, (s) => sum(comps[s.id].ports, (p) => p.load));
  const chosen = st.controller !== 'auto' ? controllerById(st.controller) : null;
  let D = chosen, units = null;
  if (D) units = assignControllers(project, comps, D);
  else {
    // smallest all-in-one controller that takes the whole project on one unit, else several of the largest
    const autos = CONTROLLERS.filter((d) => d.auto);
    for (const d of autos) {
      const u = assignControllers(project, comps, d);
      if (u.length === 1 && shown.every((s) => screenFitsController(d, comps[s.id]))) { D = d; units = u; break; }
    }
    if (!D) { D = autos[autos.length - 1]; units = assignControllers(project, comps, D); }
  }
  const warnings = [];
  for (const s of shown) {
    const c = comps[s.id];
    if (!screenFitsController(D, c)) warnings.push(`${s.name} is ${fmtInt(c.resW)} × ${fmtInt(c.resH)} px, larger than the ${fmtInt(D.maxW)} × ${fmtInt(D.maxH)} px one ${D.name} outputs, so it has to be shared between units.`);
  }
  return { model: D, auto: !chosen, units, count: units.length, mains, backups: st.backup ? mains : 0, pixels, warnings };
}

/* ---------- packing list ---------- */
// Cable runs between consecutive cabinets of a chain: neighbours need a short link cable; anything else
// (across an empty position, a Z return, panels of different widths) needs a longer one, sized from the
// distance between cabinet centres along the frame plus 0.5 m, rounded up to whole metres.
function chainLinks(cells) {
  let short = 0; const long = [];
  for (let i = 1; i < cells.length; i++) {
    const a = cells[i - 1], b = cells[i];
    const dx = Math.abs((a.x + a.w / 2) - (b.x + b.w / 2)), dy = Math.abs((a.y + a.h / 2) - (b.y + b.h / 2));
    const next = (dy < 1 && dx <= (a.w + b.w) / 2 + 1) || (dx < 1 && dy <= (a.h + b.h) / 2 + 1);
    if (next) short++; else long.push(Math.ceil((dx + dy) / 1000 + 0.5));
  }
  return { short, long };
}

function packingList(project, comps, plan) {
  const st = project.settings || defaultSettings();
  const list = project.screens.map((s) => ({ s, c: comps[s.id] })).filter((x) => x.c);
  const items = [];
  const per = (f) => list.map(({ s, c }) => ({ name: s.name, n: f(c) })).filter((x) => x.n > 0);
  const add = (group, item, parts, note = '') => { const qty = sum(parts, (x) => x.n); if (qty > 0) items.push({ group, item, qty, parts, note }); };
  // cabinets, by type
  const types = new Map();
  for (const { s, c } of list) for (const b of Object.values(c.byPanel)) {
    if (!types.has(b.panel.id)) types.set(b.panel.id, { panel: b.panel, parts: [] });
    types.get(b.panel.id).parts.push({ name: s.name, n: b.count });
  }
  for (const t of types.values()) {
    const p = t.panel;
    add('Cabinets', `${p.name} (${+p.w.toFixed(1)} × ${+p.h.toFixed(1)} mm)`, t.parts, p.kg !== null ? `${fmtNum(p.kg, 1)} kg each${p.builtin ? ', typical' : ''}` : '');
  }
  // data
  if (plan) items.push({ group: 'Data', item: `NovaStar ${plan.model.name} controller`, qty: plan.count, parts: [], note: `${plan.mains} main${plan.backups ? ` + ${plan.backups} backup` : ''} port${plan.mains + plan.backups === 1 ? '' : 's'} in use` });
  add('Data', 'Data cable, controller to first cabinet', per((c) => c.ports.length), 'length to suit the controller position');
  if (st.backup) add('Data', 'Backup data cable, last cabinet back to controller', per((c) => c.ports.length), 'length to suit the controller position');
  const dl = new Map(list.map(({ s, c }) => [s.id, c.ports.map((p) => chainLinks(p.cells))]));
  add('Data', 'Data link cable, cabinet to next cabinet', per((c) => sum(dl.get(c.id), (x) => x.short)));
  const lengths = (f) => { const all = new Set(); for (const { s } of list) for (const x of f(s.id)) for (const L of x.long) all.add(L); return [...all].sort((a, b) => a - b); };
  for (const L of lengths((id) => dl.get(id))) add('Data', `Data link cable, at least ${L} m`, per((c) => sum(dl.get(c.id), (x) => x.long.filter((v) => v === L).length)), 'across an empty position, a Z return or a row change');
  // power
  if (list.length && list.every(({ c }) => c.power)) {
    add('Power', `Power feed cable, one per ${fmtInt(st.circuitAmps)} A circuit`, per((c) => c.power.circuits.length), 'length to suit the distribution');
    const pl = new Map(list.map(({ s, c }) => [s.id, c.power.circuits.map((k) => chainLinks(k.cells))]));
    add('Power', 'Power link cable, cabinet to next cabinet', per((c) => sum(pl.get(c.id), (x) => x.short)));
    for (const L of lengths((id) => pl.get(id))) add('Power', `Power link cable, at least ${L} m`, per((c) => sum(pl.get(c.id), (x) => x.long.filter((v) => v === L).length)), 'across an empty position, a Z return or a row change');
  }
  return items;
}

/* ---------- 16:9 suggestions ---------- */
function suggest169(p, curCols, curRows) {
  const out = []; const k = (p.py / p.px) * 16 / 9; const seen = new Set();
  for (let rows = 1; rows <= 40; rows++) {
    for (const cols of [Math.floor(rows * k), Math.ceil(rows * k)]) {
      if (cols < 1 || cols > 200) continue;
      const key = cols + 'x' + rows; if (seen.has(key)) continue; seen.add(key);
      const dev = ((cols * p.px) / (rows * p.py)) / (16 / 9) - 1;
      if (Math.abs(dev) <= 0.025) out.push({ cols, rows, dev, w: cols * p.w, h: rows * p.h, resW: cols * p.px, resH: rows * p.py });
    }
  }
  const cur = Math.max(1, curCols * p.w * curRows * p.h);
  out.sort((a, b) => Math.abs(Math.log((a.w * a.h) / cur)) - Math.abs(Math.log((b.w * b.h) / cur)) || Math.abs(a.dev) - Math.abs(b.dev));
  return out.slice(0, 6).sort((a, b) => a.w - b.w);
}

/* ---------- 3D facet transforms (screen-local, metres are derived by the caller) ---------- */
function facetTransforms(comp) {
  const C = comp.cols, colW = comp.colW, out = [];
  const cv = comp.curve;
  for (let i = 0; i < C; i++) {
    if (!cv) { out.push({ x: (i + 0.5) * colW - comp.W / 2, z: 0, yaw: 0 }); continue; }
    const phi = rad((i + 0.5 - C / 2) * cv.angle);
    const off = cv.rIn - cv.rIn * Math.cos(phi);
    if (cv.shape === 'concave') out.push({ x: cv.rIn * Math.sin(phi), z: off, yaw: -phi });
    else out.push({ x: cv.rIn * Math.sin(phi), z: -off, yaw: phi });
  }
  return out;
}

/* ---------- new-screen placement ---------- */
function placeNewScreen(project, s, comp) {
  const others = project.screens.filter((o) => o.id !== s.id);
  if (!others.length) { s.x = 0; return; }
  let minL = Infinity, maxR = -Infinity;
  for (const o of others) {
    const c = computeScreen(project, o);
    minL = Math.min(minL, o.x - c.W / 2); maxR = Math.max(maxR, o.x + c.W / 2);
  }
  const gap = 1000;
  const sides = others.filter((o) => o.x !== 0).length;
  const goLeft = sides % 2 === 0;
  s.x = Math.round((goLeft ? minL - gap - comp.W / 2 : maxR + gap + comp.W / 2) / 50) * 50;
}

function nextColor(project) {
  const used = new Set(project.screens.map((s) => s.color));
  return SCREEN_COLORS.find((c) => !used.has(c)) || SCREEN_COLORS[project.screens.length % SCREEN_COLORS.length];
}
function uniqueName(project, base) {
  const names = new Set(project.screens.map((s) => s.name));
  if (!names.has(base)) return base;
  for (let i = 2; i < 999; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
  return base;
}

if (typeof module !== 'undefined') {
  module.exports = { BUILTIN_PANELS, KINDS, CONTROLLERS, computeScreen, computeTotals, suggest169, exampleProject, blankProject, normalizeProject,
    ratioInfo, splitLines, orderLines, facetTransforms, colLetter, slug, fmtInt, fmtM, fmtSize, getPanel, defaultScreen, placeNewScreen, holesInGrid, defaultSettings,
    planControllers, assignControllers, packingList, chainLinks };
}
