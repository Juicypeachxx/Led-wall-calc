/* ============================================================
   APP — state, undo history, rendering and interaction.
   ============================================================ */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const PF = Prefs.load();

const S = {
  project: null, comps: {}, totals: null,
  activeId: null, selection: new Set(),
  view: { s: 0.05, tx: 0, ty: 0, fitted: false },
  undo: [], redo: [], lastSnap: '', lastKey: '', lastTime: 0,
  pal: {}, dark: true, guides: [],
  saveTimer: 0, pristine: true, fresh: false, lastSetId: '', suggOpen: false,
  libNote: '', libPrune: [],
};

/* ---------- your panels ----------
   own: panels added here, by hand or from a spreadsheet; saved in this browser (and in the viewer's
   account when there is one). site: panels.xlsx (or panels.csv) next to the planner, e.g. in its GitHub
   repository, read each time the planner opens and kept for offline use. Both show in every panel list.
   A project keeps its own copy of each panel it uses, so its project file works anywhere. */
const cmpText = (a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true });
const byBrandModel = (a, b) => cmpText(a.brand || '\uffff', b.brand || '\uffff') || cmpText(a.model || a.name, b.model || b.name);
const Lib = {
  own: [], site: null, subs: new Set(),
  load() {
    const seen = new Set();
    this.own = Store.localLibrary().map((c) => { try { return normalizePanel(c); } catch (e) { return null; } }).filter((p) => p && !seen.has(p.id) && seen.add(p.id));
    const site = Store.siteCache();
    this.site = site ? Object.assign({}, site, { panels: site.panels.map(normalizePanel) }) : null;
  },
  all() { const ids = new Set(this.own.map((p) => p.id)); return [...this.own, ...((this.site && this.site.panels) || []).filter((p) => !ids.has(p.id))]; },
  find(id) { return this.own.find((p) => p.id === id) || (this.site && this.site.panels.find((p) => p.id === id)) || null; },
  isOwn(id) { return this.own.some((p) => p.id === id); },
  isSite(id) { return !this.isOwn(id) && !!(this.site && this.site.panels.some((p) => p.id === id)); },
  saveOwn() { this.own.sort(byBrandModel); Store.saveLibrary(this.own); this.emit(); },
  upsert(p) { const i = this.own.findIndex((x) => x.id === p.id); if (i >= 0) this.own[i] = p; else this.own.push(p); this.saveOwn(); },
  remove(id) { this.own = this.own.filter((x) => x.id !== id); this.saveOwn(); },
  setSite(v) { this.site = v; Store.saveSiteCache(v); this.emit(); },
  brands() { return [...new Set(this.all().map((p) => p.brand).filter(Boolean))].sort(cmpText); },
  on(fn) { this.subs.add(fn); return () => this.subs.delete(fn); },
  emit() { for (const f of [...this.subs]) { try { f(); } catch (e) { console.error(e); } } },
};
// a project keeps a copy of every panel its screens use; copies of list panels no screen uses are dropped
function adoptPanels(p) {
  const used = new Set();
  for (const s of p.screens) { used.add(s.panel); if (s.mix) { used.add(s.mix.small); used.add(s.mix.big); } }
  for (const id of used) { if (findPanel(p, id)) continue; const lp = Lib.find(id); if (lp) p.catalog.push(deepClone(lp)); }
  p.catalog = p.catalog.filter((c) => used.has(c.id) || !Lib.find(c.id));
}
// cabinets of one panel across the whole project, for the stock check
function projectUse(id) {
  let n = 0;
  for (const s of S.project.screens) { const c = S.comps[s.id]; if (c) for (const b of Object.values(c.byPanel)) if (b.panel.id === id) n += b.count; }
  return n;
}

/* ---------- toasts ---------- */
function toast(msg, action) {
  const box = $('#toasts'); if (!box) return;
  const t = document.createElement('div'); t.className = 'toast';
  const span = document.createElement('span'); span.textContent = msg; t.appendChild(span);
  if (action) { const b = document.createElement('button'); b.textContent = action.label; b.onclick = () => { t.remove(); action.run(); }; t.appendChild(b); }
  box.appendChild(t);
  setTimeout(() => t.remove(), action ? 6500 : 3400);
  while (box.children.length > 3) box.firstChild.remove();
}

