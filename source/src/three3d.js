/* ============================================================
   3D VIEW — three.js r128 scene of the stage. Screens are built
   from per-column facets (flat or curved) with a canvas texture on
   the front and instanced backing boxes for cabinet depth.
   ============================================================ */

const View3D = (() => {
  let renderer = null, scene, camera, controls, root, floorGroup, person, el = null;
  let inited = false, failed = false, visible = false, dirty = true, raf = 0;
  const cache = new Map();   // screen id -> { key, group, dispose }
  let themeKey = '';
  let lastFitKey = '';
  const Y_AXIS = typeof THREE !== 'undefined' ? new THREE.Vector3(0, 1, 0) : null;

  function available() { return typeof THREE !== 'undefined' && typeof THREE.OrbitControls === 'function' && !failed; }

  function fallback(msg) {
    if (!el) return;
    el.innerHTML = `<div class="v3d-fallback"><strong>3D view unavailable</strong><span>${esc(msg)}</span></div>`;
  }

  function init(container) {
    if (inited) return true;
    el = container;
    if (!available()) { fallback('The 3D library did not load. The rest of the planner works normally.'); failed = true; return false; }
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    } catch (e) { failed = true; fallback('This browser has WebGL switched off, so the 3D view cannot draw.'); return false; }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    el.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-label', '3D view of the stage');
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(38, 1.6, 0.1, 600);
    camera.position.set(0, 5, 22);
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.09;
    controls.maxPolarAngle = Math.PI / 2 - 0.015; controls.minDistance = 1.5; controls.maxDistance = 200;
    controls.target.set(0, 2, 0);
    controls.addEventListener('change', () => { dirty = true; });
    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x1a2028, 0.85));
    const dl = new THREE.DirectionalLight(0xffffff, 0.55); dl.position.set(6, 14, 10); scene.add(dl);
    floorGroup = new THREE.Group(); scene.add(floorGroup);
    root = new THREE.Group(); scene.add(root);
    person = makePerson(); scene.add(person);
    const ro = new ResizeObserver(() => resize()); ro.observe(el);
    const io = new IntersectionObserver((ents) => { visible = ents.some((e) => e.isIntersecting); if (visible) { dirty = true; loop(); } }, { threshold: 0.01 });
    io.observe(el);
    inited = true;
    resize();
    return true;
  }

  function resize() {
    if (!renderer || !el) return;
    const w = Math.max(10, el.clientWidth), h = Math.max(10, el.clientHeight);
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
    camera.aspect = w / h; camera.updateProjectionMatrix(); dirty = true;
    if (!visible && scene) draw();
  }

  // Labels keep a fixed on-screen size, so two screens near each other can put their names on top of one
  // another. Before each frame, nearer labels keep their spot and any label that would overlap one already
  // placed moves up by a label height (up to a few steps).
  const _v = typeof THREE !== 'undefined' ? new THREE.Vector3() : null;
  function declutter() {
    camera.updateMatrixWorld();
    const P = camera.projectionMatrix.elements;
    const items = [];
    root.children.forEach((g) => {
      const sp = g.userData && g.userData.label; if (!sp) return;
      sp.getWorldPosition(_v); _v.project(camera);
      if (_v.z > 1 || _v.z < -1) { sp.center.y = 0; return; }
      items.push({ sp, x: _v.x, y: _v.y, z: _v.z, w: sp.scale.x * P[0], h: sp.scale.y * P[5] });
    });
    items.sort((a, b) => a.z - b.z);
    const taken = [];
    for (const it of items) {
      const at = (k) => ({ x0: it.x - it.w / 2, x1: it.x + it.w / 2, y0: it.y + k * it.h * 1.08, y1: it.y + k * it.h * 1.08 + it.h });
      let k = 0;
      while (k < 6 && taken.some((r) => { const b = at(k); return r.x0 < b.x1 && r.x1 > b.x0 && r.y0 < b.y1 && r.y1 > b.y0; })) k++;
      it.sp.center.y = -k * 1.08;
      taken.push(at(k));
    }
  }
  function draw() { declutter(); renderer.render(scene, camera); }

  function loop() {
    cancelAnimationFrame(raf);
    const step = () => {
      if (!visible || !renderer) return;
      const moved = controls.update();
      if (moved || dirty) { draw(); dirty = false; }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }

  function themeColors(dark) {
    return dark
      ? { bg: 0x0a1017, floor: 0x0e1822, minor: 0x18293a, major: 0x27415a, person: 0x8c9aa8, back: 0x1c232c, label: '#E3ECF4', labelBg: 'rgba(10,16,23,0.72)' }
      : { bg: 0xe6ecf2, floor: 0xd9e1e9, minor: 0xc4cfda, major: 0xa7b6c5, person: 0x6f7d8b, back: 0x2a323c, label: '#14202C', labelBg: 'rgba(255,255,255,0.82)' };
  }

  function applyTheme(dark) {
    const k = dark ? 'd' : 'l'; if (k === themeKey) return; themeKey = k;
    const c = themeColors(dark);
    scene.background = new THREE.Color(c.bg);
    scene.fog = new THREE.Fog(c.bg, 45, 140);
    floorGroup.children.slice().forEach((o) => { floorGroup.remove(o); o.geometry && o.geometry.dispose(); o.material && o.material.dispose(); });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ color: c.floor }));
    plane.rotation.x = -Math.PI / 2; plane.position.y = -0.002; floorGroup.add(plane);
    const g1 = new THREE.GridHelper(80, 80, c.minor, c.minor); g1.position.y = 0.001; floorGroup.add(g1);
    const g2 = new THREE.GridHelper(80, 16, c.major, c.major); g2.position.y = 0.002; floorGroup.add(g2);
    person.traverse((o) => { if (o.material) o.material.color.setHex(c.person); });
    cache.forEach((v) => v.dispose()); cache.clear(); root.clear();
    dirty = true;
  }

  function makePerson() {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x8c9aa8, roughness: 0.8 });
    const legGeo = new THREE.CylinderGeometry(0.065, 0.055, 0.86, 10);
    const l1 = new THREE.Mesh(legGeo, mat); l1.position.set(-0.09, 0.43, 0); g.add(l1);
    const l2 = new THREE.Mesh(legGeo, mat); l2.position.set(0.09, 0.43, 0); g.add(l2);
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.15, 0.62, 14), mat); torso.position.y = 1.17; g.add(torso);
    const armGeo = new THREE.CylinderGeometry(0.045, 0.04, 0.6, 8);
    const a1 = new THREE.Mesh(armGeo, mat); a1.position.set(-0.25, 1.15, 0); a1.rotation.z = 0.12; g.add(a1);
    const a2 = new THREE.Mesh(armGeo, mat); a2.position.set(0.25, 1.15, 0); a2.rotation.z = -0.12; g.add(a2);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 16, 12), mat); head.position.y = 1.635; g.add(head);   // top of head at 1.75 m
    return g;
  }

  function labelSprite(text, colors) {
    const c = document.createElement('canvas'); const ctx = c.getContext('2d');
    const size = 44; ctx.font = `600 ${size}px ${FONT_STACK.ui}`;
    const w = Math.ceil(ctx.measureText(text).width) + size; c.width = w; c.height = Math.round(size * 1.6);
    const x = c.getContext('2d'); x.font = `600 ${size}px ${FONT_STACK.ui}`;
    x.fillStyle = colors.labelBg; if (x.roundRect) { x.beginPath(); x.roundRect(0, 0, c.width, c.height, 12); x.fill(); } else x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = colors.label; x.textBaseline = 'middle'; x.textAlign = 'center'; x.fillText(text, c.width / 2, c.height / 2 + 2);
    const tex = new THREE.CanvasTexture(c); tex.anisotropy = 4;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true, sizeAttenuation: false }));
    const hgt = 0.034; sp.scale.set(hgt * c.width / c.height, hgt, 1); sp.renderOrder = 10;
    sp.center.set(0.5, 0);
    return sp;
  }

  function faceTexture(comp, s, face, project) {
    const maxSide = 2048;
    let tw = clamp(comp.resW, 256, maxSide), th = tw * comp.H / comp.W;
    if (th > maxSide) { th = maxSide; tw = th * comp.W / comp.H; }
    if (th < 64) { th = 64; tw = Math.min(maxSide * 2, th * comp.W / comp.H); }
    const c = document.createElement('canvas'); c.width = Math.round(tw); c.height = Math.round(th);
    const ctx = c.getContext('2d');
    if (face === 'test') drawTestCard(ctx, comp, c.width, c.height, s.name);
    else {
      const pen = new CanvasPen(ctx);
      const pal = { bg: '#000000', seam: '#06080b', path: '#FFFFFF', cellAlpha: 1, panelFill: 1 };
      drawPlan(pen, comp, { x: 0, y: 0, w: c.width, h: c.height }, { face: true, mode: face === 'data' ? 'data' : face === 'power' ? 'power' : 'cabinets', pal, fs: Math.max(12, c.height / 14), screenColor: s.color, prefix: project.settings.portPrefix });
    }
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 1;
    return tex;
  }

  function buildScreen(project, s, comp, face, colors) {
    const group = new THREE.Group();
    const disposables = [];
    const tex = faceTexture(comp, s, face, project); disposables.push(tex);
    const faceMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.5, side: THREE.FrontSide, toneMapped: false });
    disposables.push(faceMat);
    const backMat = new THREE.MeshStandardMaterial({ color: colors.back, roughness: 0.75, metalness: 0.2 }); disposables.push(backMat);
    const facets = facetTransforms(comp);
    const H = comp.H / 1000, depth = 0.085, C = comp.cols, colW = comp.colW / 1000;
    facets.forEach((f, i) => {
      const geo = new THREE.PlaneGeometry(colW, H); disposables.push(geo);
      const uv = geo.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setX(k, (i + uv.getX(k)) / C);
      uv.needsUpdate = true;
      const mesh = new THREE.Mesh(geo, faceMat);
      mesh.position.set(f.x / 1000, H / 2, f.z / 1000 + 0.002);
      mesh.rotation.y = f.yaw;
      group.add(mesh);
    });
    if (comp.count) {
      const boxGeo = new THREE.BoxGeometry(1, 1, 1); disposables.push(boxGeo);
      const inst = new THREE.InstancedMesh(boxGeo, backMat, comp.count);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), scl = new THREE.Vector3();
      let k = 0;
      for (const cell of comp.active) {
        const f = facets[cell.c] || facets[0];
        const local = new THREE.Vector3(0, (cell.y + cell.h / 2) / 1000, -depth / 2).applyAxisAngle(Y_AXIS, f.yaw).add(new THREE.Vector3(f.x / 1000, 0, f.z / 1000));
        q.setFromAxisAngle(Y_AXIS, f.yaw); scl.set(cell.w / 1000 * 0.998, cell.h / 1000 * 0.998, depth);
        m.compose(local, q, scl); inst.setMatrixAt(k++, m);
      }
      inst.instanceMatrix.needsUpdate = true;
      group.add(inst);
    }
    const label = labelSprite(s.name, colors); disposables.push(label.material.map, label.material);
    label.position.set(0, H + 0.12, 0);
    group.add(label); group.userData.label = label;
    return { group, dispose: () => disposables.forEach((d) => d && d.dispose && d.dispose()) };
  }

  function contentKey(project, s, face) {
    const used = [s.panel, s.mix && s.mix.small, s.mix && s.mix.big].map((id) => { const p = getPanel(project, id); return [p.id, p.w, p.h, p.px, p.py, p.wMax, p.wAvg]; });
    const st = project.settings;
    return JSON.stringify([s.name, s.color, s.sizeMode, s.panel, s.cols, s.rows, s.tw, s.th, s.fit, s.mix, s.shape, s.angle, s.holes, s.data, face, used,
      face === 'data' ? [st.portCapacity, st.portPrefix] : 0, face === 'power' ? [st.voltage, st.circuitAmps, st.loadFactor, st.powerFactor, st.powerBasis] : 0]);
  }

  function sync(project, comps, o) {
    if (!inited) return;
    applyTheme(o.dark);
    const colors = themeColors(o.dark);
    const ids = new Set(project.screens.map((s) => s.id));
    for (const [id, v] of cache) if (!ids.has(id)) { root.remove(v.group); v.dispose(); cache.delete(id); }
    let maxZ = 0;
    for (const s of project.screens) {
      const comp = comps[s.id]; if (!comp) continue;
      const key = contentKey(project, s, o.face);
      let entry = cache.get(s.id);
      if (!entry || entry.key !== key) {
        if (entry) { root.remove(entry.group); entry.dispose(); }
        const b = buildScreen(project, s, comp, o.face, colors);
        entry = { key, group: b.group, dispose: b.dispose };
        cache.set(s.id, entry); root.add(entry.group);
      }
      entry.group.position.set(s.x / 1000, s.y / 1000, s.z / 1000);
      entry.group.rotation.y = rad(s.yaw || 0);
      maxZ = Math.max(maxZ, (s.z || 0) / 1000 + (comp.curve && comp.curve.shape === 'concave' ? comp.curve.depth / 1000 : 0));
    }
    person.visible = !!o.person;
    person.position.set(1.2, 0, maxZ + 2.2);
    const fitKey = project.id + '|' + project.screens.length;
    if (fitKey !== lastFitKey) { lastFitKey = fitKey; fit('persp'); }
    dirty = true;
    if (!visible) { controls.update(); draw(); }
  }

  function fit(view = 'persp') {
    if (!inited) return;
    const box = new THREE.Box3();
    root.updateMatrixWorld(true);
    root.children.forEach((g) => g.children.forEach((ch) => { if (ch.isMesh && !ch.isInstancedMesh) box.expandByObject(ch); }));
    if (box.isEmpty()) box.set(new THREE.Vector3(-4, 0, -1), new THREE.Vector3(4, 3, 1));
    box.min.y = Math.min(box.min.y, 0);
    const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const fov = rad(camera.fov), aspect = camera.aspect;
    const distH = (size.x / 2) / Math.tan(Math.atan(Math.tan(fov / 2) * aspect));
    const distV = (size.y / 2) / Math.tan(fov / 2);
    const d = Math.max(distH, distV) * 1.22 + size.z / 2 + 1;
    controls.target.copy(c);
    if (view === 'top') camera.position.set(c.x, c.y + d * 1.1, c.z + 0.01);
    else if (view === 'front') camera.position.set(c.x, c.y, c.z + d);
    else camera.position.set(c.x + d * 0.32, c.y + d * 0.26, c.z + d * 0.93);
    camera.near = Math.max(0.05, d / 200); camera.far = Math.max(300, d * 8); camera.updateProjectionMatrix();
    controls.update(); dirty = true;
  }

  function snapshot(w = 1800, h = 1000) {
    if (!inited || !renderer) return null;
    const size = renderer.getSize(new THREE.Vector2()); const pr = renderer.getPixelRatio();
    const asp = camera.aspect;
    renderer.setPixelRatio(1); renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    draw();
    let url = null; try { url = renderer.domElement.toDataURL('image/jpeg', 0.9); } catch (e) { url = null; }
    renderer.setPixelRatio(pr); renderer.setSize(size.x, size.y, false);
    renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
    camera.aspect = asp; camera.updateProjectionMatrix(); draw();
    return url;
  }

  function refresh() { if (!inited) return; cache.forEach((v) => { root.remove(v.group); v.dispose(); }); cache.clear(); dirty = true; }
  return { init, sync, fit, snapshot, refresh, isReady: () => inited && !failed, invalidate: () => { dirty = true; } };
})();
