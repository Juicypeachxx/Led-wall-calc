/* ============================================================
   PENS — one drawing API, three back-ends:
   SvgPen (on-screen interactive drawings), CanvasPen (PNG exports
   and 3D textures) and PdfPen (vector PDF via jsPDF).
   Coordinates are in the pen's own units (px on screen, mm in PDF);
   y grows downwards. Text rotation is counter-clockwise degrees.
   ============================================================ */

const FONT_STACK = {
  ui: '"Barlow", "Segoe UI", system-ui, -apple-system, sans-serif',
  cond: '"Barlow Condensed", "Arial Narrow", "Barlow", sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
};
const _measureCtx = (typeof document !== 'undefined') ? document.createElement('canvas').getContext('2d') : null;
function cssFont(o) { return `${o.weight || 400} ${o.size || 12}px ${FONT_STACK[o.font || 'ui']}`; }
function measureCss(str, o) {
  if (!_measureCtx) return String(str).length * (o.size || 12) * 0.55;
  _measureCtx.font = cssFont(o);
  return _measureCtx.measureText(String(str)).width;
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f2 = (n) => (Math.round(n * 100) / 100).toString();

function hexToRgb(hex) {
  let h = String(hex || '#000').trim();
  if (h.startsWith('rgb')) { const m = h.match(/[\d.]+/g) || [0, 0, 0]; return [+m[0], +m[1], +m[2]]; }
  h = h.replace('#', '');
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex([r, g, b]) { return '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join(''); }
function mix(a, b, t) { const A = hexToRgb(a), B = hexToRgb(b); return rgbToHex([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]); }
function luminance(hex) { const [r, g, b] = hexToRgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
function readableOn(hex) { return luminance(hex) > 0.38 ? '#0B1220' : '#FFFFFF'; }

/* ---------- SVG ---------- */
class SvgPen {
  constructor() { this.out = []; this.unit = 'px'; }
  _paint(o) {
    let s = '';
    s += ` fill="${o.fill && o.fill !== 'none' ? o.fill : 'none'}"`;
    if (o.opacity !== undefined && o.opacity !== 1) s += ` fill-opacity="${o.opacity}"`;
    if (o.stroke && o.stroke !== 'none') {
      s += ` stroke="${o.stroke}" stroke-width="${f2(o.sw || 1)}"`;
      if (o.sopacity !== undefined && o.sopacity !== 1) s += ` stroke-opacity="${o.sopacity}"`;
      if (o.dash) s += ` stroke-dasharray="${o.dash.map(f2).join(' ')}"`;
      if (o.join) s += ` stroke-linejoin="${o.join}"`;
      if (o.cap) s += ` stroke-linecap="${o.cap}"`;
    }
    if (o.attrs) for (const k in o.attrs) s += ` ${k}="${esc(o.attrs[k])}"`;
    return s;
  }
  rect(x, y, w, h, o = {}) { this.out.push(`<rect x="${f2(x)}" y="${f2(y)}" width="${f2(Math.max(0, w))}" height="${f2(Math.max(0, h))}"${o.rx ? ` rx="${f2(o.rx)}"` : ''}${this._paint(o)}/>`); }
  line(x1, y1, x2, y2, o = {}) { this.out.push(`<line x1="${f2(x1)}" y1="${f2(y1)}" x2="${f2(x2)}" y2="${f2(y2)}"${this._paint(Object.assign({ stroke: '#000' }, o, { fill: 'none' }))}/>`); }
  poly(pts, o = {}) {
    if (pts.length < 2) return;
    const tag = o.close ? 'polygon' : 'polyline';
    this.out.push(`<${tag} points="${pts.map((p) => f2(p[0]) + ',' + f2(p[1])).join(' ')}"${this._paint(Object.assign({ fill: 'none' }, o))}/>`);
  }
  circle(cx, cy, r, o = {}) { this.out.push(`<circle cx="${f2(cx)}" cy="${f2(cy)}" r="${f2(r)}"${this._paint(o)}/>`); }
  text(str, x, y, o = {}) {
    const anchor = o.anchor === 'middle' ? 'middle' : o.anchor === 'end' ? 'end' : 'start';
    const bl = { middle: 'central', top: 'hanging', bottom: 'text-after-edge', alphabetic: 'alphabetic' }[o.baseline || 'alphabetic'];
    const tr = o.rotate ? ` transform="rotate(${f2(-o.rotate)} ${f2(x)} ${f2(y)})"` : '';
    const fam = FONT_STACK[o.font || 'ui'].replace(/"/g, "'");
    this.out.push(`<text x="${f2(x)}" y="${f2(y)}" font-family="${fam}" font-size="${f2(o.size || 12)}" font-weight="${o.weight || 400}" fill="${o.fill || '#000'}"${o.opacity !== undefined ? ` fill-opacity="${o.opacity}"` : ''} text-anchor="${anchor}" dominant-baseline="${bl}"${o.ls ? ` letter-spacing="${o.ls}"` : ''}${tr}${o.attrs ? Object.keys(o.attrs).map((k) => ` ${k}="${esc(o.attrs[k])}"`).join('') : ''}>${esc(str)}</text>`);
  }
  measure(str, o = {}) { return measureCss(str, o); }
  open(attrs = {}) { this.out.push(`<g${Object.keys(attrs).map((k) => ` ${k}="${esc(attrs[k])}"`).join('')}>`); }
  close() { this.out.push('</g>'); }
  image() { /* not used on screen */ }
  toString() { return this.out.join(''); }
}

/* ---------- Canvas ---------- */
class CanvasPen {
  constructor(ctx) { this.ctx = ctx; this.unit = 'px'; }
  _stroke(o) {
    const c = this.ctx; if (!o.stroke || o.stroke === 'none') return;
    c.save(); c.globalAlpha = o.sopacity ?? 1; c.strokeStyle = o.stroke; c.lineWidth = o.sw || 1;
    c.setLineDash(o.dash || []); c.lineJoin = o.join || 'miter'; c.lineCap = o.cap || 'butt'; c.stroke(); c.restore();
  }
  _fill(o) { const c = this.ctx; if (!o.fill || o.fill === 'none') return; c.save(); c.globalAlpha = o.opacity ?? 1; c.fillStyle = o.fill; c.fill(); c.restore(); }
  rect(x, y, w, h, o = {}) {
    const c = this.ctx; c.beginPath();
    if (o.rx && c.roundRect) c.roundRect(x, y, w, h, o.rx); else c.rect(x, y, w, h);
    this._fill(o); this._stroke(o);
  }
  line(x1, y1, x2, y2, o = {}) { const c = this.ctx; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); this._stroke(Object.assign({ stroke: '#000' }, o)); }
  poly(pts, o = {}) {
    if (pts.length < 2) return; const c = this.ctx; c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
    if (o.close) c.closePath(); this._fill(o); this._stroke(o);
  }
  circle(cx, cy, r, o = {}) { const c = this.ctx; c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); this._fill(o); this._stroke(o); }
  text(str, x, y, o = {}) {
    const c = this.ctx; c.save(); c.font = cssFont(o); c.fillStyle = o.fill || '#000'; c.globalAlpha = o.opacity ?? 1;
    c.textAlign = o.anchor === 'middle' ? 'center' : o.anchor === 'end' ? 'right' : 'left';
    c.textBaseline = { middle: 'middle', top: 'top', bottom: 'bottom', alphabetic: 'alphabetic' }[o.baseline || 'alphabetic'];
    c.translate(x, y); if (o.rotate) c.rotate(-rad(o.rotate));
    c.fillText(String(str), 0, 0); c.restore();
  }
  measure(str, o = {}) { this.ctx.save(); this.ctx.font = cssFont(o); const w = this.ctx.measureText(String(str)).width; this.ctx.restore(); return w; }
  open() {} close() {}
  image(img, x, y, w, h) { this.ctx.drawImage(img, x, y, w, h); }
}

/* ---------- PDF (jsPDF) ---------- */
const MM_TO_PT = 72 / 25.4;
class PdfPen {
  constructor(doc) { this.doc = doc; this.unit = 'mm'; this._gs = {}; this._font = ''; }
  _alpha(fill, stroke) {
    const key = `${fill}|${stroke}`; const d = this.doc;
    if (this._curAlpha === key) return;
    if (!this._gs[key]) this._gs[key] = new d.GState({ opacity: fill, 'stroke-opacity': stroke });
    d.setGState(this._gs[key]); this._curAlpha = key;
  }
  _set(o) {
    const d = this.doc;
    const hasF = o.fill && o.fill !== 'none', hasS = o.stroke && o.stroke !== 'none';
    if (hasF) d.setFillColor(...hexToRgb(o.fill));
    if (hasS) { d.setDrawColor(...hexToRgb(o.stroke)); d.setLineWidth(o.sw || 0.2); d.setLineDashPattern(o.dash || [], 0); }
    this._alpha(o.opacity ?? 1, o.sopacity ?? 1);
    return hasF && hasS ? 'FD' : hasF ? 'F' : hasS ? 'S' : null;
  }
  rect(x, y, w, h, o = {}) { const st = this._set(o); if (!st) return; if (o.rx) this.doc.roundedRect(x, y, w, h, o.rx, o.rx, st); else this.doc.rect(x, y, w, h, st); }
  line(x1, y1, x2, y2, o = {}) { const st = this._set(Object.assign({ stroke: '#000' }, o, { fill: 'none' })); if (st) this.doc.line(x1, y1, x2, y2); }
  poly(pts, o = {}) {
    if (pts.length < 2) return; const st = this._set(o); if (!st) return;
    const d = []; for (let i = 1; i < pts.length; i++) d.push([pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]]);
    this.doc.lines(d, pts[0][0], pts[0][1], [1, 1], st, !!o.close);
  }
  circle(cx, cy, r, o = {}) { const st = this._set(o); if (st) this.doc.circle(cx, cy, r, st); }
  _setFont(o) {
    const d = this.doc;
    const fam = o.font === 'cond' ? ['BarlowCond', 'normal'] : ['Barlow', (o.weight || 400) >= 600 ? 'bold' : 'normal'];
    const k = fam.join('/'); if (this._font !== k) { d.setFont(fam[0], fam[1]); this._font = k; }
    d.setFontSize((o.size || 3) * MM_TO_PT);
  }
  text(str, x, y, o = {}) {
    const d = this.doc; this._setFont(o);
    d.setTextColor(...hexToRgb(o.fill || '#000')); this._alpha(o.opacity ?? 1, 1);
    const opt = { align: o.anchor === 'middle' ? 'center' : o.anchor === 'end' ? 'right' : 'left', baseline: o.baseline || 'alphabetic' };
    if (o.rotate) {
      // jsPDF aligns rotated text along the page x axis; shift the start point along the text direction instead
      const k = o.anchor === 'middle' ? 0.5 : o.anchor === 'end' ? 1 : 0;
      if (k) { const w = d.getTextWidth(String(str)); const a = rad(o.rotate); x -= Math.cos(a) * w * k; y += Math.sin(a) * w * k; }
      opt.align = 'left'; opt.angle = o.rotate;
    }
    d.text(String(str), x, y, opt);
  }
  measure(str, o = {}) { this._setFont(o); return this.doc.getTextWidth(String(str)); }
  newPage() { this._curAlpha = null; this._font = ''; }
  open() {} close() {}
  image(dataUrl, x, y, w, h, fmt = 'JPEG') { this._alpha(1, 1); this.doc.addImage(dataUrl, fmt, x, y, w, h, undefined, 'FAST'); }
}

/* ---------- shared drawing helpers ---------- */
function arrowHead(pen, x1, y1, x2, y2, size, o) {
  const a = Math.atan2(y2 - y1, x2 - x1), s = size;
  const p1 = [x2 - s * Math.cos(a - 0.45), y2 - s * Math.sin(a - 0.45)];
  const p2 = [x2 - s * Math.cos(a + 0.45), y2 - s * Math.sin(a + 0.45)];
  pen.poly([[x2, y2], p1, p2], { fill: o.fill, close: true });
}
// dimension line: horizontal at y between x1 and x2 with architectural ticks
function dimH(pen, x1, x2, y, label, o) {
  const t = o.tick, sw = o.sw;
  pen.line(x1, y, x2, y, { stroke: o.color, sw });
  pen.line(x1 - t, y + t, x1 + t, y - t, { stroke: o.color, sw: sw * 1.4 });
  pen.line(x2 - t, y + t, x2 + t, y - t, { stroke: o.color, sw: sw * 1.4 });
  if (o.ext !== undefined) { pen.line(x1, o.ext, x1, y + (o.ext > y ? t * 1.5 : -t * 1.5), { stroke: o.color, sw: sw * 0.7, sopacity: 0.7 }); pen.line(x2, o.ext, x2, y + (o.ext > y ? t * 1.5 : -t * 1.5), { stroke: o.color, sw: sw * 0.7, sopacity: 0.7 }); }
  if (label) pen.text(label, (x1 + x2) / 2, y - o.gap, { size: o.size, fill: o.text || o.color, anchor: 'middle', baseline: 'alphabetic', font: o.font || 'ui', weight: o.weight });
}
function dimV(pen, x, y1, y2, label, o) {
  const t = o.tick, sw = o.sw;
  pen.line(x, y1, x, y2, { stroke: o.color, sw });
  pen.line(x - t, y1 + t, x + t, y1 - t, { stroke: o.color, sw: sw * 1.4 });
  pen.line(x - t, y2 + t, x + t, y2 - t, { stroke: o.color, sw: sw * 1.4 });
  if (o.ext !== undefined) { pen.line(o.ext, y1, x + (o.ext > x ? t * 1.5 : -t * 1.5), y1, { stroke: o.color, sw: sw * 0.7, sopacity: 0.7 }); pen.line(o.ext, y2, x + (o.ext > x ? t * 1.5 : -t * 1.5), y2, { stroke: o.color, sw: sw * 0.7, sopacity: 0.7 }); }
  if (label) pen.text(label, x - o.gap, (y1 + y2) / 2, { size: o.size, fill: o.text || o.color, anchor: 'middle', baseline: 'alphabetic', rotate: 90, font: o.font || 'ui', weight: o.weight });
}