/* ---------- theme & palette ---------- */
function readPalette() {
  const cs = getComputedStyle(document.documentElement); const v = (n) => cs.getPropertyValue(n).trim();
  S.dark = luminance(v('--bg') || '#000000') < 0.2;
  S.pal = { bg: v('--plan-bg'), canvas: v('--canvas'), ink: v('--ink'), ink2: v('--ink-2'), ink3: v('--ink-3'), grid: v('--grid'), gridMajor: v('--grid-major'),
    floor: v('--floor'), floorFill: v('--floor-fill'), cl: v('--cl'), dim: v('--dim'), seam: v('--seam'), hole: v('--hole'), path: v('--path'), accent: v('--accent'),
    cellAlpha: S.dark ? 0.66 : 0.5, panelFill: S.dark ? 0.9 : 0.86 };
}
function applyTheme() {
  const root = document.documentElement;
  if (PF.theme === 'light' || PF.theme === 'dark') root.dataset.theme = PF.theme;
  readPalette();
  const use = $('#btn-theme use'); if (use) use.setAttribute('href', S.dark ? '#i-sun' : '#i-moon');
}
function applyMode() {
  document.documentElement.dataset.mode = PF.mode;
  $$('#mode-seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === PF.mode)));
}
const planMode = () => (PF.mode === 'simple' && PF.planMode === 'power' ? 'data' : PF.planMode);
const faceMode = () => (PF.mode === 'simple' && PF.face === 'power' ? 'cabinets' : PF.face);

/* ---------- project lifecycle ---------- */
// fresh: a new, empty project that has not been saved yet (it is saved on the first change)
function setProject(p, { keepView = false, fresh = false } = {}) {
  S.project = p; S.undo = []; S.redo = []; S.lastSnap = JSON.stringify(p); S.lastKey = ''; S.fresh = fresh;
  S.activeId = p.screens[0] ? p.screens[0].id : null;
  S.selection = new Set(S.activeId ? [S.activeId] : []);
  S.pristine = true;
  if (!keepView) S.view.fitted = false;
  recompute();
}
function recompute() {
  const comps = {};
  for (const s of S.project.screens) { try { comps[s.id] = computeScreen(S.project, s); } catch (e) { console.error('compute failed', s, e); } }
  S.comps = comps;
  S.totals = computeTotals(S.project, comps);
  try { S.plan = planControllers(S.project, comps); } catch (e) { console.error('controller plan failed', e); S.plan = null; }
}
function active() { return S.project.screens.find((s) => s.id === S.activeId) || S.project.screens[0] || null; }
function findScreen(id) { return S.project.screens.find((s) => s.id === id) || null; }

function change(fn, { key = '', structural = false, history = true } = {}) {
  fn(S.project);
  adoptPanels(S.project);
  S.project.updated = new Date().toISOString();
  if (S.project.example) delete S.project.example;
  S.pristine = false; S.fresh = false;
  recompute();
  let pruned = false;
  for (const s of S.project.screens) {
    const c = S.comps[s.id]; if (!c || !s.holes || !s.holes.length) continue;
    const keep = holesInGrid(s, c); if (keep.length !== s.holes.length) { s.holes = keep; pruned = true; }
  }
  if (pruned) recompute();
  if (history) commit(key);
  if (structural) renderAll(); else renderLight();
  scheduleSave();
}
function commit(key) {
  const snap = JSON.stringify(S.project);
  if (snap === S.lastSnap) return;
  const now = Date.now();
  const coalesce = key && key === S.lastKey && now - S.lastTime < 1500;
  if (!coalesce) { S.undo.push(S.lastSnap); if (S.undo.length > 150) S.undo.shift(); }
  S.redo = []; S.lastSnap = snap; S.lastKey = key; S.lastTime = now;
  updateUndo();
}
function restore(snap) {
  const p = JSON.parse(snap);
  S.project = p; S.lastSnap = snap; S.lastKey = '';
  if (!p.screens.some((s) => s.id === S.activeId)) S.activeId = p.screens[0] ? p.screens[0].id : null;
  S.selection = new Set([...S.selection].filter((id) => p.screens.some((s) => s.id === id)));
  S.pristine = false;
  recompute(); renderAll(); scheduleSave();
}
function undo() { if (!S.undo.length) return; S.redo.push(S.lastSnap); restore(S.undo.pop()); }
function redo() { if (!S.redo.length) return; S.undo.push(S.lastSnap); restore(S.redo.pop()); }
function updateUndo() { const u = $('#btn-undo'), r = $('#btn-redo'); if (u) u.disabled = !S.undo.length; if (r) r.disabled = !S.redo.length; }

/* ---------- saving ---------- */
function scheduleSave() {
  if (S.pristine) return;
  clearTimeout(S.saveTimer);
  S.saveTimer = setTimeout(saveNow, 900);
}
async function saveNow() {
  clearTimeout(S.saveTimer);
  if (!S.project) return;
  const p = S.project;
  await Store.save(p);
  if (S.lastSetId !== p.id) { S.lastSetId = p.id; Store.setLast(p.id); }
}
async function flushSave() { if (!S.pristine) await saveNow(); }
function updateSavePill() {
  const el = $('#save-pill'); if (!el) return;
  const st = Store.state, mode = Store.mode();
  let s = st, txt;
  if (S.project && S.project.example && S.pristine) { s = 'idle'; txt = 'Example project. Your changes save automatically'; }
  else if (S.project && S.fresh && S.pristine && st !== 'error' && st !== 'off') { s = 'idle'; txt = mode === 'cloud' ? 'Saves to your account as soon as you change something' : mode === 'local' ? 'Saves in this browser as soon as you change something' : 'Not saved'; }
  else if (st === 'saving') txt = 'Saving…';
  else if (st === 'saved') txt = 'Saved to your account';
  else if (st === 'local') txt = mode === 'cloud' ? 'Saved' : 'Saved in this browser';
  else if (st === 'error') txt = 'Not saved yet, retrying on next change';
  else if (st === 'off') txt = 'Not saved: storage is blocked. Use Export › Project file';
  else txt = mode === 'cloud' ? 'Saves to your account' : mode === 'local' ? 'Saves in this browser' : 'Not saved';
  el.dataset.s = s; el.textContent = txt;
}

/* ---------- rendering ---------- */
function renderAll() {
  renderTop(); renderStage(); renderTabs(); renderProps(); renderCfg(); renderResults(); renderPlan(); updateUndo(); schedule3D();
}
function renderLight() {
  renderTop(); renderStage(); renderTabs(); renderResults(); renderPlan(); refreshReadouts(); syncPropsValues(); schedule3D();
}
function setVal(el, v) { if (el && document.activeElement !== el && el.value !== String(v)) el.value = v; }
function renderTop() {
  const p = S.project;
  setVal($('#pj-name'), p.name); setVal($('#pj-client'), p.client || ''); setVal($('#pj-rev'), p.revision || '');
  updateSavePill();
}

/* ----- stage layout ----- */
function stageSize() { const w = $('#stage-wrap'); return { w: w.clientWidth, h: w.clientHeight }; }
function fitStage() {
  const { w, h } = stageSize(); if (w < 20 || h < 20) return;
  const fs = 12;
  // keep clear of the metre labels along the top and left edges
  const f = fitStageView(S.project, S.comps, { x: fs * 2.4, y: fs * 1.5, w: w - fs * 2.4, h: h - fs * 1.5 }, fs, new SvgPen(), { pal: S.pal, labels: PF.labels, dims: PF.dims, minScale: 0.002, maxScale: 2, minRel: 0.8 });
  S.view.s = f.s; S.view.tx = f.tx; S.view.ty = f.ty;
  S.view.fitted = true; S.view.touched = false;
}
function renderStage() {
  // no screens: the start card shows, and the stage grows to fit it
  const none = S.project.screens.length === 0, empty = $('#stage-empty');
  if (empty) empty.hidden = !none;
  $('#stage-wrap').classList.toggle('is-empty', none);
  const svg = $('#stage-svg'); const { w, h } = stageSize(); if (w < 20 || h < 20) return;
  if (!S.view.fitted) fitStage();
  const pen = new SvgPen();
  drawStage(pen, { project: S.project, comps: S.comps, pal: S.pal, fs: 12, s: S.view.s, tx: S.view.tx, ty: S.view.ty, box: { x: 0, y: 0, w, h },
    grid: PF.grid, labels: PF.labels, dims: PF.dims, selection: S.selection, guides: S.guides, interactive: true });
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.innerHTML = pen.toString();
}
function zoomAt(factor, mx, my) {
  const v = S.view; const ns = clamp(v.s * factor, 0.002, 2); const f = ns / v.s;
  v.tx = mx - (mx - v.tx) * f; v.ty = my - (my - v.ty) * f; v.s = ns; v.touched = true; renderStage();
}

/* ----- tabs ----- */
function renderTabs() {
  const box = $('#screen-tabs'); const t = S.totals;
  const tabs = S.project.screens.map((s) => {
    const c = S.comps[s.id];
    return `<button class="tab" role="tab" aria-selected="${s.id === S.activeId}" data-tab="${esc(s.id)}"><span class="dot" style="background:${s.color}"></span>${esc(s.name)}<span class="meta">${c ? `${c.cols}×${c.rows}` : ''}</span></button>`;
  }).join('');
  const pl = S.plan;
  const total = t ? `<span class="desc" style="margin-left:auto">Project: <b>${t.screens}</b> screen${t.screens === 1 ? '' : 's'} · <b>${fmtInt(t.cabinets)}</b> cabinets · <b>${fmtNum(t.pixels / 1e6, 2)}</b> Mpx · <b>${t.ports}</b> data port${t.ports === 1 ? '' : 's'}${t.backupPorts ? ` + ${t.backupPorts} backup` : ''}${pl ? ` · <b>${pl.count} × ${esc(pl.model.name)}</b>` : ''}${t.wMax !== null ? ` · <b>${fmtW(t.wMax)}</b> max` : ''}${t.weight !== null ? ` · <b>${fmtKg(t.weight)}</b>` : ''}</span>` : '';
  box.innerHTML = `<span class="tabs-label">Screens</span>${tabs}${total}`;
}

/* ----- screen properties row ----- */
function renderProps() {
  const s = active(); const box = $('#screen-props');
  if (!s) { box.innerHTML = '<div class="empty">No screens yet. Use Add screen above.</div>'; return; }
  box.innerHTML = `
    <label class="fld fld-wide"><span>Screen name</span><input type="text" id="sp-name" value="${esc(s.name)}" data-bind="name" data-type="str" autocomplete="off"></label>
    <label class="fld"><span>Type</span><select id="sp-kind" data-bind="kind" data-type="str">${KIND_ORDER.map((k) => `<option value="${k}"${s.kind === k ? ' selected' : ''}>${KINDS[k].label}</option>`).join('')}</select></label>
    <div class="fld"><span>Colour</span><div class="swatches" style="display:grid;grid-template-columns:repeat(4,22px);gap:4px">${SCREEN_COLORS.map((c) => `<button class="sw" style="background:${c}" data-color="${c}" aria-pressed="${s.color === c}" aria-label="Use colour ${c}"></button>`).join('')}</div></div>
    <label class="fld"><span>Centre X</span><div class="unit-in"><input type="number" id="sp-x" step="50" value="${s.x}" data-bind="x" data-type="num"><i>mm</i></div></label>
    <label class="fld"><span>Bottom height</span><div class="unit-in"><input type="number" id="sp-y" step="50" min="0" value="${s.y}" data-bind="y" data-type="num"><i>mm</i></div></label>
    <label class="fld pro" title="Distance in front of the main screen line, toward the audience. Used by the 3D view."><span>Forward Z</span><div class="unit-in"><input type="number" id="sp-z" step="100" value="${s.z}" data-bind="z" data-type="num"><i>mm</i></div></label>
    <label class="fld pro" title="Turns the screen around its vertical centre line. Positive turns its face to the right as seen from the audience, so use + on a left-side screen and − on a right-side screen to angle them toward the centre."><span>Yaw (+ faces right)</span><div class="unit-in"><input type="number" id="sp-yaw" step="1" min="-180" max="180" value="${s.yaw}" data-bind="yaw" data-type="num"><i>°</i></div></label>
    <div class="prop-actions">
      <button class="btn icon" data-act="dup" title="Duplicate screen (Ctrl+D)" aria-label="Duplicate screen"><svg class="ico"><use href="#i-copy"/></svg></button>
      <button class="btn icon" data-act="mirror" title="Duplicate, mirrored across the centre line" aria-label="Duplicate mirrored"><svg class="ico"><use href="#i-mirror"/></svg></button>
      <button class="btn icon danger" data-act="delete" title="Delete screen (Del)" aria-label="Delete screen"><svg class="ico"><use href="#i-trash"/></svg></button>
    </div>`;
}
function syncPropsValues() {
  const s = active(); if (!s) return;
  setVal($('#sp-x'), s.x); setVal($('#sp-y'), s.y); setVal($('#sp-z'), s.z); setVal($('#sp-yaw'), s.yaw); setVal($('#sp-name'), s.name);
}

/* ----- configuration cards ----- */
function segBtn(v, label, cur, cls = '') { return `<button data-v="${v}" aria-pressed="${cur === v}"${cls ? ` class="${cls}"` : ''}>${label}</button>`; }
// your panels first, one group per brand; then panels only this project has; then the generic presets
function panelOptions(selected) {
  const proj = (S.project && S.project.catalog) || [];
  const opt = (p) => `<option value="${esc(p.id)}"${p.id === selected ? ' selected' : ''}>${esc((proj.find((c) => c.id === p.id) || p).name)}</option>`;
  const lib = Lib.all(), groups = new Map();
  for (const p of [...lib].sort(byBrandModel)) { const b = p.brand || ''; if (!groups.has(b)) groups.set(b, []); groups.get(b).push(p); }
  let html = [...groups].map(([b, list]) => `<optgroup label="${esc(b || 'Your panels')}">${list.map(opt).join('')}</optgroup>`).join('');
  const ids = new Set(lib.map((p) => p.id)), only = proj.filter((p) => !ids.has(p.id));
  if (only.length) html += `<optgroup label="This project only">${only.map(opt).join('')}</optgroup>`;
  return html + `<optgroup label="Generic presets">${BUILTIN_PANELS.map(opt).join('')}</optgroup>`;
}
const CORNER_NAMES = { bl: 'bottom left', br: 'bottom right', tl: 'top left', tr: 'top right' };
function cornerBtn(k, cur, dir) {
  const pos = { tl: [4, 4], tr: [14, 4], bl: [4, 14], br: [14, 14] }[k];
  const dx = k[1] === 'l' ? 1 : -1, dy = k[0] === 'b' ? -1 : 1;
  const end = dir === 'v' ? [pos[0], pos[1] + dy * 10] : [pos[0] + dx * 10, pos[1]];
  const head = dir === 'v'
    ? `M${end[0]} ${end[1]} L${end[0] - 2.6} ${end[1] - dy * 3.6} L${end[0] + 2.6} ${end[1] - dy * 3.6}Z`
    : `M${end[0]} ${end[1]} L${end[0] - dx * 3.6} ${end[1] - 2.6} L${end[0] - dx * 3.6} ${end[1] + 2.6}Z`;
  return `<button data-corner-v="${k}" aria-pressed="${cur === k}" title="Start ${CORNER_NAMES[k]}" aria-label="Start ${CORNER_NAMES[k]}"><svg viewBox="0 0 18 18"><circle cx="${pos[0]}" cy="${pos[1]}" r="2.3" fill="currentColor"/><path d="M${pos[0]} ${pos[1]} L${end[0]} ${end[1]}" stroke="currentColor" stroke-width="1.6"/><path d="${head}" fill="currentColor"/></svg></button>`;
}
function numField(id, label, bind, val, o = {}) {
  return `<label class="fld"><span>${label}</span><div class="unit-in"><input type="number" id="${id}" value="${val}" data-bind="${bind}" data-type="${o.type || 'num'}"${o.min !== undefined ? ` min="${o.min}"` : ''}${o.max !== undefined ? ` max="${o.max}"` : ''} step="${o.step || 1}"><i>${o.unit || ''}</i></div></label>`;
}
function sizeBody(s) {
  if (s.sizeMode === 'meters') {
    return `<div class="row2">${numField('cf-tw', 'Width', 'tw', s.tw, { min: 0.1, max: 200, step: 0.1, unit: 'm' })}${numField('cf-th', 'Height', 'th', s.th, { min: 0.1, max: 100, step: 0.1, unit: 'm' })}</div>
      <label class="fld"><span>Rounding</span><select id="cf-fit" data-bind="fit" data-type="str">
        <option value="nearest"${s.fit === 'nearest' ? ' selected' : ''}>Nearest whole cabinet</option>
        <option value="down"${s.fit === 'down' ? ' selected' : ''}>Fit inside the size (round down)</option>
        <option value="up"${s.fit === 'up' ? ' selected' : ''}>Cover the size (round up)</option></select></label>`;
  }
  if (s.sizeMode === 'mix') {
    return `<label class="fld"><span>Small panel (fills the rows above)</span><select id="cf-msmall" data-bind="mix.small" data-type="str">${panelOptions(s.mix.small)}</select></label>
      <label class="fld"><span>Large panel (used first, from the bottom)</span><select id="cf-mbig" data-bind="mix.big" data-type="str">${panelOptions(s.mix.big)}</select></label>
      <div class="row3">${numField('cf-mw', 'Width', 'mix.w', s.mix.w, { min: 0.1, max: 200, step: 0.1, unit: 'm' })}${numField('cf-mh', 'Height', 'mix.h', s.mix.h, { min: 0.1, max: 100, step: 0.1, unit: 'm' })}${numField('cf-mstock', 'Large in stock', 'mix.stock', s.mix.stock, { type: 'int', min: 0, max: 100000, step: 1 })}</div>`;
  }
  return `<div class="row2">${numField('cf-cols', 'Columns', 'cols', s.cols, { type: 'int', min: 1, max: 200, step: 1 })}${numField('cf-rows', 'Rows', 'rows', s.rows, { type: 'int', min: 1, max: 100, step: 1 })}</div>`;
}
function renderCfg() {
  const s = active(); const box = $('#cfg');
  if (!s) { box.innerHTML = ''; return; }
  const d = s.data;
  box.innerHTML = `
  <div class="card"><div class="card-head"><h3><span class="step">1</span>Panel</h3><div class="tools"><button class="btn sm" data-act="panels">Your panels</button><button class="btn sm" data-act="panel-new"><svg class="ico"><use href="#i-plus"/></svg>New panel</button></div></div>
    <div class="card-body">
      ${s.sizeMode === 'mix' ? '<div class="desc">Mixed mode uses the two panels chosen under Size.</div>' : `<select id="cf-panel" data-bind="panel" data-type="str" aria-label="Panel model">${panelOptions(s.panel)}</select>`}
      <div class="desc" data-ro="panel"></div>
    </div></div>
  <div class="card"><div class="card-head"><h3><span class="step">2</span>Shape</h3></div>
    <div class="card-body">
      <div class="seg full" data-seg="shape">${segBtn('flat', 'Flat', s.shape)}${segBtn('concave', 'Curved in', s.shape)}${segBtn('convex', 'Curved out', s.shape)}</div>
      ${s.shape !== 'flat' ? `${numField('cf-angle', 'Angle between columns', 'angle', s.angle, { min: 0.5, max: 45, step: 0.5, unit: '°' })}<div class="readout" data-ro="curve"></div>` : '<div class="desc" style="color:var(--ink-3)">Curved in wraps toward the audience, curved out wraps away (for pillars and cylinders).</div>'}
    </div></div>
  <div class="card"><div class="card-head"><h3><span class="step">3</span>Size</h3></div>
    <div class="card-body">
      <div class="seg full" data-seg="sizeMode">${segBtn('grid', 'Columns × rows', s.sizeMode)}${segBtn('meters', 'Metres', s.sizeMode)}${segBtn('mix', 'Mixed', s.sizeMode, 'pro')}</div>
      ${sizeBody(s)}
      <div class="readout" data-ro="size"></div>
      <div data-ro="sugg"></div>
      <div data-ro="holes"></div>
      <div data-ro="warn"></div>
    </div></div>
  <div class="card"><div class="card-head"><h3><span class="step">4</span>Signal and power</h3></div>
    <div class="card-body">
      <div class="sigrow">
        <span class="lbl">Input at</span>
        <div class="corner" data-corner>${['tl', 'tr', 'bl', 'br'].map((k) => cornerBtn(k, d.start, d.dir)).join('')}</div>
        <span class="lbl">Run along</span>
        <div class="seg" data-seg="data.dir">${segBtn('h', 'Rows', d.dir)}${segBtn('v', 'Columns', d.dir)}</div>
        <span class="lbl pro">Pattern</span>
        <div class="seg pro" data-seg="data.path">${segBtn('snake', 'Snake', d.path)}${segBtn('z', 'Z return', d.path)}</div>
        <span class="lbl pro">Per port</span>
        <div class="seg pro" data-seg="data.split">${segBtn('lines', d.dir === 'v' ? 'Whole columns' : 'Whole rows', d.split)}${segBtn('fill', 'Fill to capacity', d.split)}</div>
      </div>
      <div class="readout" data-ro="data"></div>
      <div class="readout pro" data-ro="power"></div>
    </div></div>
  <div class="card"><div class="card-head"><h3><span class="step">5</span>Mounting</h3></div>
    <div class="card-body">
      <div class="seg full" data-seg="mount">${MOUNT_ORDER.map((k) => segBtn(k, MOUNTS[k].label, s.mount)).join('')}</div>
      ${s.mount === 'ground' ? groundHtml(s) : ''}
      <div class="readout" data-ro="mount"></div>
    </div></div>`;
  refreshReadouts();
}
function ctrlSummary(pl) {
  const D = pl.model, outs = sum(pl.units, (u) => u.used);
  let t = `Controller for the whole project: <b>${pl.count} × NovaStar ${esc(D.name)}</b>${pl.auto ? ' (suggested)' : ''} · ${pl.count === 1 ? `${outs} of ${D.ports} outputs` : `${fmtInt(outs)} outputs on ${pl.count} units${pl.count <= 4 ? ` (${pl.units.map((u) => u.used).join(' + ')})` : ''}`} · ${fmtNum(pl.pixels / 1e6, 2)} M px${pl.count === 1 ? ` of ${fmtNum(D.capacity / 1e6, 2)} M` : ''}`;
  if (pl.warnings.length) t += pl.warnings.map((w) => `<div class="warnline"><svg class="ico"><use href="#i-warn"/></svg><span>${esc(w)}</span></div>`).join('');
  return t;
}
// ground stack: H-frames every N beams, optional posts between, frame height, and per-joint changes (RO.joints)
function groundHtml(s) {
  const g = s.gs || defaultGroundStack();
  return `<div class="row2">${numField('cf-gs-every', 'H-frame every', 'gs.every', g.every, { type: 'int', min: 1, max: 200, step: 1, unit: g.every === 1 ? 'beam' : 'beams' })}
      <label class="fld"><span>Frame height</span><div class="unit-in"><input type="number" id="cf-gs-height" data-bind="gs.height" data-type="numopt" min="0.3" max="30" step="0.1" value="${g.height ?? ''}" placeholder="auto"><i>m</i></div></label></div>
    <div class="row2">${numField('cf-gs-arms', 'Arms to the screen', 'gs.arms', g.arms ?? 1, { type: 'int', min: 0, max: 10, step: 1, unit: 'each' })}
      <div class="desc" style="align-self:end;padding-bottom:6px">per H-frame or post, spread evenly up the screen</div></div>
    <label class="chk"><input type="checkbox" data-gs="posts"${g.posts ? ' checked' : ''}> Posts between the H-frames</label>
    <div data-ro="joints"></div>`;
}
function deltaTxt(d) { if (Math.abs(d) < 0.5) return 'exact'; return `${d > 0 ? '+' : '−'}${fmtNum(Math.abs(d) / 1000, 3)} m`; }
function shortName(p) { return p.name.replace(/^Generic /, ''); }
const RO = {
  panel(s) {
    if (s.sizeMode === 'mix') return '';
    const p = getPanel(S.project, s.panel), lp = p.builtin ? null : Lib.find(p.id);
    let t = `<b>${fmtNum(p.w, 1)} × ${fmtNum(p.h, 1)} mm</b> · ${p.px} × ${p.py} px · pitch <b>${fmtPitch(p)} mm</b><br>${p.kg !== null ? fmtNum(p.kg, 1) + ' kg' : 'weight not set'} · ${p.wMax !== null ? fmtInt(p.wMax) + ' W max' : 'power not set'}${p.wAvg !== null ? ' · ' + fmtInt(p.wAvg) + ' W typical' : ''}`;
    if (p.builtin) return t + `<br><span class="mut">Generic preset with typical weight and power.</span> <button class="linkbtn" data-act="panel-copy">Save as your panel</button>`;
    const own = Lib.isOwn(p.id), site = Lib.isSite(p.id);
    const acts = [own || !lp ? '<button class="linkbtn" data-act="panel-edit">Edit</button>' : '', !lp ? '<button class="linkbtn" data-act="panel-keep">Add to your panels</button>' : ''].filter(Boolean);
    t += `<br><span class="mut">${own ? 'In your panels' : site ? `From ${esc(Lib.site.file)}` : 'Only in this project'}</span>${acts.length ? ' · ' + acts.join(' · ') : ''}`;
    if (lp && !samePanel(p, lp)) t += `<div class="warnline"><svg class="ico"><use href="#i-warn"/></svg><span>${own ? 'Your panels have' : `${esc(Lib.site.file)} has`} other values for this panel than this project. <button class="linkbtn" data-act="panel-update">Use the new values</button></span></div>`;
    const stock = lp ? lp.stock : p.stock;
    if (stock !== null && stock !== undefined) {
      const used = projectUse(p.id);
      t += used > stock
        ? `<div class="warnline"><svg class="ico"><use href="#i-warn"/></svg><span>This project needs ${fmtInt(used)} of this panel, ${fmtInt(used - stock)} more than the ${fmtInt(stock)} in stock.</span></div>`
        : `<br>Stock <b>${fmtInt(stock)}</b> · this project uses ${fmtInt(used)}`;
    }
    return t;
  },
  curve(s, c) {
    if (!c.curve) return ''; const k = c.curve;
    return `<b>${fmtNum(k.arc, 1)}°</b> in total${k.closed ? ' (full circle)' : ''} · radius <b>${fmtM(k.rIn, 2)} m</b> to the front · chord ${fmtM(k.chord, 2)} m · depth ${fmtM(k.depth, 2)} m<br><span style="color:var(--ink-3)">Calculated radius. Check that your curve brackets offer ${fmtNum(k.angle, 2)}°.</span>`;
  },
  size(s, c) {
    let t = `<b>${c.cols} × ${c.rows}</b> cabinets = <b>${fmtSize(c.W, c.H)}</b> · ${fmtRes(c.resW, c.resH)} px`;
    if ((s.sizeMode === 'meters' || s.sizeMode === 'mix') && c.info.target) { const d = c.info.target; t += `<br>Against ${fmtSize(d.w, d.h)}: ${deltaTxt(d.dw)} wide, ${deltaTxt(d.dh)} high`; }
    if (s.sizeMode === 'mix' && c.info.mix) { const m = c.info.mix; t += `<br>${m.bigUsed} large in ${m.bigRows} row${m.bigRows === 1 ? '' : 's'} at the bottom, ${m.smallUsed} small above${m.bigLeft ? ` · ${m.bigLeft} large left over` : ''}`; }
    return t;
  },
  sugg(s) {
    if (s.sizeMode !== 'grid') return '';
    const p = getPanel(S.project, s.panel); const list = suggest169(p, s.cols, s.rows);
    if (!list.length) return '';
    return `<details class="more" id="sugg-details"${S.suggOpen ? ' open' : ''}><summary>Sizes close to 16:9</summary><div class="chips">${list.map((x) => `<button class="chip" data-sugg="${x.cols}x${x.rows}"><b>${x.cols} × ${x.rows}</b><span>${fmtSize(x.w, x.h)} · ${fmtRes(x.resW, x.resH)} · ${Math.abs(x.dev) < 0.0005 ? 'exact 16:9' : (x.dev > 0 ? '+' : '−') + Math.abs(x.dev * 100).toFixed(1) + '%'}</span></button>`).join('')}</div></details>`;
  },
  holes(s, c) {
    return c.holes
      ? `<div class="desc">${c.holes} cabinet position${c.holes === 1 ? ' is' : 's are'} left empty. <button class="linkbtn" data-act="holes-clear">Fill all</button></div>`
      : '<div class="desc" style="color:var(--ink-3)">In the Cabinets plan, click a cabinet to leave its position empty.</div>';
  },
  warn(s, c) { return c.warnings.map((w) => `<div class="warnline"><svg class="ico"><use href="#i-warn"/></svg><span>${esc(w)}</span></div>`).join(''); },
  joints(s, c) {
    if (s.mount !== 'ground') return '';
    const L = groundLayout(s, c.cols), sym = { H: 'H', P: '|', '-': '·' }, what = { H: 'H-frame', P: 'post', '-': 'nothing' };
    const where = (j) => (j === 0 ? 'left end' : j === c.cols ? 'right end' : `between ${colLetter(j - 1)} and ${colLetter(j)}`);
    const custom = Object.keys((s.gs && s.gs.over) || {}).length;
    return `<div class="jt-row" role="group" aria-label="Joints from left to right">${L.map((v, j) => `<button class="jt" data-joint="${j}" data-v="${v}" title="Joint ${where(j)}: ${what[v]}" aria-label="Joint ${where(j)}: ${what[v]}">${sym[v]}</button>`).join('')}</div>
      <div class="desc">The joints between ground beams, left to right: H = H-frame, | = post, · = nothing. Tap one to change it.${custom ? ` <button class="linkbtn" data-act="gs-reset">Back to the pattern</button>` : ''}</div>`;
  },
  mount(s, c) {
    const k = c.support, m = k.mount;
    const along = { flown: 'along the flying bars', ground: 'along the base beams' }[m];
    const area = `front area ${fmtNum(k.frontArea, 2)} m²${c.curve ? ` (${fmtM(k.projW, 2)} m wide seen from the front)` : ''}`;
    let t = c.weight === null
      ? `Add a weight to the panel to see the loads · ${area}`
      : `<b>${{ flown: 'Hanging weight', ground: 'Weight on the base' }[m]} ${fmtKg(c.weight)}</b> · ${fmtInt(k.kgPerM)} kg per metre ${along} · heaviest column ${fmtKg(c.heaviestCol.kg)}${m === 'ground' ? ` (${k.tallest.cabinets} cabinet${k.tallest.cabinets === 1 ? '' : 's'} high)` : ''} · centre of gravity ${fmtM(k.cog, 2)} m above the floor · ${area}`;
    if (m === 'ground') {
      const L = groundLayout(s, c.cols), nH = L.filter((x) => x === 'H').length, nP = L.filter((x) => x === 'P').length;
      const na = groundArms(s);
      t += `<br>${c.cols} ground beam${c.cols === 1 ? '' : 's'} with adjustable feet · behind: ${nH} H-frame${nH === 1 ? '' : 's'}${nP ? ` and ${nP} post${nP === 1 ? '' : 's'}` : ''}, ${fmtNum(groundFrameHeight(s, c), 2)} m high, on floor rails · ${na ? `${na} arm${na === 1 ? '' : 's'} each to the screen (${fmtInt((nH + nP) * na)} in all)` : 'not clamped to the screen'}`;
    }
    t += `<br>Build order: ${buildOrderText(m)}.<br><span style="color:var(--ink-3)">Cabinets only: ${m === 'flown' ? 'flying bars, chains' : 'ground beams, H-frames'}, cables and wind add to these. Have the rigging or structure designed and checked by a qualified person.</span>`;
    return t;
  },
  data(s, c) {
    const st = S.project.settings; const busiest = c.ports.length ? Math.max(...c.ports.map((p) => p.load / p.cap)) : 0;
    return `<b>${c.ports.length} data port${c.ports.length === 1 ? '' : 's'}${st.backup ? ` + ${c.ports.length} backup` : ''}</b> at ${fmtInt(st.portCapacity)} px each · busiest ${Math.round(busiest * 100)}% · <button class="linkbtn" data-act="settings">Ports and controller</button>${S.plan ? `<br>${ctrlSummary(S.plan)}` : ''}`;
  },
  power(s, c) {
    const st = S.project.settings;
    if (!c.power) return 'Circuits need power values on the panel. Add your panel with its datasheet figures (New panel).';
    return `<b>${c.power.circuits.length} power circuit${c.power.circuits.length === 1 ? '' : 's'}</b> of ${fmtInt(st.circuitAmps)} A at ${fmtInt(st.voltage)} V, loaded to ${Math.round(st.loadFactor * 100)}% at power factor ${fmtNum(st.powerFactor, 2)} (${fmtInt(c.power.circuitW)} W each). Chains follow the data path.`;
  },
};
function refreshReadouts() {
  const s = active(); if (!s) return; const c = S.comps[s.id]; if (!c) return;
  $$('[data-ro]').forEach((el) => { const f = RO[el.dataset.ro]; if (f) el.innerHTML = f(s, c); });
}

/* ----- results ----- */
function tileHtml(k, v, sub, cls = '', subCls = '') { return `<div class="tile ${cls}"><div class="k">${k}</div><div class="v">${v}</div>${sub ? `<div class="s ${subCls}">${sub}</div>` : ''}</div>`; }
function renderResults() {
  const s = active(); const box = $('#results');
  if (!s || !S.comps[s.id]) { box.innerHTML = ''; return; }
  const c = S.comps[s.id], st = S.project.settings;
  const pitches = [...new Set(Object.values(c.byPanel).map((b) => pitchOf(b.panel)))];
  const minPitch = Math.min(...pitches);
  const busiest = c.ports.length ? Math.max(...c.ports.map((p) => p.load / p.cap)) : 0;
  const tiles = [
    tileHtml('Size', fmtSize(c.W, c.H), c.curve ? `chord ${fmtM(c.curve.chord, 2)} m, depth ${fmtM(c.curve.depth, 2)} m` : `${fmtNum(c.area, 2)} m² of LED`),
    tileHtml('Resolution', fmtRes(c.resW, c.resH), 'pixels, width × height'),
    tileHtml('Pixels', fmtInt(c.pixels), c.holes ? `${c.holes} empty position${c.holes === 1 ? '' : 's'}` : 'all positions filled'),
    tileHtml('Cabinets', fmtInt(c.count), Object.values(c.byPanel).map((b) => `${b.count} × ${esc(shortName(b.panel))}`).join(' + ')),
    tileHtml('Aspect', c.ratio.text, fmtDelta(c.ratio.delta), '', Math.abs(c.ratio.delta) < 0.015 ? 'good' : ''),
    tileHtml('Pixel pitch', `${pitches.map((x) => (Math.round(x * 1000) / 1000).toFixed(3)).join(' / ')} mm`, `min. viewing ≈ ${fmtNum(minPitch, 1)} m (1 m per mm rule of thumb)`),
    tileHtml('Data ports', st.backup ? `${c.ports.length} + ${c.ports.length}` : String(c.ports.length), `${st.backup ? 'main + backup · ' : ''}${fmtInt(st.portCapacity)} px each · busiest ${Math.round(busiest * 100)}%`),
    tileHtml('Power', c.wMax !== null ? fmtW(c.wMax) : '—', c.wMax !== null ? `max · ${fmtNum(c.wMax / (st.voltage * st.powerFactor), 1)} A at ${fmtInt(st.voltage)} V, PF ${fmtNum(st.powerFactor, 2)}` : 'no panel data'),
  ];
  if (PF.mode === 'pro') tiles.push(
    tileHtml('Circuits', c.power ? String(c.power.circuits.length) : '—', c.power ? `${fmtInt(st.circuitAmps)} A at ${Math.round(st.loadFactor * 100)}% load` : 'no panel data'),
    tileHtml('Weight', c.weight !== null ? fmtKg(c.weight) : '—', c.weight !== null ? `${fmtNum(c.weight / Math.max(0.01, c.area), 1)} kg/m² · heaviest column ${fmtKg(c.heaviestCol.kg)}` : 'no panel data'));
  box.innerHTML = `<div class="card-head"><h2>Results</h2><span class="results-head-meta">${esc(s.name)}${c.curve ? ` · curved ${c.curve.shape === 'concave' ? 'in' : 'out'}` : ''}</span></div><div class="tiles n${tiles.length}">${tiles.join('')}</div>`;
}

/* ----- plan ----- */
function legendHtml(mode, s, c) {
  const st = S.project.settings;
  if (mode === 'data') {
    const d = s.data;
    return `<div class="sum"><b>${c.ports.length} data port${c.ports.length === 1 ? '' : 's'}</b> · ${d.path === 'z' ? 'Z return' : 'snake'} along ${d.dir === 'v' ? 'columns' : 'rows'} from the ${CORNER_NAMES[d.start]} · ${fmtInt(st.portCapacity)} px per port${st.backup ? ' · <b>BK</b> marks where each backup cable leaves the last cabinet' : ''}</div>
      <div class="lg-grid${st.backup ? ' wide' : ''}">${c.ports.map((p) => { const pct = p.load / p.cap; const f = p.cells[0], l = p.cells[p.cells.length - 1]; return `<div class="lg"><span class="dot" style="background:${p.color}"></span><span class="name">${esc(p.label)}</span><span class="bar"><i style="width:${Math.min(100, pct * 100).toFixed(1)}%;background:${p.color}"></i></span><span class="val">${p.count} cab · in ${colLetter(f.c)}${f.r + 1}${st.backup ? ` · BK ${colLetter(l.c)}${l.r + 1}` : ''} · ${Math.round(pct * 100)}%</span></div>`; }).join('')}</div>`;
  }
  if (mode === 'power') {
    if (!c.power) return '<div class="sum">Power circuits need weight and power values on the panel. Use <b>New panel</b> to enter your datasheet figures.</div>';
    return `<div class="sum"><b>${c.power.circuits.length} circuit${c.power.circuits.length === 1 ? '' : 's'}</b> of ${fmtInt(st.circuitAmps)} A at ${fmtInt(st.voltage)} V · ${fmtInt(c.power.circuitW)} W each at ${Math.round(st.loadFactor * 100)}% load and PF ${fmtNum(st.powerFactor, 2)} · sized on ${st.powerBasis === 'avg' ? 'typical' : 'maximum'} power</div>
      <div class="lg-grid">${c.power.circuits.map((k) => { const pct = k.load / k.cap; return `<div class="lg"><span class="dot" style="background:${k.color}"></span><span class="name">${k.label}</span><span class="bar"><i style="width:${Math.min(100, pct * 100).toFixed(1)}%;background:${k.color}"></i></span><span class="val">${k.count} cab · ${fmtInt(k.load)} W · ${fmtNum(k.amps, 1)} A</span></div>`; }).join('')}</div>`;
  }
  return `<div class="sum">Numbers give the build order for a ${MOUNTS[s.mount].label.toLowerCase()} screen: ${buildOrderText(s.mount)}. <b>Click a cabinet</b> to leave its position empty; click again to fill it.</div>
    <div class="lg-grid">${Object.values(c.byPanel).map((b) => `<div class="lg"><span class="dot" style="background:${s.color}"></span><span class="name">${b.count}×</span><span class="val" style="grid-column:span 2;white-space:normal;font-family:var(--font-ui);font-size:12.5px">${esc(b.panel.name)} · ${fmtNum(b.panel.w, 1)} × ${fmtNum(b.panel.h, 1)} mm</span></div>`).join('')}</div>`;
}
function planPx(c, w, fs, dims, labels) {
  const mh = fs * (dims ? 7.6 : 2.2) + (labels ? fs * 1.8 : 0);
  const mw = fs * (dims ? 7.4 : 1.4) + (labels ? fs * 2.2 : 0);
  return (w - mw) * c.H / c.W + mh + fs;
}
function renderPlan() {
  const s = active(); const wrap = $('#plan-wrap'), svg = $('#plan-svg'), lg = $('#plan-legend');
  if (!s || !S.comps[s.id]) { svg.innerHTML = ''; lg.innerHTML = '<div class="sum">Add a screen to see its plan.</div>'; return; }
  const c = S.comps[s.id]; const mode = planMode();
  $$('#plan-seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.plan === mode)));
  const w = Math.max(240, wrap.clientWidth);
  const fs = clamp(w / 64, 10, 13.5);
  const h = clamp(planPx(c, w, fs, PF.planDims, PF.planLabels), 220, Math.max(340, window.innerHeight * 0.7));
  wrap.style.height = `${Math.round(h)}px`;
  const pen = new SvgPen();
  pen.rect(0, 0, w, h, { fill: S.pal.bg });
  drawPlan(pen, c, { x: fs * 0.5, y: fs * 0.5, w: w - fs, h: h - fs }, { mode, dims: PF.planDims, labels: PF.planLabels, pal: S.pal, fs, screenColor: s.color, prefix: S.project.settings.portPrefix, backup: S.project.settings.backup, interactive: mode === 'cabinets', minText: 7.5 });
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.innerHTML = pen.toString();
  $('#plan-title').textContent = { cabinets: 'Plan · cabinets', data: 'Plan · data cabling', power: 'Plan · power' }[mode];
  lg.innerHTML = legendHtml(mode, s, c);
}

/* ----- 3D ----- */
let t3 = 0;
function schedule3D(delay = 70) {
  clearTimeout(t3);
  t3 = setTimeout(() => { if (View3D.isReady()) View3D.sync(S.project, S.comps, { face: faceMode(), person: PF.person, dark: S.dark }); }, delay);
}

/* ---------- screens: add / duplicate / delete / align ---------- */
function setActive(id, select = true) {
  if (!findScreen(id)) return;
  S.activeId = id; if (select) S.selection = new Set([id]);
  renderTabs(); renderProps(); renderCfg(); renderResults(); renderPlan(); renderStage();
}
// where a new screen goes, by its type: a DJ booth front 2 m forward on the floor, a banner above the
// first screen, a side screen beside the others with its top level with the first screen's top
function placeByKind(p, s, comp, kind) {
  const first = p.screens.find((x) => x.id !== s.id), fc = first ? (S.comps[first.id] || computeScreen(p, first)) : null;
  if (kind === 'dj') { s.x = 0; s.y = 0; s.z = 2000; }
  else if (kind === 'banner' && first) { s.x = first.x; s.y = Math.round((first.y + fc.H + 300) / 50) * 50; }
  else { placeNewScreen(p, s, comp); if (kind === 'side' && first) s.y = Math.max(0, Math.round((first.y + fc.H - comp.H) / 50) * 50); if (kind === 'main' && !first) s.y = 1000; }
}
function addScreen(kind) {
  const k = KINDS[kind] || KINDS.free;
  const s = defaultScreen(kind);
  s.color = nextColor(S.project);
  s.name = uniqueName(S.project, kind === 'main' ? 'Main screen' : k.label);
  const comp = computeScreen(S.project, s);
  change((p) => {
    p.screens.push(s); placeByKind(p, s, comp, kind);
    S.activeId = s.id; S.selection = new Set([s.id]);
  }, { structural: true });
  S.view.fitted = false; renderStage();
  toast(`Added ${s.name}`, { label: 'Undo', run: undo });
}

/* ---------- a screen of your own size: the start card, and Add screen › Your own size ----------
   The panel (your panels included), width × height in metres (nearest whole cabinets) or in cabinets,
   and the mounting. The last choices are remembered for the next project. */
// the project, plus a panel from your panels that it has no copy of yet (for working out a size first)
function projectWith(id) {
  const lp = Lib.find(id);
  return lp && !findPanel(S.project, id) ? Object.assign({}, S.project, { catalog: [...S.project.catalog, lp] }) : S.project;
}
function sizeFormHtml(kinds) {
  return `<div class="sf">
    ${kinds ? `<label class="fld"><span>Type</span><select data-sf="kind">${KIND_ORDER.map((k) => `<option value="${k}">${KINDS[k].label}</option>`).join('')}</select></label>` : ''}
    <label class="fld"><span>Panel</span><select data-sf="panel"></select></label>
    <div class="sf-links"><button type="button" class="linkbtn" data-sf-act="new">New panel</button><button type="button" class="linkbtn" data-sf-act="lib">Your panels</button></div>
    <div class="seg full" data-sf="unit" role="group" aria-label="Enter the size in"><button type="button" data-v="m">Metres</button><button type="button" data-v="cab">Cabinets</button></div>
    <div class="row2">
      <label class="fld"><span data-sf="wl">Width</span><div class="unit-in"><input type="number" data-sf="w" min="0" step="any"><i data-sf="wu">m</i></div></label>
      <label class="fld"><span data-sf="hl">Height</span><div class="unit-in"><input type="number" data-sf="h" min="0" step="any"><i data-sf="hu">m</i></div></label>
    </div>
    <label class="fld"><span>Mounting</span><select data-sf="mount">${MOUNT_ORDER.map((k) => `<option value="${k}">${MOUNTS[k].label}</option>`).join('')}</select></label>
    <div class="readout" data-sf="out" aria-live="polite"></div>
  </div>`;
}
function bindSizeForm(root, { kinds = false } = {}) {
  const q = (k) => root.querySelector(`[data-sf="${k}"]`);
  const saved = PF.sf || {};
  const known = (id) => !!(id && (Lib.find(id) || findPanel(S.project, id)));
  const st = {
    kind: 'main', panel: known(saved.panel) ? saved.panel : 'g50100-39', unit: saved.unit === 'cab' ? 'cab' : 'm',
    w: saved.w > 0 ? saved.w : 8, h: saved.h > 0 ? saved.h : 4, cols: saved.cols > 0 ? saved.cols : 16, rows: saved.rows > 0 ? saved.rows : 4,
    mount: MOUNTS[saved.mount] ? saved.mount : 'flown',
  };
  const fillPanels = () => { if (!known(st.panel)) st.panel = 'g50100-39'; const sel = q('panel'); sel.innerHTML = panelOptions(st.panel); sel.value = st.panel; };
  const screen = () => {
    const s = defaultScreen(st.kind); s.panel = st.panel; s.mount = st.mount;
    if (st.unit === 'm') { s.sizeMode = 'meters'; s.tw = st.w; s.th = st.h; s.fit = 'nearest'; } else { s.sizeMode = 'grid'; s.cols = st.cols; s.rows = st.rows; }
    return s;
  };
  const read = () => {
    const w = parseFloat(String(q('w').value).replace(',', '.')), h = parseFloat(String(q('h').value).replace(',', '.'));
    if (st.unit === 'm') { if (w > 0) st.w = clamp(w, 0.1, 200); if (h > 0) st.h = clamp(h, 0.1, 100); }
    else { if (w >= 1) st.cols = clamp(Math.round(w), 1, 200); if (h >= 1) st.rows = clamp(Math.round(h), 1, 100); }
    return st.unit === 'm' ? w > 0 && h > 0 : w >= 1 && h >= 1;
  };
  const show = () => {
    const m = st.unit === 'm';
    q('wl').textContent = m ? 'Width' : 'Columns'; q('hl').textContent = m ? 'Height' : 'Rows';
    q('wu').textContent = m ? 'm' : ''; q('hu').textContent = m ? 'm' : '';
    for (const [k, v] of [['w', m ? st.w : st.cols], ['h', m ? st.h : st.rows]]) { const el = q(k); el.step = m ? 'any' : '1'; el.inputMode = m ? 'decimal' : 'numeric'; if (document.activeElement !== el) el.value = String(Math.round(v * 1000) / 1000); }
    root.querySelectorAll('[data-sf="unit"] button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === st.unit)));
    q('mount').value = st.mount; if (kinds) q('kind').value = st.kind;
  };
  const preview = () => {
    const out = q('out');
    if (!read()) { out.innerHTML = st.unit === 'm' ? 'Enter the width and height in metres.' : 'Enter the number of columns and rows.'; return null; }
    const c = computeScreen(projectWith(st.panel), screen()), lp = Lib.find(st.panel);
    const nb = (x) => x.replace(/ /g, '\u00a0');   // keep "20.5 kW max" on one line
    let t = `<b>${c.cols} × ${c.rows}</b> cabinets = <b>${fmtSize(c.W, c.H)}</b><br>${nb(fmtRes(c.resW, c.resH) + ' px')} · ${nb(fmtInt(c.count) + ' cabinets')}${c.weight !== null ? ` · ${nb(fmtKg(c.weight))}` : ''}${c.wMax !== null ? ` · ${nb(fmtW(c.wMax) + ' max')}` : ''}`;
    if (st.unit === 'm' && (Math.abs(c.W - st.w * 1000) > 0.5 || Math.abs(c.H - st.h * 1000) > 0.5)) t += `<br><span class="mut">Nearest whole cabinets to ${fmtSize(st.w * 1000, st.h * 1000)}</span>`;
    if (lp && lp.stock !== null && c.count > lp.stock) t += `<div class="warnline"><svg class="ico"><use href="#i-warn"/></svg><span>That is ${fmtInt(c.count - lp.stock)} more than the ${fmtInt(lp.stock)} in stock.</span></div>`;
    out.innerHTML = t;
    return c;
  };
  root.addEventListener('input', (e) => { if (e.target.matches('[data-sf="w"], [data-sf="h"]')) preview(); });
  root.addEventListener('change', (e) => {
    const k = e.target.dataset && e.target.dataset.sf;
    if (k === 'panel') st.panel = e.target.value;
    if (k === 'mount') st.mount = e.target.value;
    if (k === 'kind') { st.kind = e.target.value; st.mount = (KINDS[st.kind] || KINDS.free).mount || 'ground'; }
    if (k === 'w' || k === 'h') read();
    show(); preview();
  });
  root.addEventListener('click', (e) => {
    const u = e.target.closest('[data-sf="unit"] button');
    if (u && u.dataset.v !== st.unit) {
      const c = preview();
      if (c) { if (u.dataset.v === 'cab') { st.cols = c.cols; st.rows = c.rows; } else { st.w = Math.round(c.W) / 1000; st.h = Math.round(c.H) / 1000; } }
      st.unit = u.dataset.v; show(); preview(); return;
    }
    const a = e.target.closest('[data-sf-act]'); if (!a) return;
    if (a.dataset.sfAct === 'new') panelModal({ onSaved: (np) => { if (np) { st.panel = np.id; fillPanels(); preview(); } } });
    if (a.dataset.sfAct === 'lib') panelsModal();
  });
  const off = Lib.on(() => { fillPanels(); preview(); });
  fillPanels(); show(); preview();
  return {
    values() { if (!preview()) { toast(st.unit === 'm' ? 'Enter the width and height in metres.' : 'Enter the number of columns and rows.'); return null; } return Object.assign({}, st); },
    refresh() { fillPanels(); preview(); }, off,
  };
}
function addSizedScreen(v) {
  const kind = v.kind || 'main';
  const s = defaultScreen(kind);
  s.panel = v.panel; s.mount = v.mount;
  if (v.unit === 'm') { s.sizeMode = 'meters'; s.tw = v.w; s.th = v.h; s.fit = 'nearest'; } else { s.sizeMode = 'grid'; s.cols = v.cols; s.rows = v.rows; }
  s.color = nextColor(S.project);
  s.name = uniqueName(S.project, kind === 'main' ? 'Main screen' : (KINDS[kind] || KINDS.free).label);
  const comp = computeScreen(projectWith(v.panel), s);
  const first = S.project.screens[0];
  change((p) => {
    p.screens.push(s); placeByKind(p, s, comp, kind);
    // a ground stack stands on the floor; a flown screen hangs level with the first flown screen, or 1 m up
    if (s.mount === 'ground') s.y = 0;
    else if (s.y === 0 && kind !== 'dj') s.y = first && first.mount === 'flown' ? first.y : 1000;
    S.activeId = s.id; S.selection = new Set([s.id]);
  }, { structural: true });
  PF.sf = { panel: v.panel, unit: v.unit, w: v.w, h: v.h, cols: v.cols, rows: v.rows, mount: v.mount }; Prefs.save();
  S.view.fitted = false; renderStage();
  toast(`Added ${s.name}`, { label: 'Undo', run: undo });
}
function sizeModal() {
  const m = openModal({ title: 'Add a screen', body: `<form class="sf-form" novalidate>${sizeFormHtml(true)}<button type="submit" hidden></button></form>`, foot: [
    { label: 'Cancel', run: (close) => close() },
    { label: 'Add screen', cls: 'primary', run: (close) => { const v = form.values(); if (v) { close(); addSizedScreen(v); } } },
  ], onClose: () => form.off() });
  const form = bindSizeForm(m.body, { kinds: true });
  $('form', m.body).addEventListener('submit', (e) => { e.preventDefault(); const v = form.values(); if (v) { m.close(); addSizedScreen(v); } });
}
function mirrorName(n) {
  const sw = (m) => ({ left: 'right', right: 'left', Left: 'Right', Right: 'Left', LEFT: 'RIGHT', RIGHT: 'LEFT' }[m] || m);
  return /left|right/i.test(n) ? n.replace(/left|right/gi, sw) : null;
}
function duplicateScreen(id, mirrored = false) {
  const src = findScreen(id); if (!src) return;
  const s = deepClone(src); s.id = uid('s-');
  const comp = S.comps[src.id];
  if (mirrored) {
    s.name = uniqueName(S.project, mirrorName(src.name) || `${src.name} mirrored`);
    s.x = src.x === 0 ? Math.round((comp.W + 1000) / 50) * 50 : -src.x; s.yaw = -src.yaw;
    s.data = Object.assign({}, src.data, { start: src.data.start[0] + (src.data.start[1] === 'l' ? 'r' : 'l') });
    s.holes = src.holes.map((k) => { const [c, r] = k.split(',').map(Number); return `${comp.cols - 1 - c},${r}`; });
  } else {
    s.name = uniqueName(S.project, `${src.name} copy`);
  }
  s.color = nextColor(S.project);
  change((p) => { p.screens.push(s); if (!mirrored) placeNewScreen(p, s, comp); S.activeId = s.id; S.selection = new Set([s.id]); }, { structural: true });
  S.view.fitted = false; renderStage();
  toast(`Added ${s.name}`, { label: 'Undo', run: undo });
}
function deleteScreens(ids) {
  const list = ids.map(findScreen).filter(Boolean);
  if (!list.length) return;
  const names = list.length === 1 ? list[0].name : `${list.length} screens`;
  change((p) => {
    p.screens = p.screens.filter((s) => !ids.includes(s.id));
    if (!p.screens.some((s) => s.id === S.activeId)) S.activeId = p.screens[0] ? p.screens[0].id : null;
    S.selection = new Set(S.activeId ? [S.activeId] : []);
  }, { structural: true });
  toast(`Deleted ${names}`, { label: 'Undo', run: undo });
}
function alignScreens(kind) {
  const ids = S.selection.size >= 2 ? [...S.selection] : S.project.screens.map((s) => s.id);
  const list = ids.map(findScreen).filter(Boolean);
  if (list.length < (kind === 'center' ? 1 : 2)) { toast('Add a second screen first.'); return; }
  const W = (s) => S.comps[s.id].W, H = (s) => S.comps[s.id].H;
  const anchor = list.find((s) => s.id === S.activeId) || list[0];
  change(() => {
    if (kind === 'top') { const top = anchor.y + H(anchor); list.forEach((s) => { s.y = Math.max(0, Math.round(top - H(s))); }); }
    if (kind === 'bottom') list.forEach((s) => { s.y = anchor.y; });
    if (kind === 'dist') {
      const sorted = [...list].sort((a, b) => a.x - b.x);
      const left = sorted[0].x - W(sorted[0]) / 2, right = sorted[sorted.length - 1].x + W(sorted[sorted.length - 1]) / 2;
      const gap = (right - left - sum(sorted, W)) / Math.max(1, sorted.length - 1);
      let x = left; sorted.forEach((s) => { s.x = Math.round(x + W(s) / 2); x += W(s) + gap; });
    }
    if (kind === 'center') {
      const x0 = Math.min(...list.map((s) => s.x - W(s) / 2)), x1 = Math.max(...list.map((s) => s.x + W(s) / 2));
      const off = -(x0 + x1) / 2; list.forEach((s) => { s.x = Math.round(s.x + off); });
    }
  });
  toast({ top: 'Aligned tops', bottom: 'Aligned bottoms', dist: 'Spaced evenly', center: 'Centred on the centre line' }[kind] + (S.selection.size >= 2 ? '' : ' (all screens)'), { label: 'Undo', run: undo });
}
function moveSelection(drag, dx, dy, free) {
  const prim = findScreen(drag.id); const o = drag.orig.get(drag.id); if (!prim || !o) return;
  const comp = S.comps[prim.id]; const step = S.project.settings.snap || 50;
  let nx = o.x + dx, ny = o.y + dy; S.guides = [];
  if (!free) {
    nx = Math.round(nx / step) * step; ny = Math.round(ny / step) * step;
    const thr = 8 / S.view.s;
    const consider = (mine, theirs, best) => { for (const m of mine) for (const t of theirs) { const d = t - m; if (Math.abs(d) < thr && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: t }; } return best; };
    let bx = null, by = null;
    const mx = [nx - comp.W / 2, nx, nx + comp.W / 2], my = [ny, ny + comp.H / 2, ny + comp.H];
    for (const other of S.project.screens) {
      if (drag.orig.has(other.id)) continue; const oc = S.comps[other.id]; if (!oc) continue;
      bx = consider(mx, [other.x - oc.W / 2, other.x, other.x + oc.W / 2], bx);
      by = consider(my, [other.y, other.y + oc.H / 2, other.y + oc.H], by);
    }
    bx = consider(mx, [0], bx); by = consider([ny], [0], by);
    if (bx) { nx += bx.d; S.guides.push({ x: bx.at }); }
    if (by) { ny += by.d; S.guides.push({ y: by.at }); }
  }
  ny = Math.max(0, ny);
  const ddx = nx - o.x, ddy = ny - o.y;
  for (const [id, oo] of drag.orig) { const sc = findScreen(id); if (!sc) continue; sc.x = Math.round(oo.x + ddx); sc.y = Math.max(0, Math.round(oo.y + ddy)); }
  renderStage(); syncPropsValues(); schedule3D(40);
}
function nudge(dx, dy) {
  if (!S.selection.size) return;
  change(() => { for (const id of S.selection) { const s = findScreen(id); if (s) { s.x += dx; s.y = Math.max(0, s.y + dy); } } }, { key: 'nudge' });
}

function switchSizeMode(s, mode) {
  const c = S.comps[s.id];
  change(() => {
    const from = s.sizeMode;
    if (from === 'mix' && mode !== 'mix') {
      // continue with the large panel, sized to the same overall height
      s.panel = s.mix.big;
    }
    const p = getPanel(S.project, s.panel);
    if (mode === 'grid') { s.cols = clamp(Math.round(c.W / p.w), 1, 200); s.rows = clamp(Math.round(c.H / p.h), 1, 100); }
    if (mode === 'meters') { s.tw = Math.round(c.W) / 1000; s.th = Math.round(c.H) / 1000; s.fit = 'nearest'; }
    if (mode === 'mix') {
      s.mix.w = Math.round(c.W) / 1000; s.mix.h = Math.round(c.H) / 1000;
      const m5 = /^g5050-(\d+)$/.exec(s.panel), m10 = /^g50100-(\d+)$/.exec(s.panel);
      if (m5 && findPanel(S.project, 'g50100-' + m5[1])) { s.mix.small = s.panel; s.mix.big = 'g50100-' + m5[1]; }
      if (m10 && findPanel(S.project, 'g5050-' + m10[1])) { s.mix.big = s.panel; s.mix.small = 'g5050-' + m10[1]; }
    }
    s.sizeMode = mode;
  }, { structural: true });
}

/* ---------- binding ---------- */
function getPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj); }
function setPath(obj, path, val) { const ks = path.split('.'); let o = obj; for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]] = o[ks[i]] || {}; o[ks[ks.length - 1]] = val; }
function parseField(el, final) {
  const t = el.dataset.type || 'str';
  if (t === 'str') return el.value;
  if (t === 'numopt' && String(el.value).trim() === '') return null;   // empty = automatic
  const v = parseFloat(String(el.value).replace(',', '.'));
  if (!Number.isFinite(v)) return undefined;
  let out = t === 'int' ? Math.round(v) : v;
  if (final || t === 'int') { if (el.min !== '' && out < +el.min) out = +el.min; if (el.max !== '' && out > +el.max) out = +el.max; }
  return out;
}
function bindFieldEvents(container) {
  container.addEventListener('input', (e) => {
    const el = e.target; const k = el.dataset && el.dataset.bind; if (!k || el.tagName === 'SELECT') return;
    const v = parseField(el, false); if (v === undefined) return;
    if (k === 'name' && !String(v).trim()) return;
    const s = active(); if (!s) return;
    change(() => setPath(s, k, v), { key: `f:${s.id}:${k}` });
  });
  container.addEventListener('change', (e) => {
    const el = e.target; const k = el.dataset && el.dataset.bind; if (!k) return;
    const s = active(); if (!s) return;
    let v = parseField(el, true);
    if (v === undefined || (k === 'name' && !String(v).trim())) { renderProps(); renderCfg(); return; }
    change(() => setPath(s, k, v), { key: `f:${s.id}:${k}`, structural: el.tagName === 'SELECT' });
    if (el.tagName !== 'SELECT' && el.type === 'number' && String(el.value) !== String(v)) el.value = v;
  });
}

