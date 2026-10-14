/* ============================================================
   STORAGE — saved projects. Each signed-in viewer's projects live in
   their private db subtree (data/users/<id>/<projectId>); a copy is
   also kept in this browser so the page works offline or signed out.
   ============================================================ */

const Store = (() => {
  const LS = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };
  let db = null, uid = null, cloudOK = false, localOK = false;
  const chains = new Map();
  const listeners = new Set();
  let state = 'idle';   // idle | saving | saved | local | error | off
  let lastError = '';

  function emit() { listeners.forEach((f) => f(state, mode(), lastError)); }
  function mode() { return cloudOK ? 'cloud' : localOK ? 'local' : 'none'; }
  function setState(s, err = '') { state = s; lastError = err; emit(); }

  function probeLocal() { localOK = LS.set('lwp:probe', '1'); LS.del('lwp:probe'); return localOK; }
  function summary(p) {
    return { id: p.id, name: p.name, client: p.client || '', revision: p.revision || '', updated: p.updated, screens: p.screens.length,
      cabinets: p.screens.reduce((a, s) => { try { return a + computeScreen(p, s).count; } catch (e) { return a; } }, 0) };
  }

  /* ---- local ---- */
  function localIndex() { try { return JSON.parse(LS.get('lwp:index') || '[]'); } catch (e) { return []; } }
  function localSave(p) {
    if (!localOK) return false;
    const ok = LS.set('lwp:proj:' + p.id, JSON.stringify(p));
    if (!ok) return false;
    const idx = localIndex().filter((x) => x.id !== p.id); idx.unshift(summary(p));
    LS.set('lwp:index', JSON.stringify(idx.slice(0, 200)));
    return true;
  }
  function localLoad(id) { try { const r = LS.get('lwp:proj:' + id); return r ? normalizeProject(JSON.parse(r)) : null; } catch (e) { return null; } }
  function localRemove(id) { LS.del('lwp:proj:' + id); LS.set('lwp:index', JSON.stringify(localIndex().filter((x) => x.id !== id))); }

  /* ---- cloud ---- */
  async function initCloud() {
    probeLocal();
    if (!(window.claude && typeof window.claude.use === 'function')) { emit(); return false; }
    try {
      const [d, u] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
      if (d && u) { const id = await u.id(); if (id) { db = d; uid = id; cloudOK = true; } }
    } catch (e) { cloudOK = false; }
    emit();
    return cloudOK;
  }
  const col = () => db.collection('data/users/' + uid);
  function failCloud(e) {
    const code = e && e.code;
    if (code === 'invalid_argument' || code === 'revoked' || code === 'not_granted' || code === 'capability_disabled' || code === 'capability_removed') {
      cloudOK = false; setState(localOK ? 'local' : 'off', ''); return;
    }
    if (code === 'quota_exceeded') { setState('error', 'Your saved projects are full. Delete a few in Open, then try again.'); return; }
    setState('error', 'Could not save just now. It will try again on your next change.');
  }

  async function save(p) {
    const local = localSave(p);
    if (!cloudOK) { setState(local ? 'local' : 'off'); return; }
    setState('saving');
    const doc = Object.assign({ kind: 'project' }, summary(p), { project: p });
    const prev = chains.get(p.id) || Promise.resolve();
    const next = prev.then(() => col().doc(p.id).set(doc)).then(() => { if (cloudOK) setState('saved'); }).catch(failCloud);
    chains.set(p.id, next);
    return next;
  }

  async function list() {
    let out = [];
    if (cloudOK) {
      try {
        const snap = await col().where('kind', '==', 'project').get();
        out = snap.docs.map((d) => { const x = d.data() || {}; return { id: x.id || d.id, name: x.name, client: x.client, revision: x.revision, updated: x.updated, screens: x.screens, cabinets: x.cabinets, where: 'account' }; });
      } catch (e) { failCloud(e); }
    }
    const ids = new Set(out.map((x) => x.id));
    for (const x of localIndex()) if (!ids.has(x.id)) out.push(Object.assign({}, x, { where: 'browser' }));
    out.sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || '')));
    return out;
  }

  async function load(id) {
    if (cloudOK) {
      try {
        const d = await col().doc(id).get();
        if (d.exists) { const x = d.data(); if (x && x.project) return normalizeProject(deepClone(x.project)); }
      } catch (e) { failCloud(e); }
    }
    return localLoad(id);
  }

  async function remove(id) {
    localRemove(id);
    if (cloudOK) { try { await (chains.get(id) || Promise.resolve()); await col().doc(id).delete(); } catch (e) { failCloud(e); } }
    chains.delete(id);
  }

  async function setLast(id) {
    LS.set('lwp:last', id);
    if (!cloudOK) return;
    try { await col().doc('_settings').set({ kind: 'settings', last: id }); } catch (e) { /* not important */ }
  }
  async function cloudLast() {
    if (!cloudOK) return null;
    try { const d = await col().doc('_settings').get(); return d.exists ? ((d.data() || {}).last || null) : null; } catch (e) { return null; }
  }
  async function loadCloud(id) {
    if (!cloudOK) return null;
    try { const d = await col().doc(id).get(); if (d.exists) { const x = d.data(); if (x && x.project) return normalizeProject(deepClone(x.project)); } } catch (e) { failCloud(e); }
    return null;
  }
  function localLast() { return LS.get('lwp:last'); }

  /* ---- your panels: one list per viewer, offered in every project ---- */
  const readJSON = (k, d) => { try { const v = JSON.parse(LS.get(k) || 'null'); return v === null ? d : v; } catch (e) { return d; } };
  function localLibrary() { const a = readJSON('lwp:library', []); return Array.isArray(a) ? a : []; }
  let libChain = Promise.resolve();
  function saveLibrary(panels, { cloud = true } = {}) {
    const json = JSON.stringify(panels);
    const ok = LS.set('lwp:library', json);
    // the account copy is one document; a very long list (over ~1,000 panels) stays in this browser only
    if (!cloudOK || !cloud || json.length > 240000) return Promise.resolve(ok);
    libChain = libChain.then(() => col().doc('_library').set({ kind: 'library', panels, updated: new Date().toISOString() })).then(() => true, () => false);
    return libChain;
  }
  async function cloudLibrary() {
    if (!cloudOK) return null;
    try { const d = await col().doc('_library').get(); if (!d.exists) return null; const x = d.data() || {}; return Array.isArray(x.panels) ? x.panels : null; } catch (e) { return null; }
  }
  // the last panel list read from the site (panels.xlsx next to the planner), so it also works offline
  function siteCache() { const v = readJSON('lwp:site', null); return v && Array.isArray(v.panels) ? v : null; }
  function saveSiteCache(v) { if (v) LS.set('lwp:site', JSON.stringify(v)); else LS.del('lwp:site'); }
  // custom panels inside the projects saved in this browser (to start the list from them once)
  function localCatalogs() {
    const out = [];
    for (const x of localIndex()) { try { const r = JSON.parse(LS.get('lwp:proj:' + x.id) || 'null'); if (r && Array.isArray(r.catalog)) out.push(...r.catalog); } catch (e) { /* skip */ } }
    return out;
  }
  const flag = (k, v) => (v === undefined ? LS.get('lwp:flag:' + k) === '1' : LS.set('lwp:flag:' + k, v ? '1' : '0'));

  return { initCloud, save, list, load, loadCloud, remove, setLast, cloudLast, localLast, localLoad, probeLocal,
    localLibrary, saveLibrary, cloudLibrary, siteCache, saveSiteCache, localCatalogs, flag,
    mode, onChange: (f) => { listeners.add(f); f(state, mode(), lastError); }, get state() { return state; } };
})();

