/* ============================================================
   PDF REPORT — vector A4 landscape report built with jsPDF and the
   same drawing code as the screen (PdfPen). Fonts are embedded so
   names with č, š, ž and symbols such as × and ² print correctly.
   ============================================================ */

const PAGE = { w: 297, h: 210, m: 12, top: 29, bottom: 196 };
const PDF_INK = '#14202C', PDF_INK2 = '#3E5164', PDF_INK3 = '#7A8B9C', PDF_RULE = '#D5DDE5', PDF_BAND = '#14202C', PDF_ACCENT = '#F2A51E';

function pdfWrap(pen, str, width, o) {
  const words = String(str || '').split(/\s+/).filter(Boolean); const lines = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (pen.measure(t, o) <= width || !cur) cur = t; else { lines.push(cur); cur = w; } }
  if (cur) lines.push(cur); return lines;
}

function pdfFrame(pen, project, title, sub, pageNo, pageCount, issued) {
  pen.rect(0, 0, PAGE.w, 13, { fill: PDF_BAND });
  pen.rect(0, 13, PAGE.w, 0.9, { fill: PDF_ACCENT });
  // mark: 3x3 pixel grid
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) pen.rect(PAGE.m + i * 2.2, 3.4 + j * 2.2, 1.7, 1.7, { fill: (i + j) % 2 ? '#5B6CFF' : PDF_ACCENT });
  pen.text('LED WALL PLANNER', PAGE.m + 8.6, 8.6, { font: 'cond', size: 4.4, fill: '#FFFFFF' });
  pen.text(project.name, PAGE.w - PAGE.m, 6.3, { size: 3.0, weight: 600, fill: '#FFFFFF', anchor: 'end' });
  const meta = [project.client, project.settings.venue, `Rev ${project.revision || 'A'}`, issued].filter(Boolean).join('  ·  ');
  pen.text(meta, PAGE.w - PAGE.m, 10.4, { size: 2.4, fill: '#AFC0D0', anchor: 'end' });
  pen.text(title, PAGE.m, 22.5, { size: 4.6, weight: 600, fill: PDF_INK });
  if (sub) pen.text(sub, PAGE.m + pen.measure(title, { size: 4.6, weight: 600 }) + 3, 22.5, { size: 3.0, fill: PDF_INK3 });
  pen.line(PAGE.m, 200, PAGE.w - PAGE.m, 200, { stroke: PDF_RULE, sw: 0.2 });
  pen.text('Schematic, not to scale. Documents geometry and configuration only; it does not validate structure, rigging or the electrical installation.', PAGE.m, 204.2, { size: 2.2, fill: PDF_INK3 });
  pen.text(`${pageNo} / ${pageCount}`, PAGE.w - PAGE.m, 204.2, { size: 2.4, weight: 600, fill: PDF_INK2, anchor: 'end' });
}

function pdfTable(pen, x, y, cols, rows, o = {}) {
  const rh = o.rh || 5.6, size = o.size || 2.55;
  const totalW = sum(cols, (c) => c.w);
  pen.rect(x, y, totalW, rh, { fill: '#EEF2F6' });
  let cx = x;
  for (const c of cols) {
    const tx = c.align === 'right' ? cx + c.w - 1.6 : cx + 1.6;
    pen.text(c.label, tx, y + rh / 2, { size: size * 0.92, weight: 600, fill: PDF_INK2, anchor: c.align === 'right' ? 'end' : 'start', baseline: 'middle' });
    cx += c.w;
  }
  y += rh;
  rows.forEach((r, i) => {
    if (r._total) pen.line(x, y, x + totalW, y, { stroke: PDF_INK3, sw: 0.25 });
    else if (i % 2 === 1) pen.rect(x, y, totalW, rh, { fill: '#F7F9FB' });
    let cx2 = x;
    for (const c of cols) {
      const v = r[c.key]; const tx = c.align === 'right' ? cx2 + c.w - 1.6 : cx2 + 1.6;
      if (c.swatch && r._swatch) { pen.rect(cx2 + 1.4, y + rh / 2 - 1.4, 2.8, 2.8, { fill: r._swatch, rx: 0.4 }); }
      if (c.box) { if (!r._total) pen.rect(cx2 + c.w / 2 - 1.5, y + rh / 2 - 1.5, 3, 3, { fill: '#FFFFFF', stroke: PDF_INK2, sw: 0.25, rx: 0.3 }); cx2 += c.w; continue; }
      let str = v === undefined || v === null ? '—' : String(v);
      const maxW = c.w - 3.2 - (c.swatch ? 4 : 0);
      while (str.length > 3 && pen.measure(str, { size, weight: r._total ? 600 : 400 }) > maxW) str = str.slice(0, -2) + '…';
      pen.text(str, c.swatch ? tx + 4 : tx, y + rh / 2, { size, weight: r._total || c.bold ? 600 : 400, fill: PDF_INK, anchor: c.align === 'right' ? 'end' : 'start', baseline: 'middle' });
      cx2 += c.w;
    }
    y += rh;
  });
  pen.line(x, y, x + totalW, y, { stroke: PDF_RULE, sw: 0.2 });
  return y;
}