function bindStage() {
  const wrap = $('#stage-wrap'), svg = $('#stage-svg');
  const pts = new Map(); let drag = null, pan = null, pinch = null;
  const local = (e) => { const r = svg.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  svg.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try { svg.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    const p = local(e); pts.set(e.pointerId, p);
    if (pts.size === 2) {
      if (drag && drag.moved) { S.guides = []; change(() => {}); }
      drag = null; pan = null; wrap.classList.remove('panning');
      const [a, b] = [...pts.values()];
      pinch = { d: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, s0: S.view.s, tx0: S.view.tx, ty0: S.view.ty };
      return;
    }
    const hit = e.target.closest && e.target.closest('[data-sid]');
    if (hit) {
      const id = hit.getAttribute('data-sid');
      if (e.shiftKey) { if (S.selection.has(id)) S.selection.delete(id); else S.selection.add(id); }
      else if (!S.selection.has(id)) S.selection = new Set([id]);
      if (S.selection.has(id) && id !== S.activeId) setActive(id, false);
      const orig = new Map(); for (const sid of S.selection) { const sc = findScreen(sid); if (sc) orig.set(sid, { x: sc.x, y: sc.y }); }
      drag = { id, x0: p.x, y0: p.y, orig, moved: false, shift: e.shiftKey };
      renderStage(); renderTabs();
    } else {
      pan = { x0: p.x, y0: p.y, tx0: S.view.tx, ty0: S.view.ty, moved: false };
      wrap.classList.add('panning');
    }
  });
  svg.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    const p = local(e); pts.set(e.pointerId, p);
    if (pinch && pts.size >= 2) {
      const [a, b] = [...pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      const ns = clamp(pinch.s0 * d / pinch.d, 0.002, 2); const f = ns / pinch.s0;
      S.view.s = ns; S.view.tx = cx - (pinch.cx - pinch.tx0) * f; S.view.ty = cy - (pinch.cy - pinch.ty0) * f; S.view.touched = true; renderStage(); return;
    }
    if (drag) {
      const dxp = p.x - drag.x0, dyp = p.y - drag.y0;
      if (!drag.moved && Math.hypot(dxp, dyp) < 3) return;
      drag.moved = true;
      moveSelection(drag, dxp / S.view.s, -dyp / S.view.s, e.altKey);
      return;
    }
    if (pan) {
      const dx = p.x - pan.x0, dy = p.y - pan.y0;
      if (!pan.moved && Math.hypot(dx, dy) < 3) return;
      pan.moved = true; S.view.tx = pan.tx0 + dx; S.view.ty = pan.ty0 + dy; S.view.touched = true; renderStage();
    }
  });
  const end = (e) => {
    pts.delete(e.pointerId);
    if (pinch) { if (pts.size < 2) pinch = null; return; }
    if (drag) {
      if (drag.moved) { S.guides = []; change(() => {}); }
      else if (!drag.shift) { S.selection = new Set([drag.id]); renderStage(); }
      drag = null;
    }
    if (pan) { if (!pan.moved) { S.selection = new Set(); renderStage(); } pan = null; wrap.classList.remove('panning'); }
  };
  svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
  svg.addEventListener('wheel', (e) => { e.preventDefault(); const p = local(e); zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)), p.x, p.y); }, { passive: false });
  svg.addEventListener('dblclick', (e) => { const hit = e.target.closest && e.target.closest('[data-sid]'); if (hit) { const el = $('#sp-name'); if (el) { el.focus(); el.select(); } } });
  let rt = 0; new ResizeObserver(() => { cancelAnimationFrame(rt); rt = requestAnimationFrame(() => { if (!S.view.touched) S.view.fitted = false; renderStage(); }); }).observe(wrap);
}

