/* ============================================================
   DRAWINGS — screen plan (cabinets / data / power), stage layout,
   native-resolution pixel map and 3D test card.
   All plan/stage drawing goes through a pen so the same code
   renders on screen (SVG), into PNG/textures (canvas) and PDF.
   ============================================================ */

const PRINT_PAL = {
  bg: '#FFFFFF', canvas: '#FFFFFF', ink: '#14202C', ink2: '#3E5164', ink3: '#7A8B9C', grid: '#EEF2F6', gridMajor: '#DCE3EA',
  floor: '#5E6E7E', floorFill: '#F3F5F8', cl: '#9AA9B8', dim: '#4A5B6C', seam: '#FFFFFF', hole: '#9AA9B8', path: '#14202C',
  accent: '#C77700', cellAlpha: 0.42, panelFill: 0.9,
};

function cellLabel(cell, mode, prefix) {
  if (mode === 'data') return cell.port >= 0 ? `${prefix}${cell.port + 1}:${String(cell.seq).padStart(2, '0')}` : '';
  if (mode === 'power') return cell.circ >= 0 ? `C${cell.circ + 1}:${String(cell.cseq).padStart(2, '0')}` : '';
  return String(cell.build || '');
}

/* ---------- screen plan ---------- */
function drawPlan(pen, comp, box, o) {
  const pal = o.pal, fs = o.fs, mode = o.mode || 'cabinets', face = !!o.face;
  const W = comp.W, H = comp.H;
  const axes = !face && o.labels !== false;
  const dims = !face && !!o.dims;
  const m = face ? { l: 0, r: 0, t: 0, b: 0 } : {
    l: axes ? fs * 1.9 : fs * 0.5,
    r: dims ? fs * 4.7 : fs * 0.5,
    t: axes ? fs * 1.6 : fs * 0.5,
    b: dims ? fs * 3.9 : fs * 0.5,
  };
  const aw = Math.max(1, box.w - m.l - m.r), ah = Math.max(1, box.h - m.t - m.b);
  const s = Math.min(aw / W, ah / H);
  const dw = W * s, dh = H * s;
  const ox = box.x + m.l + (face ? 0 : (aw - dw) / 2), oy = box.y + m.t + (face ? 0 : (ah - dh) / 2);
  const X = (mm) => ox + mm * s, Y = (mm) => oy + dh - mm * s;
  const prefix = o.prefix || 'P';
  const alpha = face ? 1 : (pal.cellAlpha ?? 0.6);
  const seamW = face ? Math.max(1, Math.min(6, 18 * s)) : clamp(s * 5, o.minStroke || 0.4, fs * 0.09);
  const geo = { s, ox, oy, dw, dh, X, Y };

  // cells
  for (const cell of comp.cells) {
    const x = X(cell.x), y = Y(cell.y + cell.h), w = cell.w * s, h = cell.h * s;
    if (!cell.active) {
      if (face) continue;
      const hc = pal.hole;
      pen.rect(x + seamW, y + seamW, w - 2 * seamW, h - 2 * seamW, { fill: 'none', stroke: hc, sw: seamW, dash: [fs * 0.25, fs * 0.2], attrs: o.interactive ? { 'data-key': cell.key, class: 'pcell hole' } : undefined });
      pen.line(x + w * 0.3, y + h * 0.3, x + w * 0.7, y + h * 0.7, { stroke: hc, sw: seamW });
      pen.line(x + w * 0.7, y + h * 0.3, x + w * 0.3, y + h * 0.7, { stroke: hc, sw: seamW });
      if (o.interactive) pen.rect(x, y, w, h, { fill: '#000', opacity: 0, attrs: { 'data-key': cell.key, class: 'pcell hole' } });
      continue;
    }
    let col;
    if (mode === 'data') col = cell.port >= 0 ? PORT_COLORS[cell.port % PORT_COLORS.length] : '#888888';
    else if (mode === 'power') col = cell.circ >= 0 ? CIRCUIT_COLORS[cell.circ % CIRCUIT_COLORS.length] : '#888888';
    else col = (cell.c + cell.r) % 2 ? mix(o.screenColor, '#000000', 0.12) : o.screenColor;
    pen.rect(x, y, w, h, { fill: col, opacity: mode === 'cabinets' ? (face ? 1 : (pal.panelFill ?? 0.9)) : alpha, stroke: face ? pal.seam : pal.bg, sw: seamW,
      attrs: o.interactive ? { 'data-key': cell.key, class: 'pcell' } : undefined });
  }

  // data / power path
  if (mode === 'data' || mode === 'power') {
    const groups = mode === 'data' ? comp.ports : (comp.power ? comp.power.circuits : []);
    const pw = face ? Math.max(2, fs * 0.12) : Math.max(face ? 2 : 0.6, fs * 0.085);
    const pcol = pal.path;
    for (const g of groups) {
      const pts = g.cells.map((c) => [X(c.x + c.w / 2), Y(c.y + c.h / 2)]);
      pen.poly(pts, { stroke: pcol, sw: pw, join: 'round', cap: 'round', sopacity: 0.9 });
      const cellMin = Math.min(comp.colW, ...comp.rowPanels.map((rp) => rp.h)) * s;
      const ah = clamp(cellMin * 0.17, Math.max(fs * 0.42, pw * 2.4), fs * 0.8);
      for (let i = 1; i < pts.length; i++) {
        const [x1, y1] = pts[i - 1], [x2, y2] = pts[i];
        const len = Math.hypot(x2 - x1, y2 - y1);
        if (len < ah * 2.2) continue;
        const mx = (x1 + x2) / 2 + (x2 - x1) / len * ah * 0.5, my = (y1 + y2) / 2 + (y2 - y1) / len * ah * 0.5;
        arrowHead(pen, x1, y1, mx, my, ah, { fill: pcol });
      }
      if (pts.length) {
        const [sx, sy] = pts[0];
        const r0 = Math.max(fs * 0.3, pw * 2.2);
        pen.circle(sx, sy, r0, { fill: pcol, stroke: face ? '#000' : pal.bg, sw: pw * 0.8 });
        if (!face) {
          const tw = pen.measure('IN', { size: fs * 0.58, weight: 700, font: 'cond' }) + fs * 0.4;
          const ty = sy + r0 + fs * 0.12;
          pen.rect(sx - tw / 2, ty, tw, fs * 0.78, { fill: pcol, rx: fs * 0.15 });
          pen.text('IN', sx, ty + fs * 0.39, { size: fs * 0.58, weight: 700, font: 'cond', fill: pal.bg, anchor: 'middle', baseline: 'middle' });
        }
        // backup cable: leaves from the last cabinet of the chain back to the controller
        if (mode === 'data' && o.backup && !face) {
          const [ex, ey] = pts[pts.length - 1];
          pen.circle(ex, ey, r0, { fill: pal.bg, stroke: pcol, sw: pw * 1.1 });
          const tw = pen.measure('BK', { size: fs * 0.58, weight: 700, font: 'cond' }) + fs * 0.4;
          const ty = ey - r0 - fs * 0.12 - fs * 0.78;
          pen.rect(ex - tw / 2, ty, tw, fs * 0.78, { fill: pal.bg, stroke: pcol, sw: pw * 0.8, rx: fs * 0.15 });
          pen.text('BK', ex, ty + fs * 0.39, { size: fs * 0.58, weight: 700, font: 'cond', fill: pcol, anchor: 'middle', baseline: 'middle' });
        }
      }
    }
  }

  // labels inside cells
  if (!face && o.labels !== false) {
    for (const cell of comp.cells) {
      if (!cell.active) continue;
      const w = cell.w * s, h = cell.h * s;
      const label = cellLabel(cell, mode, prefix);
      if (!label) continue;
      const size = Math.min(fs * 0.86, h * 0.3, w / (label.length * 0.56 + 0.6));
      if (size < (o.minText || fs * 0.42)) continue;
      const cx = X(cell.x + cell.w / 2);
      const isPath = mode !== 'cabinets';
      const cy = isPath ? Y(cell.y + cell.h) + Math.min(h * 0.26, size * 1.25) : Y(cell.y + cell.h / 2);
      let txt;
      if (mode === 'cabinets') {
        const shade = (cell.c + cell.r) % 2 ? mix(o.screenColor, '#000000', 0.12) : o.screenColor;
        txt = readableOn(mix(pal.bg, shade, pal.panelFill ?? 0.9));
      } else txt = readableOn(mix(pal.bg, mode === 'data' ? PORT_COLORS[cell.port % PORT_COLORS.length] : CIRCUIT_COLORS[cell.circ % CIRCUIT_COLORS.length], alpha));
      pen.text(label, cx, cy, { size, weight: 600, font: mode === 'cabinets' ? 'ui' : 'cond', fill: txt, anchor: 'middle', baseline: 'middle', opacity: 0.95 });
    }
  }

  if (face) return geo;

  // axes: column letters on top, row numbers at left
  if (axes) {
    const ls = Math.min(fs * 0.74, comp.colW * s * 0.55);
    const every = Math.max(1, Math.ceil((fs * 1.1) / (comp.colW * s)));
    for (let c = 0; c < comp.cols; c++) {
      if (c % every) continue;
      pen.text(colLetter(c), X((c + 0.5) * comp.colW), oy - fs * 0.5, { size: Math.max(ls, fs * 0.5), font: 'cond', weight: 600, fill: pal.ink3, anchor: 'middle', baseline: 'alphabetic' });
    }
    const rEvery = Math.max(1, Math.ceil((fs * 0.9) / (Math.min(...comp.rowPanels.map((p) => p.h)) * s)));
    for (let r = 0; r < comp.rows; r++) {
      if (r % rEvery) continue;
      pen.text(String(r + 1), ox - fs * 0.5, Y(comp.rowY[r] + comp.rowPanels[r].h / 2), { size: fs * 0.74, font: 'cond', weight: 600, fill: pal.ink3, anchor: 'end', baseline: 'middle' });
    }
  }

  // dimensions
  if (dims) {
    const dop = { color: pal.dim, text: pal.ink2, sw: Math.max(0.35, fs * 0.06), tick: fs * 0.22, gap: fs * 0.32, size: fs * 0.66 };
    const bottom = Y(0);
    // chain per column
    const cy = bottom + fs * 1.25;
    const colPx = comp.colW * s;
    const chainLabel = fmtNum(comp.colW, 1);
    const fitsChain = colPx > pen.measure(chainLabel, { size: dop.size }) + fs * 0.4;
    pen.line(X(0), cy, X(comp.W), cy, { stroke: dop.color, sw: dop.sw });
    for (let c = 0; c <= comp.cols; c++) {
      const x = X(c * comp.colW);
      pen.line(x - dop.tick, cy + dop.tick, x + dop.tick, cy - dop.tick, { stroke: dop.color, sw: dop.sw * 1.3 });
      if (c < comp.cols && fitsChain) pen.text(chainLabel, x + colPx / 2, cy - dop.gap, { size: dop.size, fill: pal.ink3, anchor: 'middle' });
    }
    dimH(pen, X(0), X(comp.W), bottom + fs * 3.0, `${fmtInt(comp.W)} mm  ·  ${fmtInt(comp.resW)} px`, Object.assign({}, dop, { size: fs * 0.74, weight: 600, text: pal.ink, ext: bottom + fs * 0.25 }));
    // chain per row
    const rx = X(comp.W) + fs * 1.25;
    pen.line(rx, Y(0), rx, Y(comp.H), { stroke: dop.color, sw: dop.sw });
    for (let r = 0; r <= comp.rows; r++) {
      const yv = r < comp.rows ? comp.rowY[r] : comp.H;
      const y = Y(yv);
      pen.line(rx - dop.tick, y + dop.tick, rx + dop.tick, y - dop.tick, { stroke: dop.color, sw: dop.sw * 1.3 });
      if (r < comp.rows) {
        const hpx = comp.rowPanels[r].h * s; const lab = fmtNum(comp.rowPanels[r].h, 1);
        if (hpx > pen.measure(lab, { size: dop.size }) + fs * 0.4) pen.text(lab, rx + dop.gap + dop.size * 0.8, Y(comp.rowY[r] + comp.rowPanels[r].h / 2), { size: dop.size, fill: pal.ink3, anchor: 'middle', baseline: 'alphabetic', rotate: 90 });
      }
    }
    const vx = X(comp.W) + fs * 3.0;
    dimV(pen, vx + fs * 0.4, Y(0), Y(comp.H), `${fmtInt(comp.H)} mm  ·  ${fmtInt(comp.resH)} px`, Object.assign({}, dop, { size: fs * 0.74, weight: 600, text: pal.ink, gap: -fs * 0.95, ext: X(comp.W) + fs * 0.25 }));
  }
  return geo;
}