// lays rows out in side-by-side copies of a table; returns the bottom y
function pdfTableColumns(pen, x, y, width, colsDef, rows, o) {
  const ncols = o.ncols || 1, gap = o.gap ?? 5;
  const colW = (width - gap * (ncols - 1)) / ncols;
  const scale = colW / sum(colsDef, (c) => c.w);
  const cols = colsDef.map((c) => Object.assign({}, c, { w: c.w * scale }));
  let maxY = y;
  for (let k = 0; k < ncols; k++) {
    const chunk = rows.slice(k * o.perCol, (k + 1) * o.perCol);
    if (!chunk.length) break;
    maxY = Math.max(maxY, pdfTable(pen, x + k * (colW + gap), y, cols, chunk, o));
  }
  return maxY;
}

function pdfKeyValues(pen, x, y, w, pairs, o = {}) {
  const size = o.size || 2.7, lh = o.lh || 5.2;
  for (const [k, v] of pairs) {
    pen.text(k, x, y, { size: size * 0.9, fill: PDF_INK3 });
    const lines = pdfWrap(pen, v === undefined || v === null || v === '' ? '—' : String(v), w * 0.58, { size, weight: 600 });
    lines.forEach((ln, i) => pen.text(ln, x + w * 0.42, y + i * size * 1.25, { size, weight: 600, fill: PDF_INK }));
    pen.line(x, y + Math.max(1, lines.length) * size * 1.25 - size * 0.55, x + w, y + Math.max(1, lines.length) * size * 1.25 - size * 0.55, { stroke: '#E6EBF0', sw: 0.15 });
    y += lh + (lines.length - 1) * size * 1.25;
  }
  return y;
}

function fmtW(w) { return w === null || w === undefined ? 'no data' : w >= 10000 ? `${fmtNum(w / 1000, 1)} kW` : `${fmtInt(w)} W`; }
function fmtKg(k) { return k === null || k === undefined ? 'no data' : `${fmtInt(k)} kg`; }
function usesGeneric(c) { return Object.values(c.byPanel).some((b) => b.panel.builtin); }
function typicalNote(c) { return usesGeneric(c) ? ' (typical values)' : ''; }

function screenSpecs(project, s, c) {
  const st = project.settings;
  const pf = st.powerFactor || 1;
  const amps = c.wMax !== null ? c.wMax / (st.voltage * pf) : null;
  const amps3 = c.wMax !== null ? c.wMax / (3 * st.voltage * pf) : null;   // balanced over three phases
  const pitchSet = Object.values(c.byPanel).map((b) => fmtPitch(b.panel) + ' mm');
  const rows = [
    ['Size', fmtSize(c.W, c.H)],
    ['LED area', `${fmtNum(c.area, 2)} m²${c.holes ? ` (envelope ${fmtNum(c.envelope, 2)} m²)` : ''}`],
    ['Canvas resolution', `${fmtRes(c.resW, c.resH)} px`],
    ['Active pixels', fmtInt(c.pixels)],
    ['Aspect ratio', `${c.ratio.text}  (${fmtDelta(c.ratio.delta)})`],
    ['Pixel pitch', [...new Set(pitchSet)].join(', ')],
    ['Cabinets', `${c.count}${c.holes ? ` (${c.holes} removed)` : ''}`],
    ['Shape', c.curve ? `${c.curve.shape[0].toUpperCase() + c.curve.shape.slice(1)}, ${fmtNum(c.curve.angle, 2)}° per column, ${fmtNum(c.curve.arc, 1)}° total, radius ${fmtM(c.curve.rIn, 2)} m` : 'Flat'],
    ['Position', `Centre ${fmtM(s.x, 2)} m from CL, bottom ${fmtM(s.y, 2)} m above floor${s.z ? `, ${fmtM(s.z, 2)} m forward` : ''}${s.yaw ? `, yaw ${fmtNum(s.yaw, 1)}°` : ''}`],
    ['Weight', `${fmtKg(c.weight)}${typicalNote(c)}, cabinets only`],
    ['Heaviest column', c.heaviestCol ? `${fmtKg(c.heaviestCol.kg)} (column ${colLetter(c.heaviestCol.col)}), cabinets only, without rigging` : 'no data'],
    ['Power, max / typical', `${fmtW(c.wMax)} / ${fmtW(c.wAvg)}${typicalNote(c)}`],
    ['Current at max', amps === null ? 'no data' : `${fmtNum(amps, 1)} A at ${fmtInt(st.voltage)} V single-phase · ${fmtNum(amps3, 1)} A per phase on 3-phase (power factor ${fmtNum(pf, 2)})`],
    ['Data ports', `${c.ports.length} × ${fmtInt(st.portCapacity)} px${st.backup ? `, plus ${c.ports.length} backup` : ''}`],
    ['Power circuits', c.power ? `${c.power.circuits.length} × ${fmtInt(st.circuitAmps)} A, loaded to ${Math.round(st.loadFactor * 100)}%` : 'no power data'],
  ];
  return rows;
}