const Prefs = {
  data: { theme: 'system', mode: 'pro', grid: true, labels: true, dims: true, planMode: 'data', planDims: true, planLabels: true, face: 'cabinets', person: true, sf: null },
  load() { try { Object.assign(this.data, JSON.parse(localStorage.getItem('lwp:prefs') || '{}')); } catch (e) { /* defaults */ } return this.data; },
  save() { try { localStorage.setItem('lwp:prefs', JSON.stringify(this.data)); } catch (e) { /* ignore */ } },
};

/* ---- downloads ---- */
const Downloads = (() => {
  let ns = null, resolved = false, inViewer = false;
  async function init() {
    inViewer = !!(window.claude && typeof window.claude.use === 'function');
    if (inViewer) { try { ns = await window.claude.use('downloads'); } catch (e) { ns = null; } }
    resolved = true;
    return available();
  }
  function available() { return inViewer ? !!ns : true; }
  async function save(filename, data) {
    if (inViewer) {
      if (!ns) { toast('Downloads are not available in this view.'); return false; }
      try { await ns.save({ filename, data }); toast(`Saved ${filename}`); return true; }
      catch (e) {
        if (e && e.code === 'declined') return false;
        if (e && e.code === 'rate_limited') { toast('A save prompt is already open. Finish that one first.'); return false; }
        toast(`Could not save ${filename}${e && e.message ? ': ' + e.message : ''}`); return false;
      }
    }
    // opened outside the viewer (e.g. as a saved file): use a normal browser download
    const blob = data instanceof Blob ? data : new Blob([data]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast(`Saved ${filename}`);
    return true;
  }
  return { init, save, available, get resolved() { return resolved; } };
})();