/* ---------- stage layout (front view, developed) ---------- */
function stageBounds(project, comps) {
  let x0 = Infinity, x1 = -Infinity, y1 = 0;
  for (const s of project.screens) {
    const c = comps[s.id]; if (!c) continue;
    x0 = Math.min(x0, s.x - c.W / 2); x1 = Math.max(x1, s.x + c.W / 2); y1 = Math.max(y1, s.y + c.H);
  }
  if (!Number.isFinite(x0)) { x0 = -3000; x1 = 3000; y1 = 3000; }
  return { x0, x1, y0: 0, y1 };
}

function drawStage(pen, v) {
  const { project, comps, pal, fs, s, tx, ty, box } = v;
  const X = (x) => tx + x * s, Y = (y) => ty - y * s;
  pen.rect(box.x, box.y, box.w, box.h, { fill: pal.canvas });
  const wx0 = (box.x - tx) / s, wx1 = (box.x + box.w - tx) / s;
  const wyTop = (ty - box.y) / s, wyBot = (ty - (box.y + box.h)) / s;

  // grid
  if (v.grid) {
    const steps = [50, 100, 250, 500, 1000, 2000, 5000, 10000, 20000, 50000];
    const minor = steps.find((st) => st * s >= (v.minGrid || 12)) || 50000;
    const major = minor < 1000 ? 1000 : minor * 5;
    const isMaj = (val) => Math.abs(val / major - Math.round(val / major)) < 1e-6;
    for (let gx = Math.ceil(wx0 / minor) * minor; gx <= wx1; gx += minor) {
      const mj = isMaj(gx);
      pen.line(X(gx), box.y, X(gx), box.y + box.h, { stroke: mj ? pal.gridMajor : pal.grid, sw: mj ? (v.print ? 0.25 : 1) : (v.print ? 0.15 : 0.7) });
    }
    for (let gy = Math.ceil(wyBot / minor) * minor; gy <= wyTop; gy += minor) {
      const mj = isMaj(gy);
      pen.line(box.x, Y(gy), box.x + box.w, Y(gy), { stroke: mj ? pal.gridMajor : pal.grid, sw: mj ? (v.print ? 0.25 : 1) : (v.print ? 0.15 : 0.7) });
    }
    if (!v.print) {
      for (let gx = Math.ceil(wx0 / major) * major; gx <= wx1; gx += major) {
        if (Math.abs(X(gx) - box.x) < fs * 2 || Math.abs(gx) < 1e-6) continue;
        pen.text(`${fmtNum(gx / 1000, 1)} m`, X(gx) + fs * 0.25, box.y + fs * 0.95, { size: fs * 0.66, fill: pal.ink3, font: 'mono' });
      }
      for (let gy = Math.ceil(Math.max(0, wyBot) / major) * major; gy <= wyTop; gy += major) {
        if (gy === 0) continue;
        pen.text(`${fmtNum(gy / 1000, 1)} m`, box.x + fs * 0.35, Y(gy) - fs * 0.3, { size: fs * 0.66, fill: pal.ink3, font: 'mono' });
      }
    }
  }

  // floor
  const fy = Y(0);
  if (fy < box.y + box.h) {
    const top = Math.max(fy, box.y);
    pen.rect(box.x, top, box.w, box.y + box.h - top, { fill: pal.floorFill });
    if (fy >= box.y) {
      pen.line(box.x, fy, box.x + box.w, fy, { stroke: pal.floor, sw: v.print ? 0.4 : 1.5 });
      pen.text('FLOOR ±0.00', box.x + fs * 0.6, fy + fs * 1.15, { size: fs * 0.7, fill: pal.ink3, font: 'cond', weight: 600, ls: v.print ? undefined : 0.8 });
    }
  }
  // centre line
  const clx = X(0);
  if (clx > box.x && clx < box.x + box.w) {
    pen.line(clx, box.y + fs * 1.6, clx, Math.min(fy, box.y + box.h), { stroke: pal.cl, sw: v.print ? 0.25 : 1, dash: v.print ? [2.4, 1.2, 0.6, 1.2] : [9, 4, 2, 4] });
    pen.text('CL', clx, box.y + fs * 1.25, { size: fs * 0.72, fill: pal.ink3, font: 'cond', weight: 700, anchor: 'middle' });
  }

  // pass 1: screen bodies, back to front (higher Z is closer to the audience)
  const sel = v.selection || new Set();
  const order = [...project.screens].sort((a, b) => (a.z || 0) - (b.z || 0));
  const rects = new Map();
  for (const sc of order) {
    const comp = comps[sc.id]; if (!comp) continue;
    const left = sc.x - comp.W / 2;
    const sx = X(left), sy = Y(sc.y + comp.H), sw = comp.W * s, sh = comp.H * s;
    rects.set(sc.id, { sx, sy, sw, sh });
    const cellPx = Math.min(comp.colW, ...comp.rowPanels.map((p) => p.h)) * s;
    const seam = v.print ? 0.18 : clamp(cellPx * 0.06, 0.5, 1.2);
    if (cellPx >= 3 && comp.cells.length <= 1500) {
      for (const cell of comp.cells) {
        const x = X(left + cell.x), y = Y(sc.y + cell.y + cell.h), w = cell.w * s, h = cell.h * s;
        if (cell.active) pen.rect(x, y, w, h, { fill: sc.color, opacity: v.print ? 0.85 : 0.9, stroke: pal.canvas, sw: seam });
        else pen.rect(x + seam, y + seam, w - seam * 2, h - seam * 2, { fill: 'none', stroke: sc.color, sw: seam, dash: [3 * seam + 1, 2 * seam + 1], sopacity: 0.8 });
      }
    } else {
      // large screens: one body plus grid lines keeps dragging smooth
      pen.rect(sx, sy, sw, sh, { fill: sc.color, opacity: 0.9 });
      if (cellPx >= 3) {
        for (let c = 1; c < comp.cols; c++) pen.line(X(left + c * comp.colW), sy, X(left + c * comp.colW), sy + sh, { stroke: pal.canvas, sw: seam });
        for (let r = 1; r < comp.rows; r++) pen.line(sx, Y(sc.y + comp.rowY[r]), sx + sw, Y(sc.y + comp.rowY[r]), { stroke: pal.canvas, sw: seam });
        for (const cell of comp.cells) if (!cell.active) pen.rect(X(left + cell.x), Y(sc.y + cell.y + cell.h), cell.w * s, cell.h * s, { fill: pal.canvas, opacity: 0.85 });
      }
    }
    pen.rect(sx, sy, sw, sh, { fill: 'none', stroke: mix(sc.color, pal.ink, 0.35), sw: v.print ? 0.3 : 1 });
    if (v.interactive) pen.rect(sx, sy, sw, sh, { fill: '#000', opacity: 0, attrs: { 'data-sid': sc.id, class: 'hit' } });
  }

  // pass 2: dimensions first, then labels, so labels can avoid every dimension. Dimensions stay on their own
  // screen: next to it when there is room, further out with extension lines when another screen is in the way,
  // and left out when nothing fits (the label still gives the size). Labels try a few spots and take the first
  // free one, with a leader line when they end up further away. Bigger screens are placed first.
  const placed = [];
  const hitsText = (b) => placed.some((p) => p.x0 < b.x1 && p.x1 > b.x0 && p.y0 < b.y1 && p.y1 > b.y0);
  const hitsScreen = (b, id) => [...rects].some(([oid, o]) => oid !== id && o.sx < b.x1 && o.sx + o.sw > b.x0 && o.sy < b.y1 && o.sy + o.sh > b.y0);
  const inside = (b) => b.x0 >= box.x && b.x1 <= box.x + box.w && b.y0 >= box.y && b.y1 <= box.y + box.h;
  const freeAt = (b, id) => !hitsText(b) && !hitsScreen(b, id);
  const choose = (cands, boxOf, id) => cands.find((c) => freeAt(boxOf(c), id) && inside(boxOf(c))) || cands.find((c) => freeAt(boxOf(c), id));
  if (fy >= box.y && fy < box.y + box.h) placed.push({ x0: box.x, x1: box.x + fs * 6.2, y0: fy + fs * 0.3, y1: fy + fs * 1.4 });
  if (clx > box.x && clx < box.x + box.w) placed.push({ x0: clx - fs, x1: clx + fs, y0: box.y + fs * 0.4, y1: box.y + fs * 1.5 });
  const dop = { color: pal.dim, text: pal.ink2, sw: v.print ? 0.2 : 0.8, tick: fs * 0.22, gap: fs * 0.3, size: fs * 0.68 };
  const byArea = order.filter((sc) => comps[sc.id] && rects.get(sc.id)).sort((a, b) => comps[b.id].W * comps[b.id].H - comps[a.id].W * comps[a.id].H);
  const below = new Map();
  for (const sc of byArea) {
    const { sx, sy, sw, sh } = rects.get(sc.id);
    const need = (v.labels ? fs * 1.3 : 0) + (v.dims ? fs * 2.0 : 0) + fs * 0.3;
    below.set(sc.id, need > fs * 0.3 && hitsScreen({ x0: sx, x1: sx + sw, y0: sy - need, y1: sy }, sc.id) && !hitsScreen({ x0: sx, x1: sx + sw, y0: sy + sh, y1: sy + sh + need }, sc.id));
  }
  let lowest = 0;
  // everything drawn, in pen units, so callers can fit the whole drawing (labels and dimensions included)
  const ext = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const grow = (b) => { ext.x0 = Math.min(ext.x0, b.x0); ext.y0 = Math.min(ext.y0, b.y0); ext.x1 = Math.max(ext.x1, b.x1); ext.y1 = Math.max(ext.y1, b.y1); };
  for (const r of rects.values()) grow({ x0: r.sx, y0: r.sy, x1: r.sx + r.sw, y1: r.sy + r.sh });
  const keep = (b) => { placed.push(b); grow(b); if (b.y1 > Y(0)) lowest = Math.max(lowest, b.y1 - Y(0)); };
  if (v.dims) {
    for (const sc of byArea) {
      const comp = comps[sc.id]; const { sx, sy, sw, sh } = rects.get(sc.id);
      // width: a dimension line above (or below) the screen, moved further out past anything in the way
      const up = (k) => ({ y: sy - fs * 1.05 - k * fs * 1.3, up: true, k });
      const dn = (k) => ({ y: sy + sh + fs * 1.05 + k * fs * 1.3, up: false, k });
      const wc = below.get(sc.id) ? [dn(0), up(0), dn(1), dn(2), dn(3), up(1), up(2), up(3)] : [up(0), dn(0), up(1), up(2), up(3), dn(1), dn(2), dn(3)];
      const wBox = (c) => (c.up ? { x0: sx - dop.tick, x1: sx + sw + dop.tick, y0: c.y - fs * 0.95, y1: c.y + dop.tick } : { x0: sx - dop.tick, x1: sx + sw + dop.tick, y0: c.y - dop.tick, y1: c.y + fs * 1.0 });
      const w = choose(wc, wBox, sc.id);
      if (w) {
        dimH(pen, sx, sx + sw, w.y, `${fmtM(comp.W)} m`, Object.assign({}, dop, w.up ? {} : { gap: -fs * 0.95 }, w.k ? { ext: w.up ? sy : sy + sh } : {}));
        keep(wBox(w));
      }
      // heights: text right of a line on the right, left of a line on the left
      const right = (x, y0, y1) => ({ x, b: { x0: x - dop.tick, x1: x + fs * 1.0, y0, y1 }, gap: -fs * 0.85 });
      const left = (x, y0, y1) => ({ x, b: { x0: x - fs * 0.85, x1: x + dop.tick, y0, y1 }, gap: fs * 0.3 });
      const vdim = (opts, y0, y1, label, o) => {
        const pick = choose(opts, (c) => c.b, sc.id); if (!pick) return null;
        dimV(pen, pick.x, y0, y1, label, Object.assign({}, dop, o, { gap: pick.gap }));
        keep(pick.b); return pick;
      };
      const hPick = vdim([right(sx + sw + fs * 1.0, sy, sy + sh), left(sx - fs * 1.0, sy, sy + sh)], sy, sy + sh, `${fmtM(comp.H)} m`, {});
      if (sc.y > 0) {
        const yo = [left(sx - fs * 0.9, Y(sc.y), Y(0)), right(sx + sw + fs * 0.9, Y(sc.y), Y(0))];
        if (hPick && hPick.x < sx) yo.reverse();
        vdim(yo, Y(0), Y(sc.y), `${fmtM(sc.y)} m`, { color: pal.ink3 });
      }
    }
  }
  const labelJobs = [];
  if (v.labels) {
    for (const sc of byArea) {
      const comp = comps[sc.id]; const { sx, sy, sw, sh } = rects.get(sc.id);
      const extra = [];
      if (comp.curve) extra.push(`${comp.curve.shape === 'concave' ? 'curved in' : 'curved out'} ${fmtNum(comp.curve.arc, 1)}°`);
      if (sc.yaw) extra.push(`yaw ${fmtNum(sc.yaw, 1)}°`);
      if (sc.z) extra.push(`Z ${sc.z > 0 ? '+' : ''}${fmtM(sc.z, 2)} m`);
      const nameSize = fs * 0.92, metaSize = fs * 0.72;
      const meta = `${fmtSize(comp.W, comp.H)}${extra.length ? '  ·  ' + extra.join('  ·  ') : ''}`;
      const nw = pen.measure(sc.name, { size: nameSize, weight: 600 });
      const mw = pen.measure(meta, { size: metaSize });
      const lw = nw + fs * 0.5 + mw;
      const xs = [sx, sx + sw - lw, sx + sw / 2 - lw / 2];
      const aboveYs = [sy - fs * 0.55, sy - fs * 2.55], belowYs = [sy + sh + fs * 1.25, sy + sh + fs * 3.35];
      const cands = [];
      for (const y of (below.get(sc.id) ? [...belowYs, ...aboveYs] : [...aboveYs, ...belowYs])) for (const x of xs) cands.push({ x, y });
      for (let k = 1; k <= 6; k++) for (const x of xs) cands.push({ x, y: sy - fs * 2.55 - k * fs * 1.45, lead: true });
      const boxOf = (c) => ({ x0: c.x - fs * 0.25, x1: c.x + lw + fs * 0.25, y0: c.y - nameSize * 0.95, y1: c.y + nameSize * 0.35 });
      const pick = choose(cands, boxOf, sc.id) || cands[0];
      keep(boxOf(pick));
      labelJobs.push({ sc, c: pick, sx, sy, sw, nw, lw, meta, nameSize, metaSize });
    }
  }
  // labels go on top of every dimension line
  for (const j of labelJobs) {
    const { c } = j;
    if (c.lead) {
      const ax = clamp(c.x + j.lw / 2, j.sx + fs * 0.3, j.sx + j.sw - fs * 0.3);
      pen.line(ax, c.y + j.nameSize * 0.4, ax, j.sy, { stroke: pal.ink3, sw: v.print ? 0.15 : 0.8, dash: v.print ? [0.6, 0.6] : [2, 2] });
    }
    pen.rect(c.x - fs * 0.25, c.y - j.nameSize * 0.95, j.lw + fs * 0.5, j.nameSize * 1.3, { fill: pal.canvas, opacity: 0.82, rx: v.print ? 0.4 : 3 });
    pen.text(j.sc.name, c.x, c.y, { size: j.nameSize, weight: 600, fill: pal.ink });
    pen.text(j.meta, c.x + j.nw + fs * 0.5, c.y, { size: j.metaSize, fill: pal.ink3, font: 'ui' });
  }

  // pass 3: selection
  for (const sc of order) {
    if (!sel.has(sc.id)) continue; const r = rects.get(sc.id); if (!r) continue;
    const pad = v.print ? 1 : 4, hs = v.print ? 1 : 3.5;
    pen.rect(r.sx - pad, r.sy - pad, r.sw + pad * 2, r.sh + pad * 2, { fill: 'none', stroke: pal.accent, sw: 2 });
    for (const [hx, hy] of [[r.sx - pad, r.sy - pad], [r.sx + r.sw + pad, r.sy - pad], [r.sx - pad, r.sy + r.sh + pad], [r.sx + r.sw + pad, r.sy + r.sh + pad]]) pen.rect(hx - hs, hy - hs, hs * 2, hs * 2, { fill: pal.accent, stroke: pal.canvas, sw: 1 });
  }

  // overall width
  if (v.dims && project.screens.length > 1) {
    const b = stageBounds(project, comps);
    const yy = Y(0) + Math.max(fs * 2.7, lowest + fs * 1.6);
    dimH(pen, X(b.x0), X(b.x1), yy, `Overall ${fmtM(b.x1 - b.x0)} m`, { color: pal.dim, text: pal.ink, sw: v.print ? 0.25 : 1, tick: fs * 0.25, gap: fs * 0.3, size: fs * 0.72, weight: 600 });
    grow({ x0: X(b.x0) - fs * 0.3, x1: X(b.x1) + fs * 0.3, y0: yy - fs, y1: yy + fs * 0.3 });
  }

  // snapping guides
  for (const g of (v.guides || [])) {
    if (g.x !== undefined) pen.line(X(g.x), box.y, X(g.x), box.y + box.h, { stroke: pal.accent, sw: 1, dash: [4, 3] });
    if (g.y !== undefined) pen.line(box.x, Y(g.y), box.x + box.w, Y(g.y), { stroke: pal.accent, sw: 1, dash: [4, 3] });
  }
  return ext;
}