function closeMenus(except) { $$('.menu').forEach((m) => { if (m !== except) { m.hidden = true; const b = m.parentElement.querySelector('[aria-haspopup]'); if (b) b.setAttribute('aria-expanded', 'false'); } }); }
function toggleMenu(btn, menu) {
  const open = menu.hidden; closeMenus(menu); menu.hidden = !open; btn.setAttribute('aria-expanded', String(open));
  if (open) { const f = menu.querySelector('button:not(:disabled)'); if (f) f.focus(); }
}
function renderAddMenu() {
  $('#add-menu').innerHTML = KIND_ORDER.map((k) => {
    const d = KINDS[k], p = getPanel(S.project, d.panel);
    return `<button data-kind="${k}"><b>${d.label}</b><span>${d.cols} × ${d.rows} of ${esc(shortName(p))} · ${fmtSize(d.cols * p.w, d.rows * p.h)}${d.shape ? ' · curved' : ''}</span></button>`;
  }).join('') + '<button data-custom><b>Your own size…</b><span>Any panel, including yours, at the width and height you need</span></button>';
}
function renderExportMenu() {
  const ok = Downloads.available(); const s = active(); const c = s ? S.comps[s.id] : null;
  const items = [
    ['pdf', 'PDF report', 'Layout, 3D view, elevations, data cabling and power for every screen'],
    ['layout', 'Layout drawing (PNG)', 'The stage layout as an image'],
    ['plan', 'Plan drawing (PNG)', s ? `${s.name}, current plan view` : 'Current screen'],
    ['pixmap', 'Pixel map (PNG)', c ? `${s.name} at native ${c.resW} × ${c.resH} px, as test content` : 'Current screen at native resolution'],
    ['packing', 'Packing list (spreadsheet)', 'Cabinets, controller and cables, as a CSV file'],
    ['cabinets', 'Cabinet list (spreadsheet)', 'Every cabinet position with its data port and power circuit, as a CSV file'],
    ['json', 'Project file (JSON)', 'Back up or share; open it again with Import'],
  ];
  $('#export-menu').innerHTML = items.map(([k, t, d]) => `<button data-exp="${k}"${ok ? '' : ' disabled'}><b>${t}</b><span>${esc(d)}</span></button>`).join('') + (ok ? '' : '<div class="menu-note">Saving files is not available in this view.</div>');
}

