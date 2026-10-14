/* ============================================================
   STORAGE — saved projects. On the planner's own server (api/ next to
   index.html, see NAS.md) they live in its MariaDB database, shared by
   everyone who signs in with the planner password. In Claude, each
   signed-in viewer's projects live in their private db subtree
   (data/users/<id>/<projectId>). A copy is always kept in this browser
   so the page works offline or signed out.
   ============================================================ */

/* the planner's own server: the same document calls as the artifact database, over its PHP API */
const Server = (() => {
  async function call(a, { query = {}, body } = {}) {
    const res = await fetch(`api/index.php?${new URLSearchParams(Object.assign({ a }, query))}`, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: Object.assign({ 'X-LED-Planner': '1' }, body === undefined ? {} : { 'Content-Type': 'application/json' }),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* not the planner's API */ }
    if (!data || data.planner !== 'led') throw Object.assign(new Error('no planner server here'), { code: 'absent' });
    if (!data.ok) throw Object.assign(new Error(data.message || data.error), { code: data.error, status: res.status });
    return data;
  }
  const db = {
    collection() {
      return {
        doc: (id) => ({
          async get() { const r = await call('get', { query: { id } }); return { exists: !!r.exists, data: () => r.doc }; },
          set: (doc) => call('set', { body: { id, doc } }),
          delete: () => call('del', { body: { id } }),
        }),
        where: () => ({ async get() { const r = await call('list'); return { docs: r.docs.map((d) => ({ id: d.id, data: () => d.data })) }; } }),
      };
    },
  };
  return { call, db };
})();

const Store = (() => {
  const LS = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };
  let db = null, uid = null, cloudOK = false, localOK = false;
  let where = '';            // 'server' (the planner's own) or 'claude' (the artifact database), once found
  let needsLogin = false;    // the server is there, and this browser has not signed in
  let serverError = '';      // the server is there but not set up (its message)
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

  /* ---- cloud: the planner's own server, else the artifact database ---- */
  async function initCloud() {
    probeLocal();
    if (await initServer()) { emit(); return true; }
    if (where === 'server' || !(window.claude && typeof window.claude.use === 'function')) { emit(); return false; }
    try {
      const [d, u] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
      if (d && u) { const id = await u.id(); if (id) { db = d; uid = id; cloudOK = true; where = 'claude'; } }
    } catch (e) { cloudOK = false; }
    emit();
    return cloudOK;
  }
  function useServer() { db = Server.db; uid = 'shared'; cloudOK = true; needsLogin = false; serverError = ''; where = 'server'; }
  async function initServer() {
    if (!/^https?:$/.test(location.protocol)) return false;
    try {
      const r = await Server.call('me');
      where = 'server';
      if (!r.signedIn) { needsLogin = true; return false; }
      useServer(); return true;
    } catch (e) {
      if (e.code === 'absent') return false;
      where = 'server'; serverError = e.message || 'error'; return false;
    }
  }
  // the shared password; throws with the server's answer (code: password, locked, setup, db)
  async function login(password) {
    await Server.call('login', { body: { password } });
    useServer(); emit();
    return true;
  }
  async function logout() {
    try { await Server.call('logout', { body: {} }); } catch (e) { /* signed out here anyway */ }
    cloudOK = false; needsLogin = true; emit();
  }
  const col = () => db.collection('data/users/' + uid);
  function failCloud(e) {
    const code = e && e.code;
    if (code === 'invalid_argument' || code === 'revoked' || code === 'not_granted' || code === 'capability_disabled' || code === 'capability_removed') {
      cloudOK = false; setState(localOK ? 'local' : 'off', ''); return;
    }
    // the server's sign-in ran out (after 30 days, or a new password): keep working in this browser, ask to sign in again
    if (code === 'login') { cloudOK = false; needsLogin = true; setState(localOK ? 'local' : 'off', ''); return; }
    if (code === 'quota_exceeded') { setState('error', tr('Your saved projects are full. Delete a few in Open, then try again.')); return; }
    setState('error', tr('Could not save just now. It will try again on your next change.'));
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

  // the last project opened stays per browser on a shared server: one person opening a project does not move everyone else
  async function setLast(id) {
    LS.set('lwp:last', id);
    if (!cloudOK || where === 'server') return;
    try { await col().doc('_settings').set({ kind: 'settings', last: id }); } catch (e) { /* not important */ }
  }
  async function cloudLast() {
    if (!cloudOK || where === 'server') return null;
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

  // projects booked for any day from..to (server only): their summaries with the project inside
  async function booked(from, to) { const r = await Server.call('booked', { query: { from, to } }); return r.docs.map((d) => d.data); }

  return { initCloud, login, logout, booked, save, list, load, loadCloud, remove, setLast, cloudLast, localLast, localLoad, probeLocal,
    get where() { return where; }, get needsLogin() { return needsLogin; }, get serverError() { return serverError; },
    localLibrary, saveLibrary, cloudLibrary, siteCache, saveSiteCache, localCatalogs, flag,
    mode, onChange: (f) => { listeners.add(f); f(state, mode(), lastError); }, get state() { return state; } };
})();

const Prefs = {
  data: { theme: 'system', mode: 'pro', grid: true, labels: true, dims: true, planMode: 'data', planDims: true, planLabels: true, face: 'cabinets', person: true, sf: null, lang: null },
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
      if (!ns) { toast(tr('Downloads are not available in this view.')); return false; }
      try { await ns.save({ filename, data }); toast(tr('Saved {name}', { name: filename })); return true; }
      catch (e) {
        if (e && e.code === 'declined') return false;
        if (e && e.code === 'rate_limited') { toast(tr('A save prompt is already open. Finish that one first.')); return false; }
        toast(tr('Could not save {name}', { name: filename }) + (e && e.message ? ': ' + e.message : '')); return false;
      }
    }
    // opened outside the viewer (e.g. as a saved file): use a normal browser download
    const blob = data instanceof Blob ? data : new Blob([data]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast(tr('Saved {name}', { name: filename }));
    return true;
  }
  return { init, save, available, get resolved() { return resolved; } };
})();