// Scale and offset that fit the whole stage drawing, labels and dimensions included, inside box.
// Labels keep a fixed size while the screens scale, so this measures a dry run and adjusts a few times.
function fitStageView(project, comps, box, fs, measurePen, o = {}) {
  const b = stageBounds(project, comps);
  const bw = Math.max(1500, b.x1 - b.x0), bh = Math.max(1500, b.y1 - b.y0);
  const nul = { rect() {}, line() {}, text() {}, poly() {}, circle() {}, path() {}, image() {}, measure: (t, oo) => measurePen.measure(t, oo) };
  const big = { x: -1e7, y: -1e7, w: 2e7, h: 2e7 };
  const margin = fs * 0.6;
  const lim = (v) => clamp(v, o.minScale || 1e-5, o.maxScale || 2);
  let pad = { l: fs * 3.6, r: fs * 3.6, t: fs * 4.4, b: fs * 6 };
  const scaleFor = (pd) => lim(Math.min((box.w - pd.l - pd.r) / bw, (box.h - pd.t - pd.b) / bh));
  // never shrink the screens below this share of the plain fit: on a narrow box (a phone) labels that cannot
  // fit beside the screens would otherwise push the drawing down to a speck
  const floorS = scaleFor(pad) * (o.minRel ?? 0.5);
  let s = scaleFor(pad);
  for (let i = 0; i < 3; i++) {
    const tx0 = box.x + pad.l + (box.w - pad.l - pad.r - (b.x1 - b.x0) * s) / 2 - b.x0 * s;
    const ty0 = box.y + pad.t + (box.h - pad.t - pad.b - (b.y1 - b.y0) * s) / 2 + b.y1 * s;
    const e = drawStage(nul, Object.assign({}, o, { project, comps, fs, s, tx: tx0, ty: ty0, box: big, grid: false, selection: null, guides: null, interactive: false }));
    pad = { l: tx0 + b.x0 * s - e.x0 + margin, r: e.x1 - (tx0 + b.x1 * s) + margin, t: ty0 - b.y1 * s - e.y0 + margin, b: e.y1 - (ty0 - b.y0 * s) + margin };
    const ns = Math.max(floorS, scaleFor(pad));
    const done = Math.abs(ns - s) <= s * 0.01;
    s = ns;
    if (done) break;
  }
  // centre the whole drawing (screens plus their labels) in the box
  const cw = (b.x1 - b.x0) * s + pad.l + pad.r, ch = (b.y1 - b.y0) * s + pad.t + pad.b;
  const tx = box.x + (box.w - cw) / 2 + pad.l - b.x0 * s;
  const ty = box.y + Math.max(0, (box.h - ch) / 2) + pad.t + b.y1 * s;
  return { s, tx, ty, pad, bh };
}