function bindAll() {
  // top bar
  const pj = (id, field) => {
    $(id).addEventListener('input', (e) => { const v = e.target.value; if (field === 'name' && !v.trim()) return; change((p) => { p[field] = v; }, { key: 'pj:' + field }); });
    $(id).addEventListener('change', (e) => { if (field === 'name' && !e.target.value.trim()) { e.target.value = S.project.name; } });
  };
  pj('#pj-name', 'name'); pj('#pj-client', 'client'); pj('#pj-rev', 'revision');
  $('#btn-new').onclick = newProject; $('#btn-open').onclick = openProjectsModal; $('#btn-dup').onclick = duplicateProject;
  // empty stage: one tap adds a first screen, or opens the example project
  $('#empty-kinds').innerHTML = KIND_ORDER.map((k) => { const d = KINDS[k], pn = getPanel(null, d.panel); return `<button class="chip" data-kind="${k}"><b>${d.label}</b><span>${d.cols} × ${d.rows} · ${fmtSize(d.cols * pn.w, d.rows * pn.h)}</span></button>`; }).join('');
  $('#empty-kinds').addEventListener('click', (e) => { const b = e.target.closest('[data-kind]'); if (b) addScreen(b.dataset.kind); });
  $('#start-fields').innerHTML = sizeFormHtml(false);
  const startForm = bindSizeForm($('#start-fields'));
  $('#start-form').addEventListener('submit', (e) => { e.preventDefault(); const v = startForm.values(); if (v) addSizedScreen(v); });
  $('#btn-example').onclick = openExample;
  $('#file-panels').addEventListener('change', async (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) await importPanels(f); });
  $('#btn-import').onclick = () => $('#file-import').click();
  $('#file-import').addEventListener('change', importFile);
  $('#btn-settings').onclick = settingsModal;
  $('#btn-export').onclick = (e) => { e.stopPropagation(); renderExportMenu(); toggleMenu(e.currentTarget, $('#export-menu')); };
  $('#export-menu').addEventListener('click', (e) => { const b = e.target.closest('[data-exp]'); if (!b || b.disabled) return; closeMenus(); runExport(b.dataset.exp); });
  $('#btn-add').onclick = (e) => { e.stopPropagation(); renderAddMenu(); toggleMenu(e.currentTarget, $('#add-menu')); };
  $('#add-menu').addEventListener('click', (e) => { const b = e.target.closest('[data-kind], [data-custom]'); if (!b) return; closeMenus(); if (b.dataset.kind) addScreen(b.dataset.kind); else sizeModal(); });
  document.addEventListener('click', (e) => { if (!e.target.closest('.menu-wrap')) closeMenus(); });
  $$('#mode-seg button').forEach((b) => b.onclick = () => { PF.mode = b.dataset.mode; Prefs.save(); applyMode(); renderAll(); });
  $('#btn-theme').onclick = () => { PF.theme = S.dark ? 'light' : 'dark'; Prefs.save(); applyTheme(); View3D.invalidate(); renderAll(); };
  // stage tools
  bindStage();
  $$('[data-align]').forEach((b) => b.onclick = () => alignScreens(b.dataset.align));
  $('#btn-undo').onclick = undo; $('#btn-redo').onclick = redo;
  $('#zoom-in').onclick = () => { const { w, h } = stageSize(); zoomAt(1.25, w / 2, h / 2); };
  $('#zoom-out').onclick = () => { const { w, h } = stageSize(); zoomAt(0.8, w / 2, h / 2); };
  $('#zoom-fit').onclick = () => { S.view.fitted = false; renderStage(); };
  const chk = (id, key, fn) => { const el = $(id); el.checked = !!PF[key]; el.onchange = () => { PF[key] = el.checked; Prefs.save(); fn(); }; };
  chk('#lay-grid', 'grid', renderStage); chk('#lay-labels', 'labels', renderStage); chk('#lay-dims', 'dims', renderStage);
  chk('#plan-dims', 'planDims', renderPlan); chk('#plan-labels', 'planLabels', renderPlan);
  $$('#plan-seg button').forEach((b) => b.onclick = () => { PF.planMode = b.dataset.plan; Prefs.save(); renderPlan(); });
  $$('#face-seg button').forEach((b) => b.onclick = () => { PF.face = b.dataset.face; Prefs.save(); $$('#face-seg button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); schedule3D(0); });
  $$('#face-seg button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.face === faceMode())));
  $('#v3-front').onclick = () => View3D.fit('front'); $('#v3-top').onclick = () => View3D.fit('top'); $('#v3-reset').onclick = () => View3D.fit('persp');
  const pb = $('#v3-person'); pb.setAttribute('aria-pressed', String(!!PF.person));
  pb.onclick = () => { PF.person = !PF.person; Prefs.save(); pb.setAttribute('aria-pressed', String(PF.person)); schedule3D(0); };
  $('#plan-big').onclick = bigPlanModal; $('#plan-png').onclick = () => runExport('plan');
  // tabs
  $('#screen-tabs').addEventListener('click', (e) => { const t = e.target.closest('[data-tab]'); if (t) setActive(t.dataset.tab); });
  // props & cfg
  bindFieldEvents($('#screen-props')); bindFieldEvents($('#cfg'));
  $('#screen-props').addEventListener('click', (e) => {
    const sw = e.target.closest('[data-color]'); const s = active(); if (!s) return;
    if (sw) { change(() => { s.color = sw.dataset.color; }, { structural: false }); $$('#screen-props .sw').forEach((b) => b.setAttribute('aria-pressed', String(b === sw))); return; }
    const act = e.target.closest('[data-act]'); if (!act) return;
    if (act.dataset.act === 'dup') duplicateScreen(s.id);
    if (act.dataset.act === 'mirror') duplicateScreen(s.id, true);
    if (act.dataset.act === 'delete') deleteScreens([s.id]);
  });
  $('#cfg').addEventListener('click', (e) => {
    const s = active(); if (!s) return;
    const seg = e.target.closest('[data-seg] button');
    if (seg) {
      const path = seg.parentElement.dataset.seg; const v = seg.dataset.v;
      if (path === 'sizeMode' && v !== s.sizeMode) { switchSizeMode(s, v); return; }
      change(() => setPath(s, path, v), { structural: true }); return;
    }
    const jt = e.target.closest('[data-joint]');
    if (jt) {
      // H-frame -> post -> nothing -> H-frame; a joint that matches the pattern again loses its change
      const j = +jt.dataset.joint, next = { H: 'P', P: '-', '-': 'H' }[jt.dataset.v] || 'H', cols = S.comps[s.id].cols;
      change(() => {
        s.gs = Object.assign(defaultGroundStack(), s.gs || {}); s.gs.over = Object.assign({}, s.gs.over);
        const base = groundLayout(Object.assign({}, s, { gs: Object.assign({}, s.gs, { over: {} }) }), cols)[j];
        if (next === base) delete s.gs.over[j]; else s.gs.over[j] = next;
      }, { key: `gs:${s.id}` });
      return;
    }
    const corner = e.target.closest('[data-corner-v]');
    if (corner) { change(() => { s.data.start = corner.dataset.cornerV; }, { structural: true }); return; }
    const sg = e.target.closest('[data-sugg]');
    if (sg) { const [cc, rr] = sg.dataset.sugg.split('x').map(Number); change(() => { s.cols = cc; s.rows = rr; s.holes = []; }, { structural: true }); toast(`Set to ${cc} × ${rr}`, { label: 'Undo', run: undo }); return; }
    const act = e.target.closest('[data-act]'); if (!act) return;
    const a = act.dataset.act;
    if (a === 'panels') panelsModal();
    if (a === 'panel-new') panelModal({ use: true });
    if (a === 'panel-copy') panelModal({ template: getPanel(S.project, s.panel), use: true });
    if (a === 'panel-edit') { const p = getPanel(S.project, s.panel); if (Lib.isOwn(p.id)) panelModal({ existing: Lib.find(p.id) }); else panelModal({ existing: p, projectOnly: true }); }
    if (a === 'panel-keep') { const p = getPanel(S.project, s.panel); Lib.upsert(normalizePanel(p)); toast(`Added ${p.name} to your panels`); }
    if (a === 'panel-update') { const lp = Lib.find(s.panel); if (lp) { change((pp) => { pp.catalog = pp.catalog.map((c) => (c.id === lp.id ? deepClone(lp) : c)); }, { structural: true }); toast(`Updated ${lp.name} in this project`, { label: 'Undo', run: undo }); } }
    if (a === 'holes-clear') change(() => { s.holes = []; }, { structural: false });
    if (a === 'gs-reset') change(() => { s.gs = Object.assign(defaultGroundStack(), s.gs || {}, { over: {} }); }, { structural: false });
    if (a === 'settings') settingsModal();
  });
  $('#cfg').addEventListener('toggle', (e) => { if (e.target.id === 'sugg-details') S.suggOpen = e.target.open; }, true);
  $('#cfg').addEventListener('change', (e) => {
    const s = active(); if (!s || !e.target.dataset || e.target.dataset.gs !== 'posts') return;
    change(() => { s.gs = Object.assign(defaultGroundStack(), s.gs || {}, { posts: e.target.checked }); });
  });
  // plan clicks: toggle holes
  $('#plan-svg').addEventListener('click', (e) => {
    if (planMode() !== 'cabinets') return;
    const cell = e.target.closest && e.target.closest('[data-key]'); if (!cell) return;
    const s = active(); const key = cell.getAttribute('data-key');
    const c = S.comps[s.id];
    if (!s.holes.includes(key) && c.count <= 1) { toast('A screen needs at least one cabinet.'); return; }
    change(() => { s.holes = s.holes.includes(key) ? s.holes.filter((k) => k !== key) : [...s.holes, key]; }, { key: `holes:${s.id}` });
  });
  let pr = 0; new ResizeObserver(() => { cancelAnimationFrame(pr); pr = requestAnimationFrame(renderPlan); }).observe($('#plan-wrap').parentElement);
  // keyboard
  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = ['input', 'textarea', 'select'].includes(tag) || e.target.isContentEditable;
    const mod = e.ctrlKey || e.metaKey;
    if ($('.modal-back')) return;
    if (e.key === 'Escape') { closeMenus(); return; }
    if (typing) return;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); if (S.activeId) duplicateScreen(S.activeId); return; }
    if (mod) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && S.selection.size) { e.preventDefault(); deleteScreens([...S.selection]); return; }
    if (e.key.startsWith('Arrow') && S.selection.size) {
      e.preventDefault(); const st = (S.project.settings.snap || 50) * (e.shiftKey ? 10 : 1);
      nudge(e.key === 'ArrowLeft' ? -st : e.key === 'ArrowRight' ? st : 0, e.key === 'ArrowUp' ? st : e.key === 'ArrowDown' ? -st : 0); return;
    }
    if (e.key === 'f' || e.key === 'F') { S.view.fitted = false; renderStage(); }
  });
  // theme changes from the system or the host
  const mq = window.matchMedia('(prefers-color-scheme: light)');
  const onTheme = () => { const was = S.dark; readPalette(); const use = $('#btn-theme use'); if (use) use.setAttribute('href', S.dark ? '#i-sun' : '#i-moon'); if (was !== S.dark || true) { renderStage(); renderPlan(); schedule3D(0); } };
  if (mq.addEventListener) mq.addEventListener('change', onTheme);
  new MutationObserver(onTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  window.addEventListener('beforeunload', () => { if (!S.pristine) Store.save(S.project); });
}