async function buildPdfReport(project, comps, totals, opts) {
  if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('The PDF library did not load. Reload the page and try again.');
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  doc.addFileToVFS('Barlow-Regular.ttf', PDF_FONTS.regular); doc.addFont('Barlow-Regular.ttf', 'Barlow', 'normal');
  doc.addFileToVFS('Barlow-SemiBold.ttf', PDF_FONTS.semibold); doc.addFont('Barlow-SemiBold.ttf', 'Barlow', 'bold');
  doc.addFileToVFS('BarlowCondensed-SemiBold.ttf', PDF_FONTS.cond); doc.addFont('BarlowCondensed-SemiBold.ttf', 'BarlowCond', 'normal');
  doc.setProperties({ title: `${project.name} — LED wall plan`, subject: 'LED wall plan', creator: 'LED Wall Planner' });
  const pen = new PdfPen(doc);
  const st = project.settings;
  const issued = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const screens = project.screens.filter((s) => comps[s.id]);
  const plan = opts.plan !== undefined ? opts.plan : planControllers(project, comps);
  const pages = [];

  /* ---- overview ---- */
  const tableRows = screens.map((s, i) => {
    const c = comps[s.id];
    const types = Object.values(c.byPanel).map((b) => b.panel.name.replace(/^Generic /, '')).join(' + ');
    return { _swatch: s.color, n: `${i + 1}. ${s.name}`, panel: types, cab: fmtInt(c.count), size: `${fmtM(c.W)} × ${fmtM(c.H)}`, res: fmtRes(c.resW, c.resH), ports: c.ports.length, circ: c.power ? c.power.circuits.length : '—', pw: fmtW(c.wMax), kg: fmtKg(c.weight) };
  });
  const totalRow = { _total: true, n: 'Total', panel: '', cab: fmtInt(totals.cabinets), size: '', res: `${fmtInt(totals.pixels)} px`, ports: totals.ports, circ: totals.circuits ?? '—', pw: fmtW(totals.wMax), kg: fmtKg(totals.weight) };
  const firstRows = tableRows.slice(0, 7), moreRows = tableRows.slice(7);
  const tcols = [
    { key: 'n', label: 'Screen', w: 41, swatch: true, bold: true }, { key: 'panel', label: 'Panel', w: 38 }, { key: 'cab', label: 'Cabinets', w: 15, align: 'right' },
    { key: 'size', label: 'Size (m)', w: 19, align: 'right' }, { key: 'res', label: 'Resolution (px)', w: 25, align: 'right' }, { key: 'ports', label: 'Ports', w: 10, align: 'right' },
    { key: 'circ', label: 'Circuits', w: 13, align: 'right' }, { key: 'pw', label: 'Max power', w: 17, align: 'right' }, { key: 'kg', label: 'Weight', w: 17, align: 'right' }];

  pages.push({ title: 'Overview', sub: `${screens.length} screen${screens.length === 1 ? '' : 's'} · ${fmtInt(totals.cabinets)} cabinets`, draw: () => {
    const lx = PAGE.m, lw = 72;
    let y = PAGE.top + 3;
    pen.text('PROJECT', lx, y, { font: 'cond', size: 3, fill: PDF_INK3 }); y += 5;
    const contact = [st.contact, st.phone].filter(Boolean).join(', ');
    const info = [['Project', project.name], ['Client', project.client], ['Venue', st.venue], st.address ? ['Address', st.address] : null, ['Event date', st.eventDate],
      st.setup ? ['Setup', st.setup] : null, st.teardown ? ['Teardown', st.teardown] : null, contact ? ['On-site contact', contact] : null,
      ['Revision', project.revision], ['Prepared by', st.preparedBy], ['Issued', issued]].filter(Boolean);
    y = pdfKeyValues(pen, lx, y, lw, info);
    y += 3; pen.text('TOTALS', lx, y, { font: 'cond', size: 3, fill: PDF_INK3 }); y += 5;
    y = pdfKeyValues(pen, lx, y, lw, [['Cabinets', fmtInt(totals.cabinets)], ['Active pixels', fmtInt(totals.pixels)], ['LED area', `${fmtNum(totals.area, 2)} m²`],
      ['Data ports', `${totals.ports} × ${fmtInt(st.portCapacity)} px${totals.backupPorts ? ` + ${totals.backupPorts} backup` : ''}`],
      plan ? ['Controller', `${plan.count} × NovaStar ${plan.model.name}${plan.auto ? ' (suggested)' : ''}`] : null,
      ['Power circuits', totals.circuits === null ? 'no power data' : `${totals.circuits} × ${fmtInt(st.circuitAmps)} A at ${fmtInt(st.voltage)} V`],
      ['Max / typical power', `${fmtW(totals.wMax)} / ${fmtW(totals.wAvg)}`], ['Weight', `${fmtKg(totals.weight)}, cabinets only`]].filter(Boolean));
    if (screens.some((s) => usesGeneric(comps[s.id]))) {
      y += 1;
      for (const ln of pdfWrap(pen, 'Weight and power for generic presets are typical values, not a specific product. Enter datasheet values as custom panels for exact figures.', lw, { size: 2.3 })) { pen.text(ln, lx, y, { size: 2.3, fill: PDF_INK3 }); y += 3.2; }
    }
    if (st.notes && y < PAGE.bottom - 12) {
      y += 3; pen.text('NOTES', lx, y, { font: 'cond', size: 3, fill: PDF_INK3 }); y += 4.6;
      const lines = pdfWrap(pen, st.notes, lw, { size: 2.6 });
      const room = Math.max(1, Math.floor((PAGE.bottom - y) / 3.6) + 1);
      const shown = lines.length > room ? [...lines.slice(0, room - 1), lines[room - 1].replace(/\s*\S*$/, '') + ' …'] : lines;
      for (const ln of shown) { pen.text(ln, lx, y, { size: 2.6, fill: PDF_INK }); y += 3.6; }
    }
    // layout drawing
    const bx = lx + lw + 9, bw = PAGE.w - PAGE.m - bx, by = PAGE.top + 1, bh = 96;
    pen.rect(bx, by, bw, bh, { fill: '#FFFFFF', stroke: PDF_RULE, sw: 0.2 });
    pen.text('STAGE LAYOUT  ·  FRONT VIEW, DEVELOPED', bx + 2.5, by + 4.6, { font: 'cond', size: 2.8, fill: PDF_INK3 });
    const fs = 2.8;
    const opts = { pal: PRINT_PAL, labels: true, dims: true, print: true, minGrid: 3 };
    const sbox = { x: bx + 0.2, y: by + 7, w: bw - 0.4, h: bh - 7.2 };
    const f = fitStageView(project, comps, { x: sbox.x + 1, y: sbox.y + 4, w: sbox.w - 2, h: sbox.h - 5 }, fs, pen, opts);
    drawStage(pen, Object.assign({ project, comps, fs, s: f.s, tx: f.tx, ty: f.ty, box: sbox, grid: true }, opts));
    // table
    const ty2 = by + bh + 6;
    pen.text('SCREENS', bx, ty2, { font: 'cond', size: 3, fill: PDF_INK3 });
    const scale = bw / sum(tcols, (c) => c.w);
    const cols = tcols.map((c) => Object.assign({}, c, { w: c.w * scale }));
    pdfTable(pen, bx, ty2 + 2.5, cols, moreRows.length ? firstRows : [...firstRows, totalRow], { rh: 5.4, size: 2.5 });
  } });
  // further screens: 26 rows per page, the total row after the last one
  for (let i = 0; i < moreRows.length; i += 26) {
    const chunk = moreRows.slice(i, i + 26), last = i + 26 >= moreRows.length;
    pages.push({ title: 'Overview', sub: 'screens, continued', draw: () => {
      const cols = tcols.map((c) => Object.assign({}, c, { w: c.w * ((PAGE.w - 2 * PAGE.m) / sum(tcols, (x) => x.w)) }));
      pdfTable(pen, PAGE.m, PAGE.top + 2, cols, last ? [...chunk, totalRow] : chunk, { rh: 5.4, size: 2.5 });
    } });
  }

  /* ---- 3D snapshot ---- */
  if (st.report3D && opts.snapshot) {
    pages.push({ title: '3D view', sub: 'schematic visualisation', draw: () => {
      const maxW = PAGE.w - 2 * PAGE.m, maxH = PAGE.bottom - PAGE.top - 10;
      let w = maxW, h = w * opts.snapshotAspect; if (h > maxH) { h = maxH; w = h / opts.snapshotAspect; }
      const x = (PAGE.w - w) / 2, y = PAGE.top + 1;
      pen.image(opts.snapshot, x, y, w, h, 'JPEG');
      pen.rect(x, y, w, h, { fill: 'none', stroke: PDF_RULE, sw: 0.2 });
      pen.text('Positions, rotations and curves as set in the planner. A 1.75 m figure is shown for scale when enabled. Curve radii are calculated; confirm the mechanical fit with the cabinet supplier.', x, y + h + 5, { size: 2.5, fill: PDF_INK3 });
    } });
  }

  /* ---- controller and data ports (whole project) ---- */
  if (plan) {
    const D = plan.model, multi = plan.count > 1;
    const ctrlRows = [];
    for (const u of plan.units) for (const r of u.rows) {
      ctrlRows.push({ _swatch: r.screen.color, unit: String(u.index + 1), out: r.out, role: r.role === 'main' ? 'Main' : `Backup of ${r.backupOf}`,
        screen: r.screen.name, port: r.port.label, at: `${colLetter(r.at.c)}${r.at.r + 1} (${r.role === 'main' ? 'first' : 'last'} cabinet)`, cab: r.port.count, px: fmtInt(r.port.load) });
    }
    const cc = [...(multi ? [{ key: 'unit', label: 'Unit', w: 10, align: 'right' }] : []), { key: 'out', label: 'Output', w: 13, align: 'right' }, { key: 'role', label: 'Carries', w: 22 },
      { key: 'screen', label: 'Screen', w: 38, swatch: true, bold: true }, { key: 'port', label: 'Port', w: 12 }, { key: 'at', label: 'Cable connects at', w: 32 },
      { key: 'cab', label: 'Cabinets', w: 15, align: 'right' }, { key: 'px', label: 'Pixels', w: 19, align: 'right' }];
    const RH2 = 5.0, topY = PAGE.top + 52;
    const perCol1 = Math.max(1, Math.floor((PAGE.bottom - 2 - topY) / RH2) - 1);
    const ncols1 = ctrlRows.length > perCol1 ? 2 : 1;
    const first = Math.min(ctrlRows.length, perCol1 * ncols1);
    const usedOuts = sum(plan.units, (u) => u.used);
    pages.push({ title: 'Controller and data ports', sub: `${plan.count} × NovaStar ${D.name}${plan.auto ? ', suggested' : ''}`, draw: () => {
      pen.text('CONTROLLER', PAGE.m, PAGE.top + 3, { font: 'cond', size: 3, fill: PDF_INK3 });
      pdfKeyValues(pen, PAGE.m, PAGE.top + 8, 128, [
        ['Controller', `${plan.count} × NovaStar ${D.name}${plan.auto ? ' (suggested by the planner)' : ''}`],
        ['Outputs in use', multi ? `${fmtInt(usedOuts)} on ${plan.count} units of ${D.ports}${plan.count <= 4 ? ` (${plan.units.map((u) => u.used).join(' + ')})` : ''}` : `${usedOuts} of ${D.ports}`],
        ['Pixels', multi ? `${fmtInt(plan.pixels)} in total, up to ${fmtInt(D.capacity)} per unit${plan.count <= 4 ? ` (${plan.units.map((u) => fmtInt(u.pixels)).join(' + ')})` : ''}` : `${fmtInt(plan.pixels)} of ${fmtInt(D.capacity)}`],
        ['Largest output image', `${fmtInt(D.maxW)} × ${fmtInt(D.maxH)} px per unit`],
        ['Per data port', `${fmtInt(st.portCapacity)} px`],
        ['Backup cables', st.backup ? `Yes: ${plan.backups}, from the last cabinet of each chain` : 'No'],
      ], { size: 2.6, lh: 5.0 });
      const notes = [`Outputs ${st.backup ? `are numbered main first, then the backups in the same order (on each unit, backup output = number of main outputs + main output). Pair them as backups in NovaLCT or on the controller.` : 'carry one data port each, in the order of the screens.'}`,
        `Capacities are NovaStar's 8-bit, 60 Hz figures. Higher colour depth or frame rates lower them.`,
        `Screens that share a unit must also fit together in its output image. Confirm the receiving cards and the controller setup with your NovaStar configuration.`];
      let ny = PAGE.top + 8;
      for (const ln of pdfWrap(pen, notes.join(' '), 130, { size: 2.4 })) { pen.text(ln, PAGE.m + 143, ny, { size: 2.4, fill: PDF_INK3 }); ny += 3.4; }
      // warnings, as many as fit above the output table
      for (let wi = 0; wi < plan.warnings.length; wi++) {
        const lines = pdfWrap(pen, 'Check: ' + plan.warnings[wi], 130, { size: 2.4 });
        if (ny + 1.5 + (lines.length + 1) * 3.4 > topY - 6) { pen.text(`Check: ${plan.warnings.length - wi} more screen${plan.warnings.length - wi === 1 ? ' is' : 's are'} larger than one unit outputs.`, PAGE.m + 143, ny + 1.5, { size: 2.4, fill: '#B45309' }); break; }
        for (const ln of lines) { pen.text(ln, PAGE.m + 143, ny + 1.5, { size: 2.4, fill: '#B45309' }); ny += 3.4; }
      }
      pen.text('OUTPUTS', PAGE.m, topY - 3, { font: 'cond', size: 3, fill: PDF_INK3 });
      pdfTableColumns(pen, PAGE.m, topY, PAGE.w - 2 * PAGE.m, cc, ctrlRows.slice(0, first), { ncols: ncols1, perCol: perCol1, rh: RH2, size: 2.4 });
      if (ctrlRows.length > first) pen.text('The output list continues on the next page.', PAGE.m, PAGE.bottom + 1.5, { size: 2.3, fill: PDF_INK3 });
    } });
    for (let i = first; i < ctrlRows.length;) {
      const perCol = Math.floor((PAGE.bottom - PAGE.top - 6) / RH2) - 1, n = perCol * 2, from = i;
      pages.push({ title: 'Controller and data ports', sub: 'outputs, continued', draw: () => {
        pdfTableColumns(pen, PAGE.m, PAGE.top + 1, PAGE.w - 2 * PAGE.m, cc, ctrlRows.slice(from, from + n), { ncols: 2, perCol, rh: RH2, size: 2.4 });
      } });
      i += n;
    }
  }

  /* ---- per screen ---- */
  screens.forEach((s, idx) => {
    const c = comps[s.id];
    const tag = `${idx + 1}/${screens.length}`;
    // A: elevation
    const notes = ['Numbers show the build order: up the first column from bottom left, then down the next. Letters name columns, numbers name rows from the bottom.'];
    if (c.holes) notes.push(`${c.holes} cabinet position${c.holes === 1 ? ' is' : 's are'} left empty (dashed).`);
    if (c.curve) notes.push(`Curved ${c.curve.shape}: ${fmtNum(c.curve.angle, 2)}° between columns, ${fmtNum(c.curve.arc, 1)}° in total, radius ${fmtM(c.curve.rIn, 2)} m to the front face, chord ${fmtM(c.curve.chord, 2)} m, depth ${fmtM(c.curve.depth, 2)} m. Radius is calculated; confirm with the curve brackets available.`);
    const noteLines = pdfWrap(pen, notes.join(' '), PAGE.w - 2 * PAGE.m, { size: 2.4 });
    // text under the drawing: one line per panel type, the summary line, then the notes; the drawing takes what is left
    const textH = Object.keys(c.byPanel).length * 5 + 7 + noteLines.length * 3.4;
    const elevH = Math.min(140, PAGE.bottom + 2 - PAGE.top - textH - 7);
    pages.push({ title: `${s.name} — front elevation`, sub: `screen ${tag} · cabinet build order${c.curve ? ' · developed view' : ''}`, draw: () => {
      drawPlan(pen, c, { x: PAGE.m, y: PAGE.top, w: PAGE.w - 2 * PAGE.m, h: elevH }, { mode: 'cabinets', dims: true, labels: true, pal: PRINT_PAL, fs: 3.1, screenColor: s.color, minText: 1.4, minStroke: 0.12, prefix: st.portPrefix });
      let y = PAGE.top + elevH + 7;
      for (const b of Object.values(c.byPanel)) {
        const p = b.panel;
        pen.rect(PAGE.m, y - 2.6, 3.2, 3.2, { fill: s.color, opacity: 0.85, rx: 0.4 });
        pen.text(`${b.count} × ${p.name}  —  ${fmtNum(p.w, 1)} × ${fmtNum(p.h, 1)} mm  —  ${p.px} × ${p.py} px  —  pitch ${fmtPitch(p)} mm${p.kg !== null ? `  —  ${fmtNum(p.kg, 1)} kg` : ''}${p.wMax !== null ? `  —  ${fmtInt(p.wMax)} W max` : ''}${p.builtin && (p.kg !== null || p.wMax !== null) ? ' (typical)' : ''}`, PAGE.m + 5, y, { size: 2.7, fill: PDF_INK });
        y += 5;
      }
      pen.text(`${s.name}: ${c.count} cabinets · ${fmtNum(c.area, 2)} m² · ${fmtRes(c.resW, c.resH)} px (${fmtInt(c.pixels)} px active) · centre ${fmtM(s.x, 2)} m from CL, bottom ${fmtM(s.y, 2)} m above floor`, PAGE.m, y + 1, { size: 2.7, weight: 600, fill: PDF_INK });
      y += 6;
      for (const ln of noteLines) { pen.text(ln, PAGE.m, y, { size: 2.4, fill: PDF_INK3 }); y += 3.4; }
    } });
    // B: data
    const portCols = [{ key: 'port', label: 'Port', w: 20, swatch: true, bold: true }, { key: 'start', label: 'Input', w: 16 }, ...(st.backup ? [{ key: 'bk', label: 'Backup', w: 16 }] : []), { key: 'cab', label: 'Cabinets', w: 18, align: 'right' }, { key: 'px', label: 'Pixels used / capacity', w: 44, align: 'right' }, { key: 'load', label: 'Load', w: 14, align: 'right' }];
    const portRows = c.ports.map((p) => { const f = p.cells[0], l = p.cells[p.cells.length - 1]; return { _swatch: p.color, port: p.label, start: `${colLetter(f.c)}${f.r + 1}`, bk: `${colLetter(l.c)}${l.r + 1}`, cab: p.count, px: `${fmtInt(p.load)} / ${fmtInt(p.cap)}`, load: `${Math.round(p.load / p.cap * 100)}%` }; });
    const RH = 5.0;
    const few = portRows.length <= 10;
    const ph = few ? Math.max(80, PAGE.bottom - PAGE.top - (portRows.length * RH + 22)) : 104;
    const firstY = PAGE.top + ph + 6.5;
    const perColFirst = Math.max(1, Math.floor((PAGE.bottom - 7 - firstY) / RH) - 1);
    const ncolsFirst = few ? 1 : 3;
    const firstCount = few ? portRows.length : perColFirst * ncolsFirst;
    pages.push({ title: `${s.name} — data cabling`, sub: `screen ${tag} · pixel map, ${c.ports.length} port${c.ports.length === 1 ? '' : 's'}`, draw: () => {
      drawPlan(pen, c, { x: PAGE.m, y: PAGE.top, w: PAGE.w - 2 * PAGE.m, h: ph }, { mode: 'data', dims: false, labels: true, pal: PRINT_PAL, fs: 3.1, screenColor: s.color, minText: 1.4, minStroke: 0.12, prefix: st.portPrefix, backup: st.backup });
      let y = PAGE.top + ph + 4;
      const d = s.data || {};
      const startTxt = { bl: 'bottom left', br: 'bottom right', tl: 'top left', tr: 'top right' }[d.start || 'bl'];
      const whole = d.dir === 'v' ? 'whole columns' : 'whole rows';
      const dataLine = `${fmtRes(c.resW, c.resH)} px · ${c.ports.length} cable${c.ports.length === 1 ? '' : 's'} / data port${c.ports.length === 1 ? '' : 's'} · ${d.path === 'z' ? 'Z pattern' : 'snake'} along ${d.dir === 'v' ? 'columns' : 'rows'}, starting ${startTxt}${d.split === 'fill' ? ', ports filled to capacity' : `, ${whole} per port where they fit`}${st.backup ? ' · backup cable from each last cabinet (BK)' : ''}`;
      const withName = `${s.name} · ${dataLine}`;
      pen.text(pen.measure(withName, { size: 2.7, weight: 600 }) <= PAGE.w - 2 * PAGE.m ? withName : dataLine, PAGE.m, y, { size: 2.7, weight: 600, fill: PDF_INK });
      y += 2.5;
      if (few) y = pdfTable(pen, PAGE.m, y, portCols.map((k) => Object.assign({}, k, { w: k.w * 1.12 })), portRows, { rh: RH, size: 2.5 });
      else y = pdfTableColumns(pen, PAGE.m, y, PAGE.w - 2 * PAGE.m, portCols, portRows.slice(0, firstCount), { ncols: ncolsFirst, perCol: perColFirst, rh: RH, size: 2.4 });
      const more = portRows.length - firstCount;
      pen.text(`${fmtInt(st.portCapacity)} px per cable. Confirm the processor, receiving cards, refresh rate and colour depth. ${st.backup ? 'BK marks the last cabinet of each chain, where its backup cable runs back to the controller.' : 'Backup (redundant) cabling is not included; it can be switched on in the settings.'}${more > 0 ? ` The port list continues on the next page.` : ''}`, PAGE.m, y + 4, { size: 2.4, fill: PDF_INK3 });
    } });
    for (let i = firstCount; i < portRows.length;) {
      const perCol = Math.floor((PAGE.bottom - PAGE.top - 6) / RH) - 1, n = perCol * 3, from = i;
      pages.push({ title: `${s.name} — data ports`, sub: `screen ${tag} · continued`, draw: () => {
        pdfTableColumns(pen, PAGE.m, PAGE.top + 1, PAGE.w - 2 * PAGE.m, portCols, portRows.slice(from, from + n), { ncols: 3, perCol, rh: RH, size: 2.4 });
      } });
      i += n;
    }
    // C: specs and power
    const circCols = [{ key: 'c', label: 'Circuit', w: 24, swatch: true, bold: true }, { key: 'cab', label: 'Cabinets', w: 22, align: 'right' }, { key: 'w', label: 'Watts', w: 24, align: 'right' }, { key: 'a', label: 'Amps', w: 20, align: 'right' }];
    const circRows = c.power ? c.power.circuits.map((k) => ({ _swatch: k.color, c: k.label, cab: k.count, w: fmtInt(k.load), a: fmtNum(k.amps, 1) })) : [];
    if (st.reportPower) {
      const lw = 128, px = PAGE.m + lw + 10, pw = PAGE.w - PAGE.m - px, ph = 78, CRH = 4.6;
      // lay out the power column once, so the continuation pages pick up exactly where this page stops
      const powerText = c.power ? pdfWrap(pen, `${c.power.circuits.length} circuit${c.power.circuits.length === 1 ? '' : 's'} of ${fmtInt(st.circuitAmps)} A at ${fmtInt(st.voltage)} V, loaded to ${Math.round(st.loadFactor * 100)}% at power factor ${fmtNum(st.powerFactor || 1, 2)} (${fmtInt(c.power.circuitW)} W each), sized on ${st.powerBasis === 'avg' ? 'typical' : 'maximum'} power${typicalNote(c)}. Chains follow the data path.`, pw, { size: 2.4 }) : [];
      const tableY = PAGE.top + ph + 9 + powerText.length * 3.3 - 0.8;
      const perColP = Math.max(1, Math.floor((PAGE.bottom - 2 - tableY) / CRH) - 1);
      const ncolsP = circRows.length > perColP ? 2 : 1;
      const onPage = Math.min(circRows.length, perColP * ncolsP);
      pages.push({ title: `${s.name} — specifications and power`, sub: `screen ${tag}`, draw: () => {
        pen.text('SPECIFICATIONS', PAGE.m, PAGE.top + 3, { font: 'cond', size: 3, fill: PDF_INK3 });
        let y = pdfKeyValues(pen, PAGE.m, PAGE.top + 8, lw, screenSpecs(project, s, c), { size: 2.6, lh: 5.0 });
        y += 3; pen.text('CABINETS', PAGE.m, y, { font: 'cond', size: 3, fill: PDF_INK3 }); y += 2.5;
        const bom = Object.values(c.byPanel).map((b) => ({ type: b.panel.name, qty: b.count, size: `${fmtNum(b.panel.w, 1)} × ${fmtNum(b.panel.h, 1)}`, res: `${b.panel.px} × ${b.panel.py}`, kg: b.panel.kg === null ? '—' : fmtNum(b.panel.kg * b.count, 0), w: b.panel.wMax === null ? '—' : fmtInt(b.panel.wMax * b.count) }));
        pdfTable(pen, PAGE.m, y, [{ key: 'type', label: 'Type', w: 46 }, { key: 'qty', label: 'Qty', w: 12, align: 'right' }, { key: 'size', label: 'Size (mm)', w: 22, align: 'right' }, { key: 'res', label: 'Pixels', w: 18, align: 'right' }, { key: 'kg', label: 'kg', w: 13, align: 'right' }, { key: 'w', label: 'Max W', w: 17, align: 'right' }], bom, { rh: 5.0, size: 2.5 });
        pen.text('POWER CIRCUITS', px, PAGE.top + 3, { font: 'cond', size: 3, fill: PDF_INK3 });
        if (!c.power) { pen.text('Add weight and power values to the panel to plan circuits.', px, PAGE.top + 10, { size: 2.7, fill: PDF_INK2 }); return; }
        drawPlan(pen, c, { x: px, y: PAGE.top + 5, w: pw, h: ph }, { mode: 'power', dims: false, labels: true, pal: PRINT_PAL, fs: 2.6, screenColor: s.color, minText: 1.3, minStroke: 0.1, prefix: st.portPrefix });
        let y2 = PAGE.top + ph + 9;
        for (const ln of powerText) { pen.text(ln, px, y2, { size: 2.4, fill: PDF_INK2 }); y2 += 3.3; }
        pdfTableColumns(pen, px, tableY, ncolsP === 1 ? Math.min(pw, 92) : pw, circCols, circRows.slice(0, onPage), { ncols: ncolsP, perCol: perColP, rh: CRH, size: 2.3, gap: 4 });
        if (circRows.length > onPage) pen.text('The circuit list continues on the next page.', px, PAGE.bottom + 1.5, { size: 2.3, fill: PDF_INK3 });
      } });
      for (let i = onPage; i < circRows.length;) {
        const perCol = Math.floor((PAGE.bottom - PAGE.top - 6) / CRH) - 1, n = perCol * 4, from = i;
        pages.push({ title: `${s.name} — power circuits`, sub: `screen ${tag} · continued`, draw: () => {
          pdfTableColumns(pen, PAGE.m, PAGE.top + 1, PAGE.w - 2 * PAGE.m, circCols, circRows.slice(from, from + n), { ncols: 4, perCol, rh: CRH, size: 2.3, gap: 5 });
        } });
        i += n;
      }
    }
  });

  /* ---- packing list ---- */
  if (st.reportPacking !== false) {
    const items = packingList(project, comps, plan);
    const pc = [{ key: 'group', label: 'Group', w: 17 }, { key: 'pk', label: 'Packed', w: 13 }, { key: 'ld', label: 'Loaded', w: 13 }, { key: 'qty', label: 'Qty', w: 12, align: 'right' },
      { key: 'item', label: 'Item', w: 86 }, { key: 'per', label: 'Per screen', w: 80 }, { key: 'note', label: 'Note', w: 52 }];
    const size = 2.4, lh = 3.1, HEAD = 5.6;
    const rows = items.map((it) => {
      const cell = (txt, key, o = {}) => pdfWrap(pen, txt, pc.find((c) => c.key === key).w - 3.2, Object.assign({ size }, o));
      const item = cell(it.item, 'item', { weight: 600 }), per = cell(it.parts.map((x) => `${x.name}: ${x.n}`).join('  ·  '), 'per'), note = cell(it.note, 'note');
      return { it, item, per, note, h: Math.max(1, item.length, per.length, note.length) * lh + 2.4 };
    });
    const chunks = []; let cur = [], yy = PAGE.top + 2 + HEAD;
    for (const r of rows) { if (cur.length && yy + r.h > PAGE.bottom - 16) { chunks.push(cur); cur = []; yy = PAGE.top + 2 + HEAD; } cur.push(r); yy += r.h; }
    chunks.push(cur);
    chunks.forEach((chunk, ci) => {
      const last = ci === chunks.length - 1;
      pages.push({ title: 'Packing list', sub: ci ? 'continued' : 'tick each line when packed and when loaded', draw: () => {
        const x0 = PAGE.m; let y = PAGE.top + 2;
        const totalW = sum(pc, (c) => c.w);
        pen.rect(x0, y, totalW, HEAD, { fill: '#EEF2F6' });
        let cx = x0;
        for (const c of pc) { pen.text(c.label, c.align === 'right' ? cx + c.w - 1.6 : cx + 1.6, y + HEAD / 2, { size: size * 0.92, weight: 600, fill: PDF_INK2, anchor: c.align === 'right' ? 'end' : 'start', baseline: 'middle' }); cx += c.w; }
        y += HEAD;
        chunk.forEach((r, i) => {
          if (i % 2 === 1) pen.rect(x0, y, totalW, r.h, { fill: '#F7F9FB' });
          let x = x0; const ty = y + 1.2 + lh * 0.72;
          for (const c of pc) {
            if (c.key === 'pk' || c.key === 'ld') pen.rect(x + c.w / 2 - 1.6, y + 1.1, 3.2, 3.2, { fill: '#FFFFFF', stroke: PDF_INK2, sw: 0.25, rx: 0.3 });
            else if (c.key === 'group') pen.text(r.it.group, x + 1.6, ty, { size, fill: PDF_INK3 });
            else if (c.key === 'qty') pen.text(fmtInt(r.it.qty), x + c.w - 1.6, ty, { size, weight: 600, fill: PDF_INK, anchor: 'end' });
            else r[c.key].forEach((ln, k) => pen.text(ln, x + 1.6, ty + k * lh, { size, weight: c.key === 'item' ? 600 : 400, fill: c.key === 'note' ? PDF_INK3 : PDF_INK }));
            x += c.w;
          }
          y += r.h;
          pen.line(x0, y, x0 + totalW, y, { stroke: '#E6EBF0', sw: 0.15 });
        });
        if (last) {
          y += 6;
          pen.text(`Cabinet weight in total: ${fmtKg(totals.weight)}${screens.some((sc) => usesGeneric(comps[sc.id])) ? ' (typical values for generic presets)' : ''}. Cable lengths from the controller and power distribution depend on where they stand.`, x0, y, { size: 2.4, fill: PDF_INK3 });
          y += 9;
          for (const [k, at] of [['Packed by', 0], ['Date', 70], ['Loaded by', 120], ['Date', 190]]) {
            pen.text(k, x0 + at, y, { size: 2.5, fill: PDF_INK2 });
            pen.line(x0 + at + pen.measure(k, { size: 2.5 }) + 2, y + 0.6, x0 + at + (at === 0 || at === 120 ? 64 : 48), y + 0.6, { stroke: PDF_INK3, sw: 0.2 });
          }
        }
      } });
    });
  }

  pages.forEach((pg, i) => { if (i) { doc.addPage(); pen.newPage(); } pdfFrame(pen, project, pg.title, pg.sub, i + 1, pages.length, issued); pg.draw(); });
  return doc.output('blob');
}