/* ---------- native-resolution pixel map (PNG test image) ---------- */
function drawPixelMap(canvas, comp, project) {
  const ctx = canvas.getContext('2d');
  canvas.width = comp.resW; canvas.height = comp.resH;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, comp.resW, comp.resH);
  const prefix = project.settings.portPrefix || 'P';
  for (const cell of comp.cells) {
    const x = cell.px0, y = cell.py0, w = cell.pw, h = cell.ph;
    if (!cell.active) {
      ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y + h); ctx.moveTo(x + w, y); ctx.lineTo(x, y + h); ctx.stroke();
      continue;
    }
    const base = cell.port >= 0 ? PORT_COLORS[cell.port % PORT_COLORS.length] : '#555555';
    const grad = ctx.createLinearGradient(x, y, x + w, y + h);
    grad.addColorStop(0, mix(base, '#000000', 0.15)); grad.addColorStop(1, mix(base, '#000000', 0.45));
    ctx.fillStyle = grad; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y + h); ctx.moveTo(x + w, y); ctx.lineTo(x, y + h); ctx.stroke();
    ctx.strokeStyle = '#FFFFFF'; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    const big = clamp(Math.min(w, h) * 0.17, 7, 64);
    ctx.fillStyle = '#FFFFFF'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `700 ${big}px ${FONT_STACK.cond}`;
    ctx.fillText(`${prefix}${cell.port + 1}:${String(cell.seq).padStart(2, '0')}`, x + w / 2, y + h / 2 - big * 0.45);
    ctx.font = `500 ${big * 0.62}px ${FONT_STACK.mono}`;
    ctx.fillText(`${colLetter(cell.c)}${cell.r + 1}  #${cell.build}`, x + w / 2, y + h / 2 + big * 0.55);
  }
  // centre caption
  const s = comp.screen;
  const t1 = s.name, t2 = `${comp.resW} × ${comp.resH} px  ·  ${comp.ports.length} port${comp.ports.length === 1 ? '' : 's'}`;
  const size = clamp(Math.min(comp.resW, comp.resH) * 0.07, 12, 120);
  ctx.font = `700 ${size}px ${FONT_STACK.ui}`;
  const w1 = ctx.measureText(t1).width; ctx.font = `500 ${size * 0.55}px ${FONT_STACK.mono}`; const w2 = ctx.measureText(t2).width;
  const bw = Math.max(w1, w2) + size * 1.2, bh = size * 2.3;
  ctx.fillStyle = 'rgba(0,0,0,0.78)'; ctx.fillRect(comp.resW / 2 - bw / 2, comp.resH / 2 - bh / 2, bw, bh);
  ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = Math.max(1, size * 0.04); ctx.strokeRect(comp.resW / 2 - bw / 2, comp.resH / 2 - bh / 2, bw, bh);
  ctx.fillStyle = '#FFFFFF'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `700 ${size}px ${FONT_STACK.ui}`; ctx.fillText(t1, comp.resW / 2, comp.resH / 2 - size * 0.38);
  ctx.font = `500 ${size * 0.55}px ${FONT_STACK.mono}`; ctx.fillText(t2, comp.resW / 2, comp.resH / 2 + size * 0.6);
}