/* ---------- modals ---------- */
function openModal({ title, body, foot, wide, onClose }) {
  const back = document.createElement('div'); back.className = 'modal-back';
  back.innerHTML = `<div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-head"><h3>${esc(title)}</h3><button class="btn icon sm ghost" data-close aria-label="Close"><svg class="ico" style="transform:rotate(45deg)"><use href="#i-plus"/></svg></button></div><div class="modal-body"></div>${foot ? '<div class="modal-foot"></div>' : ''}</div>`;
  const bodyEl = back.querySelector('.modal-body');
  if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
  const prev = document.activeElement;
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey, true); if (onClose) onClose(); if (prev && prev.focus) prev.focus(); };
  // Escape closes the top dialog only (a panel dialog can open over the panel list)
  const onKey = (e) => { if (e.key === 'Escape' && $('#modal-root').lastElementChild === back) { e.stopPropagation(); close(); } };
  if (foot) { const f = back.querySelector('.modal-foot'); for (const b of foot) { if (!b) continue; const btn = document.createElement('button'); btn.className = 'btn ' + (b.cls || ''); btn.textContent = b.label; if (b.id) btn.id = b.id; if (b.disabled) btn.disabled = true; btn.onclick = () => b.run(close, btn); f.appendChild(btn); } }
  back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
  back.querySelector('[data-close]').onclick = close;
  document.addEventListener('keydown', onKey, true);
  $('#modal-root').appendChild(back);
  setTimeout(() => { const f = bodyEl.querySelector('input, select, textarea') || back.querySelector('.modal-foot .btn.primary'); if (f) f.focus(); }, 30);
  return { el: back, body: bodyEl, close };
}
function relTime(iso) {
  const t = Date.parse(iso); if (!t) return '';
  const d = (Date.now() - t) / 1000;
  if (d < 60) return 'just now'; if (d < 3600) return `${Math.round(d / 60)} min ago`; if (d < 86400) return `${Math.round(d / 3600)} h ago`;
  if (d < 172800) return 'yesterday';
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
async function openProjectsModal() {
  const m = openModal({ title: 'Open project', body: '<div class="empty">Loading saved projects…</div>' });
  await flushSave();
  const list = await Store.list();
  const mode = Store.mode();
  const exampleLink = '<div style="margin-top:12px"><button class="linkbtn" data-example>Open the example project</button></div>';
  m.body.addEventListener('click', (e) => { if (e.target.closest('[data-example]')) { m.close(); openExample(); } });
  if (!list.length) {
    m.body.innerHTML = `<div class="empty">No saved projects yet. Projects save automatically once you change something${mode === 'none' ? ', but this browser is blocking storage, so use Export › Project file to keep your work' : ''}. You can also Import a project file.</div>${exampleLink}`;
    return;
  }
  m.body.innerHTML = `<div class="desc">${mode === 'cloud' ? 'Projects saved to your account. They follow you to any device where you open this planner.' : 'Projects saved in this browser.'}</div>
    <div class="plist">${list.map((x) => `<div class="prow${x.id === S.project.id ? ' current' : ''}" data-id="${esc(x.id)}">
      <div><div class="t">${esc(x.name || 'Untitled')}</div><div class="m">${[x.client, x.revision ? 'Rev ' + x.revision : '', `${x.screens || 0} screen${x.screens === 1 ? '' : 's'}`, `${fmtInt(x.cabinets || 0)} cabinets`, relTime(x.updated), x.where === 'browser' && mode === 'cloud' ? 'this browser only' : ''].filter(Boolean).map(esc).join(' · ')}</div></div>
      <div class="b">${x.id === S.project.id ? '<span class="m">Open now</span>' : '<button class="btn sm" data-open>Open</button><button class="btn sm danger" data-del>Delete</button>'}</div></div>`).join('')}</div>${exampleLink}`;
  m.body.addEventListener('click', async (e) => {
    const row = e.target.closest('.prow'); if (!row) return; const id = row.dataset.id;
    if (e.target.closest('[data-open]')) {
      const p = await Store.load(id);
      if (!p) { toast('That project could not be opened.'); return; }
      setProject(p); S.lastSetId = p.id; Store.setLast(p.id); renderAll(); m.close(); toast(`Opened ${p.name}`);
      return;
    }
    const del = e.target.closest('[data-del]');
    if (del) {
      if (!del.classList.contains('armed')) { del.classList.add('armed'); del.textContent = 'Confirm delete'; setTimeout(() => { if (del.isConnected) { del.classList.remove('armed'); del.textContent = 'Delete'; } }, 4000); return; }
      await Store.remove(id); row.remove(); toast('Project deleted');
    }
  });
}
async function newProject() {
  await flushSave();
  // saved once something is added or changed, so empty projects don't pile up in Open
  setProject(blankProject(), { fresh: true }); renderAll();
  toast('Started a new project');
}
async function openExample() {
  await flushSave();
  setProject(exampleProject()); renderAll();
  toast('Opened the example project. Your changes to it save as a project of your own.');
}
async function duplicateProject() {
  await flushSave();
  const p = deepClone(S.project); p.id = uid('p-'); p.name = `${S.project.name} (copy)`; p.created = p.updated = new Date().toISOString(); delete p.example;
  setProject(p, { keepView: true }); S.pristine = false; renderAll(); saveNow();
  toast(`Now editing ${p.name}`);
}
async function importFile(e) {
  const f = e.target.files && e.target.files[0]; e.target.value = '';
  if (!f) return;
  // a spreadsheet is a panel list, not a project
  const head = new Uint8Array(await f.slice(0, 4).arrayBuffer());
  if (/\.(xlsx|xls|csv|tsv|txt)$/i.test(f.name) || (head[0] === 0x50 && head[1] === 0x4B) || (head[0] === 0xD0 && head[1] === 0xCF)) {
    panelsModal(); await importPanels(f); return;
  }
  try {
    const raw = JSON.parse(await f.text());
    const p = normalizeProject(raw);
    p.id = uid('p-'); p.updated = new Date().toISOString(); delete p.example;
    await flushSave();
    setProject(p); S.pristine = false; renderAll(); saveNow();
    toast(`Imported ${p.name}`);
  } catch (err) { toast(`That file could not be imported: ${err.message || 'it is not a project file'}`); }
}

function settingsModal() {
  const p = S.project, st = p.settings;
  const body = `
    <div class="msec"><h4>Project</h4><div class="mgrid">
      <label class="fld"><span>Project name</span><input type="text" data-sb="name" value="${esc(p.name)}"></label>
      <label class="fld"><span>Client</span><input type="text" data-sb="client" value="${esc(p.client || '')}"></label>
      <label class="fld"><span>Venue</span><input type="text" data-sb="settings.venue" value="${esc(st.venue || '')}"></label>
      <label class="fld"><span>Address</span><input type="text" data-sb="settings.address" value="${esc(st.address || '')}" placeholder="Street, postcode, city"></label>
      <label class="fld"><span>On-site contact</span><input type="text" data-sb="settings.contact" value="${esc(st.contact || '')}"></label>
      <label class="fld"><span>Contact phone</span><input type="text" data-sb="settings.phone" value="${esc(st.phone || '')}"></label>
      <label class="fld"><span>Setup</span><input type="text" data-sb="settings.setup" value="${esc(st.setup || '')}" placeholder="e.g. 13 Aug 2026, 08:00"></label>
      <label class="fld"><span>Event date</span><input type="text" data-sb="settings.eventDate" value="${esc(st.eventDate || '')}" placeholder="e.g. 14–16 Aug 2026"></label>
      <label class="fld"><span>Teardown</span><input type="text" data-sb="settings.teardown" value="${esc(st.teardown || '')}" placeholder="e.g. 16 Aug 2026, 23:00"></label>
      <label class="fld"><span>Revision</span><input type="text" data-sb="revision" value="${esc(p.revision || '')}"></label>
      <label class="fld"><span>Prepared by</span><input type="text" data-sb="settings.preparedBy" value="${esc(st.preparedBy || '')}"></label>
    </div><label class="fld"><span>Notes for the report</span><textarea data-sb="settings.notes" rows="3">${esc(st.notes || '')}</textarea></label></div>
    <div class="msec"><h4>Data</h4><div class="mgrid">
      <label class="fld"><span>Pixels per data port</span><input type="number" id="set-portcap" data-sb="settings.portCapacity" data-t="int" min="1000" max="1000000000" step="1000" value="${st.portCapacity}"></label>
      <label class="fld"><span>Port label</span><input type="text" data-sb="settings.portPrefix" maxlength="4" value="${esc(st.portPrefix || 'P')}"></label>
    </div><div class="chips"><button class="chip" data-portcap="650000"><b>650,000</b><span>1 Gbit port, 8-bit</span></button><button class="chip" data-portcap="325000"><b>325,000</b><span>1 Gbit port, 10-bit</span></button></div>
    <div class="desc">NovaStar rates one 1 Gbit Ethernet port at 650,000 px with 8-bit colour and 325,000 px with 10-bit. High frame rates also lower the number, so check your processor's figures.</div>
      <label class="chk"><input type="checkbox" data-sb="settings.backup"${st.backup ? ' checked' : ''}> Backup cables: run a second cable from the last cabinet of each chain back to the controller</label>
      <div class="desc">With backup, each chain is fed from both ends, so one broken cable does not black out the cabinets after it. It uses a second controller output per port.</div>
      <label class="fld"><span>NovaStar controller</span><select data-sb="settings.controller" id="set-ctrl">
        <option value="auto"${st.controller === 'auto' ? ' selected' : ''}>Suggest one (VX Pro series)</option>
        ${CONTROLLERS.map((d) => `<option value="${d.id}"${st.controller === d.id ? ' selected' : ''}>${esc(d.name)} · ${d.ports} outputs · ${fmtNum(d.capacity / 1e6, 2)} M px</option>`).join('')}
      </select></label>
      <div class="readout" id="ctrl-out"></div></div>
    <div class="msec pro"><h4>Power</h4><div class="mgrid">
      <label class="fld"><span>Mains voltage (V)</span><input type="number" data-sb="settings.voltage" data-t="num" min="50" max="1000" step="1" value="${st.voltage}"></label>
      <label class="fld"><span>Circuit breaker (A)</span><input type="number" data-sb="settings.circuitAmps" data-t="num" min="1" max="1000" step="1" value="${st.circuitAmps}"></label>
      <label class="fld"><span>Max load per circuit (%)</span><input type="number" data-sb="settings.loadFactor" data-t="pct" min="10" max="100" step="5" value="${Math.round(st.loadFactor * 100)}"></label>
      <label class="fld"><span>Power factor</span><input type="number" data-sb="settings.powerFactor" data-t="num" min="0.5" max="1" step="0.01" value="${st.powerFactor}"></label>
      <label class="fld"><span>Size circuits on</span><select data-sb="settings.powerBasis"><option value="max"${st.powerBasis !== 'avg' ? ' selected' : ''}>Maximum power</option><option value="avg"${st.powerBasis === 'avg' ? ' selected' : ''}>Typical power</option></select></label>
    </div><div class="desc">Current = watts ÷ (volts × power factor). LED display power supplies with active PFC are usually above 0.95; use 1 to work from watts alone.</div></div>
    <div class="msec"><h4>Layout and report</h4><div class="mgrid">
      <label class="fld"><span>Snap step (mm)</span><input type="number" data-sb="settings.snap" data-t="int" min="1" max="5000" step="10" value="${st.snap}"></label>
    </div>
      <label class="chk"><input type="checkbox" data-sb="settings.report3D"${st.report3D ? ' checked' : ''}> Include the 3D view in the PDF</label>
      <label class="chk pro"><input type="checkbox" data-sb="settings.reportPower"${st.reportPower ? ' checked' : ''}> Include a specifications and power page per screen</label>
      <label class="chk"><input type="checkbox" data-sb="settings.reportPacking"${st.reportPacking ? ' checked' : ''}> Include a packing list</label>
    </div>`;
  const m = openModal({ title: 'Project settings', body, foot: [{ label: 'Done', cls: 'primary', run: (close) => close() }] });
  const apply = (el, final) => {
    const path = el.dataset.sb; let v;
    if (el.type === 'checkbox') v = el.checked;
    else if (el.dataset.t) {
      const n = parseFloat(String(el.value).replace(',', '.'));
      if (!Number.isFinite(n)) { if (final) el.value = el.dataset.t === 'pct' ? Math.round(getPath(S.project, path) * 100) : getPath(S.project, path); return; }
      v = el.dataset.t === 'int' ? Math.round(n) : n;
      const lo = el.min !== '' ? +el.min : -Infinity, hi = el.max !== '' ? +el.max : Infinity;
      if (!final && (v < lo || v > hi)) return;   // half typed (e.g. "2" on the way to 230): wait for the rest
      v = clamp(v, lo, hi);
      if (final && String(el.value) !== String(v)) el.value = v;
      if (el.dataset.t === 'pct') v = v / 100;
    } else v = el.value;
    if (path === 'name' && !String(v).trim()) { if (final) el.value = S.project.name; return; }
    change((pp) => setPath(pp, path, v), { key: 'set:' + path });
    if (final) renderCfg();
    ctrlOut();
  };
  const ctrlOut = () => { const el = $('#ctrl-out', m.body); if (el) el.innerHTML = S.plan ? ctrlSummary(S.plan) : 'No data ports yet.'; };
  ctrlOut();
  m.body.addEventListener('click', (e) => { const b = e.target.closest('[data-portcap]'); if (!b) return; const el = $('#set-portcap', m.body); el.value = b.dataset.portcap; apply(el, true); });
  m.body.addEventListener('input', (e) => { if (e.target.dataset.sb && e.target.type !== 'checkbox' && e.target.tagName !== 'SELECT') apply(e.target, false); });
  m.body.addEventListener('change', (e) => { if (e.target.dataset.sb) apply(e.target, true); });
}

// a panel of your own: new, from a template, or editing one (in your panels, or one only this project has)
function panelModal({ existing = null, template = null, use = false, onSaved = null, projectOnly = false } = {}) {
  const base = existing || template;
  const p = base ? Object.assign({}, base) : { brand: '', model: '', w: 500, h: 500, px: 128, py: 128, kg: 8.5, wMax: 180, wAvg: 60, stock: null };
  if (!existing && template) { p.brand = template.builtin ? '' : template.brand; p.model = template.builtin ? template.name.replace(/^Generic /, '') : template.model; p.stock = null; }
  const usedBy = existing && projectOnly ? S.project.screens.filter((s) => s.panel === existing.id || (s.sizeMode === 'mix' && (s.mix.small === existing.id || s.mix.big === existing.id))).length : 0;
  const f = (k, label, step, unit, t = 'num') => `<label class="fld"><span>${label}</span><div class="unit-in"><input type="number" data-pk="${k}" data-t="${t}" step="${step}" min="0" inputmode="decimal" value="${p[k] === null || p[k] === undefined ? '' : p[k]}"><i>${unit}</i></div></label>`;
  const body = `
    <div class="mgrid two">
      <label class="fld"><span>Brand</span><input type="text" data-pk="brand" value="${esc(p.brand || '')}" maxlength="40" list="pk-brands" placeholder="Manufacturer" autocomplete="off"></label>
      <label class="fld"><span>Model</span><input type="text" data-pk="model" value="${esc(p.model || p.name || '')}" maxlength="80" autocomplete="off"></label>
    </div><datalist id="pk-brands">${Lib.brands().map((b) => `<option value="${esc(b)}"></option>`).join('')}</datalist>
    <div class="msec"><h4>Cabinet</h4><div class="mgrid">${f('w', 'Width', 0.5, 'mm')}${f('h', 'Height', 0.5, 'mm')}${f('px', 'Pixels across', 1, 'px', 'int')}${f('py', 'Pixels down', 1, 'px', 'int')}</div></div>
    <div class="msec"><h4>Weight and power (from the datasheet)</h4><div class="mgrid">${f('kg', 'Weight', 0.1, 'kg')}${f('wMax', 'Max power', 1, 'W')}${f('wAvg', 'Typical power', 1, 'W')}</div>
    <div class="desc">Leave a value empty if you do not know it; totals that need it will show as no data.</div></div>
    ${projectOnly ? '' : `<div class="msec"><h4>Stock</h4><div class="mgrid">${f('stock', 'Cabinets you have', 1, 'pcs', 'int')}</div><div class="desc">Optional. The planner warns when a project needs more than this.</div></div>`}
    <div class="readout" id="pk-out"></div>
    ${existing && !projectOnly ? '<div class="desc">Changes apply to your panels and to this project. Other saved projects keep the values they were planned with until you choose Use the new values there.</div>' : ''}`;
  const s0 = active();
  const m = openModal({ title: existing ? 'Edit panel' : 'New panel', body, foot: [
    existing && !projectOnly ? { label: 'Remove from your panels', cls: 'danger', run: (close, btn) => {
      if (!btn.classList.contains('armed')) { btn.classList.add('armed'); btn.textContent = 'Confirm remove'; return; }
      const was = Lib.find(existing.id); Lib.remove(existing.id); close();
      toast(`Removed ${existing.name} from your panels`, { label: 'Undo', run: () => { if (was) Lib.upsert(was); } });
      if (onSaved) onSaved(null);
    } } : null,
    existing && projectOnly ? { label: usedBy ? `Used by ${usedBy} screen${usedBy === 1 ? '' : 's'}` : 'Delete panel', cls: 'danger', disabled: !!usedBy, run: (close, btn) => {
      if (!btn.classList.contains('armed')) { btn.classList.add('armed'); btn.textContent = 'Confirm delete'; return; }
      change((pp) => { pp.catalog = pp.catalog.filter((c) => c.id !== existing.id); }, { structural: true }); close(); toast('Panel deleted', { label: 'Undo', run: undo });
    } } : null,
    { label: 'Cancel', run: (close) => close() },
    { label: existing ? 'Save panel' : use && s0 && s0.sizeMode !== 'mix' ? 'Add and use' : 'Add panel', cls: 'primary', run: (close) => {
      const v = read();
      if (!v.model.trim()) { toast('Give the panel a model name.'); return; }
      if (!(v.w > 0 && v.h > 0 && v.px > 0 && v.py > 0)) { toast('Width, height and pixel counts must be above zero.'); return; }
      if (existing) {
        const np = normalizePanel(Object.assign({}, v, { id: existing.id }));
        if (!projectOnly) Lib.upsert(np);
        const inProject = S.project.catalog.some((c) => c.id === np.id);
        if (inProject) change((pp) => { pp.catalog = pp.catalog.map((c) => (c.id === np.id ? deepClone(np) : c)); }, { structural: true });
        close(); toast(`Saved ${np.name}`); if (onSaved) onSaved(np); return;
      }
      const id = panelIdFor(v.brand, v.model);
      if (Lib.isOwn(id)) { toast(`You already have ${panelName(v.brand, v.model)}. Edit that one, or use another model name.`); return; }
      const np = normalizePanel(Object.assign({}, v, { id }));
      Lib.upsert(np);
      const s = active();
      if (use && s && s.sizeMode !== 'mix') change(() => { s.panel = np.id; }, { structural: true });
      close(); toast(`Added ${np.name} to your panels`); if (onSaved) onSaved(np);
    } },
  ] });
  const read = () => {
    const o = {};
    $$('[data-pk]', m.body).forEach((el) => {
      const k = el.dataset.pk;
      if (k === 'brand' || k === 'model') { o[k] = el.value.replace(/\s+/g, ' ').trim(); return; }
      const n = parseFloat(String(el.value).replace(',', '.'));
      o[k] = Number.isFinite(n) ? (el.dataset.t === 'int' ? Math.round(n) : n) : (['kg', 'wMax', 'wAvg', 'stock'].includes(k) ? null : 0);
    });
    if (projectOnly && existing) o.stock = existing.stock ?? null;
    return o;
  };
  const out = () => {
    const v = read(); const el = $('#pk-out', m.body);
    const name = panelName(v.brand, v.model);
    if (v.w > 0 && v.px > 0 && v.h > 0 && v.py > 0) el.innerHTML = `${name ? `<b>${esc(name)}</b> · ` : ''}pitch <b>${(v.w / v.px).toFixed(3)} mm</b> across, <b>${(v.h / v.py).toFixed(3)} mm</b> down · ${fmtInt(v.px * v.py)} px per cabinet · ${fmtNum((v.px * v.py) / (v.w * v.h / 1e6) / 1000, 1)}k px/m²`;
    else el.textContent = 'Enter the cabinet size and pixel counts.';
  };
  m.body.addEventListener('input', out); out();
}

/* ---------- the "Your panels" dialog: your list, the site's panels.xlsx, import and export ---------- */
function specLine(p) {
  return `${fmtNum(p.w, 1)} × ${fmtNum(p.h, 1)} mm · ${p.px} × ${p.py} px · P${fmtPitch(p)}${p.kg !== null ? ` · ${fmtNum(p.kg, 1)} kg` : ''}${p.wMax !== null ? ` · ${fmtInt(p.wMax)} W` : ''}${p.stock !== null && p.stock !== undefined ? ` · stock ${fmtInt(p.stock)}` : ''}`;
}
function skippedHtml(list) {
  if (!list || !list.length) return '';
  return `<details class="more"><summary>${list.length} row${list.length === 1 ? '' : 's'} skipped</summary><div class="desc">${list.slice(0, 60).map((x) => `Row ${x.row}${x.name ? ` (${esc(x.name)})` : ''}: ${esc(x.reason)}`).join('<br>')}${list.length > 60 ? `<br>and ${list.length - 60} more` : ''}</div></details>`;
}
function panelListHtml(list, editable) {
  if (!list.length) return '';
  const groups = new Map();
  for (const p of [...list].sort(byBrandModel)) { const b = p.brand || ''; if (!groups.has(b)) groups.set(b, []); groups.get(b).push(p); }
  return `<div class="plist">${[...groups].map(([b, ps]) => `<div class="lib-brand">${esc(b || 'No brand')}</div>${ps.map((p) => `<div class="prow" data-pid="${esc(p.id)}"><div><div class="t">${esc(b ? p.model : p.name)}</div><div class="m mono">${specLine(p)}</div></div>${editable ? '<div class="b"><button class="btn sm" data-lib="edit">Edit</button><button class="btn sm danger" data-lib="del">Delete</button></div>' : ''}</div>`).join('')}`).join('')}</div>`;
}
function panelsModal() {
  const m = openModal({ title: 'Your panels', body: '<div class="lib" id="lib"></div>', foot: [
    { label: 'Export', run: exportPanels },
    { label: 'Import Excel or CSV', run: () => $('#file-panels').click() },
    { label: 'New panel', cls: 'primary', run: () => panelModal() },
  ], onClose: () => { off(); S.libNote = ''; } });
  const render = () => {
    const box = $('#lib', m.body); if (!box) return;
    const mode = Store.mode();
    const where = mode === 'cloud' ? 'in your account, so they follow you to every device where you open this planner' : mode === 'local' ? 'in this browser' : 'only until you close the page, because this browser is blocking storage, so use Export to keep them';
    const out = [`<div class="desc">Your panels show in every panel list, grouped by brand, in every project. Panels you add here are kept ${where}. A project keeps a copy of each panel it uses, so its project file works anywhere.</div>`];
    if (S.libNote) out.push(`<div class="readout">${S.libNote}</div>`);
    const site = Lib.site;
    if (site) {
      out.push(`<div class="lib-sec"><div class="lib-head"><h4>${esc(site.file)} on this site</h4><button class="btn sm" data-lib="reload">Read again</button></div>
        <div class="desc">${site.error ? `<span class="warn">Could not read the file: ${esc(site.error)}</span><br>` : ''}${fmtInt(site.panels.length)} panel${site.panels.length === 1 ? '' : 's'}${site.sheet ? ` from the sheet “${esc(site.sheet)}”` : ''}, read ${relTime(site.loaded) || 'earlier'}. To change them, edit the file and upload it again.</div>
        ${skippedHtml(site.skipped)}${panelListHtml(site.panels.filter((x) => !Lib.isOwn(x.id)), false)}</div>`);
    } else if (/(^|\.)github\.io$/i.test(location.hostname)) {
      out.push(`<div class="lib-sec"><h4>Panel list for everyone</h4><div class="desc">Upload an Excel file named <b>panels.xlsx</b> to this planner's GitHub repository, next to index.html. The planner reads it every time it opens, on every device. <button class="linkbtn" data-lib="reload">Check again</button></div></div>`);
    }
    out.push(`<div class="lib-sec"><h4>Added ${mode === 'cloud' ? 'to your account' : mode === 'local' ? 'in this browser' : 'here'}</h4>${Lib.own.length ? panelListHtml(Lib.own, true) : '<div class="empty">None yet. Use New panel, or Import an Excel or CSV file with one row per panel.</div>'}</div>`);
    const tpl = /(^|\.)github\.io$/i.test(location.hostname) ? 'panels-template.xlsx' : 'https://juicypeachxx.github.io/Led-wall-calc/panels-template.xlsx';
    out.push(`<div class="desc">Spreadsheet columns: Brand, Model, Width (mm), Height (mm), Pixels across, Pixels down, and if you have them Weight (kg), Max power (W), Typical power (W) and Stock. Pixel pitch can stand in for the pixel counts. <a class="linkbtn" href="${tpl}" download target="_blank" rel="noopener">Download the Excel template</a>; Export gives a CSV file with the same columns.</div>`);
    box.innerHTML = out.join('');
  };
  const off = Lib.on(render);
  m.body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-lib]'); if (!b) return;
    const a = b.dataset.lib, row = b.closest('[data-pid]'), p = row ? Lib.find(row.dataset.pid) : null;
    if (a === 'edit' && p) panelModal({ existing: p });
    if (a === 'del' && p) {
      if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'Confirm delete'; setTimeout(() => { if (b.isConnected) { b.classList.remove('armed'); b.textContent = 'Delete'; } }, 4000); return; }
      Lib.remove(p.id); toast(`Removed ${p.name} from your panels`, { label: 'Undo', run: () => Lib.upsert(p) });
    }
    if (a === 'reload') { b.disabled = true; await loadSitePanels({ announce: true }); render(); }
    if (a === 'prune') {
      const gone = Lib.own.filter((x) => S.libPrune.includes(x.id)); S.libPrune = [];
      Lib.own = Lib.own.filter((x) => !gone.some((g) => g.id === x.id)); S.libNote = ''; Lib.saveOwn();
      toast(`Removed ${gone.length} panel${gone.length === 1 ? '' : 's'}`, { label: 'Undo', run: () => { Lib.own.push(...gone); Lib.saveOwn(); } });
    }
  });
  render();
}
// a spreadsheet with one row per panel -> your panels (matched by brand and model, so importing again updates them)
async function importPanels(file) {
  let r;
  try { r = await Sheets.readPanels(file, file.name); }
  catch (e) { S.libNote = `<span class="warn"><b>${esc(file.name)}</b>: ${esc(e.message || 'could not be read')}</span>`; Lib.emit(); toast(`${file.name} could not be read`); return; }
  if (!r.header) {
    S.libNote = `<span class="warn"><b>${esc(file.name)}</b>: no column names found.</span> The first rows need names such as Brand, Model, Width (mm), Height (mm), Pixels across and Pixels down.`;
    Lib.emit(); toast(`No panel list found in ${file.name}`); return;
  }
  let added = 0, updated = 0, same = 0; const ids = new Set();
  for (const np of r.panels) {
    const key = panelKey(np.brand, np.model);
    const ex = Lib.own.find((x) => x.id === np.id) || Lib.own.find((x) => panelKey(x.brand, x.model) === key);
    if (ex) {
      // a column the file does not have keeps the value you had; an empty cell in a column it has clears it
      const keep = {}; for (const k of ['kg', 'wMax', 'wAvg', 'stock']) if (!r.columns.includes(k)) keep[k] = ex[k] ?? null;
      const merged = normalizePanel(Object.assign({}, np, keep, { id: ex.id })); ids.add(ex.id);
      if (samePanel(ex, merged) && (ex.stock ?? null) === (merged.stock ?? null)) same++; else { Object.assign(ex, merged); updated++; }
    } else { Lib.own.push(np); ids.add(np.id); added++; }
  }
  const extra = Lib.own.filter((x) => !ids.has(x.id));
  S.libPrune = extra.map((x) => x.id);
  S.libNote = `<b>${esc(file.name)}</b>${r.sheet ? `, sheet “${esc(r.sheet)}”` : ''}: ${added} added, ${updated} updated, ${same} unchanged.${skippedHtml(r.skipped)}`
    + (extra.length ? `<br>${extra.length} of the panels you had here ${extra.length === 1 ? 'is' : 'are'} not in this file. <button class="linkbtn" data-lib="prune">Remove ${extra.length === 1 ? 'it' : 'them'}</button>` : '');
  if (added || updated) Lib.saveOwn(); else Lib.emit();
  toast(`Read ${r.panels.length} panel${r.panels.length === 1 ? '' : 's'} from ${file.name}`);
}
async function exportPanels() {
  const list = [...Lib.all()].sort(byBrandModel);
  if (!list.length) { toast('There are no panels to export yet.'); return; }
  const rows = [['Brand', 'Model', 'Width (mm)', 'Height (mm)', 'Pixels across', 'Pixels down', 'Pitch (mm)', 'Weight (kg)', 'Max power (W)', 'Typical power (W)', 'Stock']];
  for (const p of list) rows.push([p.brand, p.model || p.name, p.w, p.h, p.px, p.py, Math.round(p.w / p.px * 1000) / 1000, p.kg, p.wMax, p.wAvg, p.stock ?? null]);
  await Downloads.save('Your_panels.csv', new Blob([csvText(rows)], { type: 'text/csv;charset=utf-8' }));
}
// panels.xlsx (or panels.csv) next to the planner: everyone who opens the planner from that site gets these panels
async function loadSitePanels({ announce = false } = {}) {
  if (!/^https?:$/.test(location.protocol)) return;
  for (const file of ['panels.xlsx', 'panels.csv']) {
    let res;
    try { res = await fetch(file, { cache: 'no-cache' }); } catch (e) { if (announce) toast('Could not reach the site. The last copy of the panel list stays in use.'); return; }
    if (!res.ok || /text\/html/i.test(res.headers.get('content-type') || '')) continue;
    const prev = Lib.site;
    try {
      const r = await Sheets.readPanels(await res.blob(), file);
      if (!r.header) throw new Error('no column names found. The first rows need names such as Brand, Model, Width (mm), Height (mm), Pixels across and Pixels down.');
      const changed = !prev || prev.file !== file || JSON.stringify(prev.panels) !== JSON.stringify(r.panels);
      Lib.setSite({ file, sheet: r.sheet || '', panels: r.panels, skipped: r.skipped, loaded: new Date().toISOString() });
      if (announce || changed) toast(`${prev && prev.file === file ? 'Updated' : 'Loaded'} ${r.panels.length} panel${r.panels.length === 1 ? '' : 's'} from ${file}`);
    } catch (e) {
      Lib.setSite({ file, sheet: '', panels: prev && prev.file === file ? prev.panels : [], skipped: [], error: e.message || 'unreadable', loaded: new Date().toISOString() });
      toast(`${file} on this site could not be read`);
    }
    return;
  }
  if (Lib.site) Lib.setSite(null);
  if (announce) toast('No panels.xlsx found on this site.');
}
// once: panels made in projects before there was a panel list become your panels
function migratePanels() {
  if (Store.flag('libmig')) return 0;
  let n = 0;
  for (const c of Store.localCatalogs()) {
    let p; try { p = normalizePanel(c); } catch (e) { continue; }
    const key = panelKey(p.brand, p.model);
    if (Lib.find(p.id) || Lib.own.some((x) => panelKey(x.brand, x.model) === key)) continue;
    Lib.own.push(p); n++;
  }
  if (n) Lib.saveOwn();
  Store.flag('libmig', true);
  return n;
}
// signed in: the account's list wins, and panels only this browser had are added to it
async function syncCloudPanels() {
  const cl = await Store.cloudLibrary();
  if (!cl) { if (Lib.own.length) Store.saveLibrary(Lib.own); return; }
  const list = cl.map((c) => { try { return normalizePanel(c); } catch (e) { return null; } }).filter(Boolean);
  const ids = new Set(list.map((p) => p.id)), extra = Lib.own.filter((p) => !ids.has(p.id));
  Lib.own = [...list, ...extra].sort(byBrandModel);
  Store.saveLibrary(Lib.own, { cloud: extra.length > 0 });
  Lib.emit();
}
// when the panel lists change: refresh the panel menus in the screen settings without redrawing the fields
function onPanelsChanged() {
  $$('#cfg select[data-bind="panel"], #cfg select[data-bind="mix.small"], #cfg select[data-bind="mix.big"]').forEach((sel) => { const v = sel.value; sel.innerHTML = panelOptions(v); sel.value = v; });
  refreshReadouts();
}