/* ---------- test card for the 3D view ---------- */
function drawTestCard(ctx, comp, w, h, name) {
  const s = w / comp.W;
  ctx.fillStyle = '#1B1F27'; ctx.fillRect(0, 0, w, h);
  // colour bars across the middle band
  const bars = ['#C0C0C0', '#C0C000', '#00C0C0', '#00C000', '#C000C0', '#C00000', '#0000C0'];
  const bw = w / bars.length;
  bars.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(i * bw, h * 0.3, bw + 1, h * 0.4); });
  // gradient strip
  const g = ctx.createLinearGradient(0, 0, w, 0); g.addColorStop(0, '#000'); g.addColorStop(1, '#fff');
  ctx.fillStyle = g; ctx.fillRect(0, h * 0.72, w, h * 0.1);
  // cabinet grid
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = Math.max(1, w / 900);
  for (const cell of comp.cells) ctx.strokeRect(cell.x * s, h - (cell.y + cell.h) * s, cell.w * s, cell.h * s);
  // circle and cross
  ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = Math.max(2, w / 400);
  const r = Math.min(w, h) * 0.46;
  ctx.beginPath(); ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
  // caption
  const size = clamp(Math.min(w, h) * 0.09, 10, 160);
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.font = `700 ${size}px ${FONT_STACK.ui}`;
  const t2 = `${comp.resW} × ${comp.resH}`;
  const tw = Math.max(ctx.measureText(name).width, ctx.measureText(t2).width) + size;
  ctx.fillRect(w / 2 - tw / 2, h / 2 - size * 1.15, tw, size * 2.3);
  ctx.fillStyle = '#FFFFFF'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(name, w / 2, h / 2 - size * 0.45);
  ctx.font = `500 ${size * 0.6}px ${FONT_STACK.mono}`; ctx.fillText(t2, w / 2, h / 2 + size * 0.55);
  // holes become transparent
  for (const cell of comp.cells) if (!cell.active) ctx.clearRect(cell.x * s, h - (cell.y + cell.h) * s, cell.w * s, cell.h * s);
}