function bigPlanModal() {
  const s = active(); if (!s) return; const c = S.comps[s.id]; const mode = planMode();
  const m = openModal({ title: `${s.name} · ${{ cabinets: 'cabinets', data: 'data cabling', power: 'power' }[mode]}`, body: '<div class="big-plan" id="big-plan"></div><div class="legend" style="border:0;padding:0" id="big-legend"></div>', wide: true });
  const box = $('#big-plan', m.body);
  const w = Math.max(320, box.clientWidth || window.innerWidth - 80);
  const fs = clamp(w / 70, 11, 15);
  const h = clamp(planPx(c, w, fs, true, true), 260, Math.max(400, window.innerHeight - 220));
  const pen = new SvgPen(); pen.rect(0, 0, w, h, { fill: S.pal.bg });
  drawPlan(pen, c, { x: fs * 0.5, y: fs * 0.5, w: w - fs, h: h - fs }, { mode, dims: true, labels: true, pal: S.pal, fs, screenColor: s.color, prefix: S.project.settings.portPrefix, backup: S.project.settings.backup, minText: 7 });
  box.innerHTML = `<svg viewBox="0 0 ${w} ${h}" width="100%" style="display:block">${pen.toString()}</svg>`;
  $('#big-legend', m.body).innerHTML = legendHtml(mode, s, c);
}

/* ---------- exports ---------- */
function canvasToBlob(canvas) { return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('The image could not be created.'))), 'image/png')); }
function pngHeader(pen, title, sub, w) {
  pen.text(title, 40, 52, { size: 30, weight: 700, fill: PRINT_PAL.ink });
  pen.text(sub, 40, 84, { size: 19, fill: PRINT_PAL.ink3 });
  pen.text('LED WALL PLANNER', w - 40, 52, { size: 22, font: 'cond', weight: 700, fill: PRINT_PAL.ink3, anchor: 'end' });
}
async function exportLayoutPNG() {
  const W = 2400, fs = 22;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = 10;
  const pen0 = new CanvasPen(cv.getContext('2d'));
  const opts = { pal: PRINT_PAL, labels: true, dims: true, minGrid: 18 };
  // height follows the content: fit to the width first, then size the box to what that needs
  const wide = fitStageView(S.project, S.comps, { x: 40 + fs * 2.4, y: 0, w: W - 80 - fs * 2.4, h: 1e6 }, fs, pen0, opts);
  const boxH = clamp(wide.bh * wide.s + wide.pad.t + wide.pad.b + fs * 2, 700, 2400);
  const H = Math.round(110 + boxH + 40);
  cv.height = H;
  const ctx = cv.getContext('2d'); ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, H);
  const pen = new CanvasPen(ctx);
  pngHeader(pen, S.project.name, `Stage layout, front view (developed) · ${[S.project.client, 'Rev ' + (S.project.revision || 'A'), new Date().toLocaleDateString('en-GB')].filter(Boolean).join(' · ')}`, W);
  const box = { x: 40, y: 110, w: W - 80, h: boxH };
  const f = fitStageView(S.project, S.comps, { x: box.x + fs * 2.4, y: box.y + fs * 1.5, w: box.w - fs * 2.4, h: box.h - fs * 1.5 }, fs, pen, opts);
  drawStage(pen, Object.assign({ project: S.project, comps: S.comps, fs, s: f.s, tx: f.tx, ty: f.ty, box, grid: true }, opts));
  pen.rect(box.x, box.y, box.w, box.h, { fill: 'none', stroke: '#D5DDE5', sw: 2 });
  await Downloads.save(`${slug(S.project.name)}_layout.png`, await canvasToBlob(cv));
}
async function exportPlanPNG() {
  const s = active(); if (!s) { toast('Add a screen first.'); return; } const c = S.comps[s.id]; const mode = planMode();
  const W = 2400, fs = 30; const top = 110;
  const ph = clamp(planPx(c, W - 80, fs, true, true), 500, 3200);
  const H = Math.round(top + ph + 40);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d'); ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, H);
  const pen = new CanvasPen(ctx);
  pngHeader(pen, `${s.name} · ${{ cabinets: 'cabinets and build order', data: 'data cabling', power: 'power circuits' }[mode]}`, `${S.project.name} · ${fmtSize(c.W, c.H)} · ${fmtRes(c.resW, c.resH)} px · ${c.count} cabinets${mode === 'data' ? ` · ${c.ports.length} data ports${S.project.settings.backup ? ' + backup (BK)' : ''}` : ''}`, W);
  drawPlan(pen, c, { x: 40, y: top, w: W - 80, h: ph }, { mode, dims: true, labels: true, pal: Object.assign({}, PRINT_PAL, { cellAlpha: 0.45, panelFill: 0.82 }), fs, screenColor: s.color, prefix: S.project.settings.portPrefix, backup: S.project.settings.backup, minText: 10 });
  await Downloads.save(`${slug(S.project.name)}_${slug(s.name)}_${mode}.png`, await canvasToBlob(cv));
}
async function exportPixelMap() {
  const s = active(); if (!s) { toast('Add a screen first.'); return; } const c = S.comps[s.id];
  if (c.resW > 16384 || c.resH > 16384 || c.resW * c.resH > 100e6) { toast('This screen is too large for a single pixel map image.'); return; }
  const cv = document.createElement('canvas');
  drawPixelMap(cv, c, S.project);
  await Downloads.save(`${slug(S.project.name)}_${slug(s.name)}_pixelmap_${c.resW}x${c.resH}.png`, await canvasToBlob(cv));
}
async function exportPDF() {
  toast('Building the PDF…');
  await new Promise((r) => setTimeout(r, 40));
  let snapshot = null, aspect = 1000 / 1800;
  if (S.project.settings.report3D && View3D.isReady()) {
    View3D.sync(S.project, S.comps, { face: faceMode(), person: PF.person, dark: S.dark });
    snapshot = View3D.snapshot(1800, 1000);
  }
  const blob = await buildPdfReport(S.project, S.comps, S.totals, { snapshot, snapshotAspect: aspect });
  await Downloads.save(`${slug(S.project.name)}_rev${slug(S.project.revision || 'A')}.pdf`, blob);
}
/* ---------- spreadsheets (CSV) ----------
   Follows the viewer's number format: where the decimal mark is a comma (most of Europe), fields are
   separated by semicolons, which is what Excel expects there; elsewhere commas and decimal points. */
function csvFormat() { const dec = (1.5).toLocaleString().includes(',') ? ',' : '.'; return { dec, sep: dec === ',' ? ';' : ',' }; }
function csvText(rows) {
  const f = csvFormat();
  const cell = (v) => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v * 1000) / 1000).replace('.', f.dec) : '';
    const t = String(v);
    return /[",;\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return '﻿' + rows.map((r) => r.map(cell).join(f.sep)).join('\r\n') + '\r\n';
}
function csvPackingList(project, comps, plan) {
  const rows = [['Group', 'Item', 'Quantity', 'Unit', 'Per screen', 'Note', 'Packed', 'Loaded']];
  for (const it of packingList(project, comps, plan)) rows.push([it.group, it.item, it.unit === 'm' ? Math.round(it.qty * 100) / 100 : it.qty, it.unit === 'm' ? 'm' : 'pcs', it.parts.map((x) => packPart(it, x)).join(' / '), it.note, '', '']);
  return csvText(rows);
}
function csvCabinetList(project, comps) {
  const st = project.settings;
  const rows = [['Screen', 'Cabinet', 'Column', 'Row', 'Status', 'Panel', 'Width (mm)', 'Height (mm)', 'Pixels across', 'Pixels down', 'Left edge from screen left (mm)', 'Bottom edge from screen bottom (mm)', 'Pixel x', 'Pixel y', 'Build order', 'Data port', 'Position on port', 'Power circuit', 'Position on circuit']];
  for (const s of project.screens) {
    const c = comps[s.id]; if (!c) continue;
    const sorted = [...c.cells].sort((a, b) => a.r - b.r || a.c - b.c);
    for (const k of sorted) {
      const on = k.active;
      rows.push([s.name, `${colLetter(k.c)}${k.r + 1}`, colLetter(k.c), k.r + 1, on ? 'fitted' : 'empty', k.panel.name, k.w, k.h, k.pw, k.ph, k.x, k.y, k.px0, k.py0,
        on ? k.build : '', on && k.port >= 0 ? `${st.portPrefix || 'P'}${k.port + 1}` : '', on && k.port >= 0 ? k.seq : '',
        on && k.circ >= 0 ? `C${k.circ + 1}` : '', on && k.circ >= 0 ? k.cseq : '']);
    }
  }
  return csvText(rows);
}
async function runExport(kind) {
  try {
    if (kind === 'pdf') await exportPDF();
    else if (kind === 'layout') await exportLayoutPNG();
    else if (kind === 'plan') await exportPlanPNG();
    else if (kind === 'pixmap') await exportPixelMap();
    else if (kind === 'json') await Downloads.save(`${slug(S.project.name)}_rev${slug(S.project.revision || 'A')}.json`, JSON.stringify(S.project, null, 2));
    else if (kind === 'packing') await Downloads.save(`${slug(S.project.name)}_packing_list.csv`, new Blob([csvPackingList(S.project, S.comps, S.plan)], { type: 'text/csv;charset=utf-8' }));
    else if (kind === 'cabinets') await Downloads.save(`${slug(S.project.name)}_cabinets.csv`, new Blob([csvCabinetList(S.project, S.comps)], { type: 'text/csv;charset=utf-8' }));
  } catch (e) { console.error(e); toast(e && e.message ? e.message : 'The export failed.'); }
}

/* ---------- boot ---------- */
function start(hot) {
  applyTheme(); applyMode();
  Store.probeLocal();
  let p = null;
  if (hot && hot.project) { try { p = normalizeProject(hot.project); } catch (e) { p = null; } }
  if (!p) { const lastId = Store.localLast(); p = lastId ? Store.localLoad(lastId) : null; }
  Lib.load();
  const migrated = migratePanels();
  const fresh = !p;
  if (fresh) p = blankProject();
  setProject(p, { fresh });
  if (hot && hot.activeId && findScreen(hot.activeId)) { S.activeId = hot.activeId; S.selection = new Set([hot.activeId]); }
  bindAll();
  renderAll();
  Lib.on(onPanelsChanged);
  if (migrated) toast(`${migrated} panel${migrated === 1 ? '' : 's'} from your saved projects ${migrated === 1 ? 'is' : 'are'} now in Your panels`);
  loadSitePanels();
  View3D.init($('#view3d'));
  schedule3D(0);
  Store.onChange(updateSavePill);
  Downloads.init().then(renderExportMenu);
  Store.initCloud().then(async (ok) => {
    if (ok) {
      await syncCloudPanels();
      const last = await Store.cloudLast();
      if (last) {
        const cp = await Store.loadCloud(last);
        if (cp && S.pristine) {
          if (cp.id !== S.project.id || String(cp.updated) > String(S.project.updated)) { setProject(cp); S.lastSetId = cp.id; renderAll(); }
          else if (String(cp.updated) < String(S.project.updated)) Store.save(S.project);
        } else if (!cp && S.pristine && !S.project.example && !S.fresh) Store.save(S.project);
      } else if (!S.project.example && !S.fresh) {
        // first visit with an account: keep this browser's project there too
        Store.save(S.project); S.lastSetId = S.project.id; Store.setLast(S.project.id);
      }
    }
    updateSavePill();
  });
  if (window.claude && window.claude.hot && typeof window.claude.hot.snapshot === 'function') {
    try { window.claude.hot.snapshot(() => ({ project: S.project, activeId: S.activeId })); } catch (e) { /* optional */ }
  }
  if (document.fonts && document.fonts.ready) {
    const redraw = () => { renderStage(); renderPlan(); View3D.refresh(); schedule3D(0); };
    document.fonts.ready.then(redraw);
    if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', redraw);
  }
  window.__lwp = { S, change, undo, redo, recompute, renderAll, View3D, Store, runExport, buildPdfReport, Lib, Sheets, loadSitePanels };
}
if (window.claude && window.claude.hot && typeof window.claude.hot.ready === 'function') window.claude.hot.ready(start);
else start((window.claude && window.claude.hot && window.claude.hot.data) || {});
