/* ============================================================
   SHEETS — reads a panel list from an Excel workbook (.xlsx) or a CSV file.
   No library needed: an .xlsx file is a zip of XML parts, unpacked with the
   browser's DecompressionStream and read with DOMParser. The rows go to
   panelsFromTable() in the engine, which finds the columns.
   ============================================================ */

const Sheets = (() => {
  const NOT_A_SHEET = 'The file is not an Excel workbook (.xlsx) or a CSV file. Save it from Excel, Numbers or Google Sheets as .xlsx or .csv and import that.';

  async function inflate(bytes) {
    if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot open Excel files. Save the sheet as CSV and import that, or update the browser.');
    const out = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(out).arrayBuffer());
  }
  // the zip's central directory: name -> where the compressed part starts and how it is packed
  function zipEntries(buf) {
    const dv = new DataView(buf), n = buf.byteLength;
    let end = -1;
    for (let i = n - 22; i >= Math.max(0, n - 22 - 65535); i--) if (dv.getUint32(i, true) === 0x06054b50) { end = i; break; }
    if (end < 0) throw new Error(NOT_A_SHEET);
    const count = dv.getUint16(end + 10, true); let p = dv.getUint32(end + 16, true);
    const files = new Map(), td = new TextDecoder();
    for (let k = 0; k < count && p + 46 <= n; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const fl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
      const name = td.decode(new Uint8Array(buf, p + 46, fl)).replace(/\\/g, '/').replace(/^\/+/, '');
      files.set(name.toLowerCase(), { method: dv.getUint16(p + 10, true), size: dv.getUint32(p + 20, true), off: dv.getUint32(p + 42, true) });
      p += 46 + fl + xl + cl;
    }
    return files;
  }
  async function zipText(buf, files, name) {
    const f = files.get(name.toLowerCase()); if (!f) return null;
    const dv = new DataView(buf);
    if (f.off + 30 > buf.byteLength || dv.getUint32(f.off, true) !== 0x04034b50) throw new Error('The Excel file is damaged.');
    const start = f.off + 30 + dv.getUint16(f.off + 26, true) + dv.getUint16(f.off + 28, true);
    if (start + f.size > buf.byteLength) throw new Error('The Excel file is damaged.');
    const raw = new Uint8Array(buf, start, f.size);
    const bytes = f.method === 0 ? raw : f.method === 8 ? await inflate(raw) : null;
    if (!bytes) throw new Error('The Excel file is packed in a way this planner cannot read. Save it again as .xlsx or CSV.');
    return new TextDecoder().decode(bytes);
  }
  const xml = (t) => new DOMParser().parseFromString(t, 'application/xml');
  const all = (el, tag) => Array.from(el.getElementsByTagNameNS('*', tag));
  const colIndex = (ref) => { let c = 0; for (const ch of ref.toUpperCase()) { const k = ch.charCodeAt(0); if (k < 65 || k > 90) break; c = c * 26 + (k - 64); } return c - 1; };
  // "worksheets/sheet1.xml" next to xl/workbook.xml, or an absolute "/xl/worksheets/sheet1.xml"
  function partPath(target) {
    const parts = (target.startsWith('/') ? target.slice(1) : 'xl/' + target).split('/');
    const out = []; for (const s of parts) { if (s === '..') out.pop(); else if (s && s !== '.') out.push(s); }
    return out.join('/');
  }

  function sharedStrings(doc) {
    // rich text keeps its runs; phonetic hints (rPh) are left out
    return all(doc, 'si').map((si) => all(si, 't').filter((t) => !t.parentNode || t.parentNode.localName !== 'rPh').map((t) => t.textContent).join(''));
  }
  function sheetRows(doc, shared) {
    const rows = [];
    for (const row of all(doc, 'row')) {
      const r = parseInt(row.getAttribute('r'), 10); const ri = Number.isFinite(r) ? r - 1 : rows.length;
      if (ri < 0 || ri > 20000) continue;
      const out = [];
      for (const c of all(row, 'c')) {
        const ref = c.getAttribute('r'); const ci = ref ? colIndex(ref) : out.length;
        if (ci < 0 || ci > 255) continue;
        const t = c.getAttribute('t'); const v = all(c, 'v')[0]; const vt = v ? v.textContent : null;
        let val = null;
        if (t === 's') val = vt === null ? '' : (shared[parseInt(vt, 10)] ?? '');
        else if (t === 'inlineStr') val = all(c, 't').map((x) => x.textContent).join('');
        else if (t === 'str' || t === 'e') val = vt ?? '';
        else if (t === 'b') val = vt === '1' ? 'TRUE' : 'FALSE';
        else if (vt !== null && vt !== '') { const x = Number(vt); val = Number.isFinite(x) ? x : vt; }
        out[ci] = val;
      }
      rows[ri] = out;
    }
    return Array.from(rows, (x) => x || []);
  }
  async function workbook(buf) {
    const files = zipEntries(buf);
    const wbText = await zipText(buf, files, 'xl/workbook.xml');
    if (!wbText) throw new Error(NOT_A_SHEET);
    const wb = xml(wbText), rels = xml((await zipText(buf, files, 'xl/_rels/workbook.xml.rels')) || '<r/>');
    const target = new Map(all(rels, 'Relationship').map((r) => [r.getAttribute('Id'), r.getAttribute('Target') || '']));
    const ssText = await zipText(buf, files, 'xl/sharedStrings.xml');
    const shared = ssText ? sharedStrings(xml(ssText)) : [];
    const sheets = all(wb, 'sheet').map((s, i) => {
      const idAttr = Array.from(s.attributes).find((a) => a.localName === 'id' && a.name !== 'sheetId');
      const t = idAttr && target.get(idAttr.value);
      return { name: s.getAttribute('name') || `Sheet ${i + 1}`, path: t ? partPath(t) : `xl/worksheets/sheet${i + 1}.xml` };
    });
    return { sheets, read: async (sh) => { const t = await zipText(buf, files, sh.path); return t ? sheetRows(xml(t), shared) : []; } };
  }

  function decodeText(buf) {
    const b = new Uint8Array(buf);
    if (b[0] === 0xFF && b[1] === 0xFE) return new TextDecoder('utf-16le').decode(b.subarray(2));
    if (b[0] === 0xFE && b[1] === 0xFF) return new TextDecoder('utf-16be').decode(b.subarray(2));
    // Excel's plain "CSV" is saved in the computer's own code page (Central European on Slovenian Windows)
    try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch (e) { return new TextDecoder('windows-1250').decode(b); }
  }
  function parseCSV(text) {
    text = text.replace(/^﻿/, '');
    const first = (/^[^\r\n]*/.exec(text) || [''])[0];
    const counts = { '\t': 0, ';': 0, ',': 0 }; let q = false;
    for (const ch of first) { if (ch === '"') q = !q; else if (!q && ch in counts) counts[ch]++; }
    const sep = counts['\t'] > counts[';'] && counts['\t'] > counts[','] ? '\t' : counts[';'] > counts[','] ? ';' : ',';
    const rows = []; let row = [], cell = '', inq = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inq) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inq = false; } else cell += ch; continue; }
      if (ch === '"' && cell === '') { inq = true; continue; }
      if (ch === sep) { row.push(cell); cell = ''; continue; }
      if (ch === '\r' || ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; if (ch === '\r' && text[i + 1] === '\n') i++; continue; }
      cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    // semicolons mean decimal commas (Excel in most of Europe); otherwise go by how the numbers look
    let prefer = '.';
    if (sep === ';') prefer = ',';
    else {
      let com = 0, dot = 0;
      for (const r of rows.slice(0, 200)) for (const v of r) { if (/^\s*-?\d+,\d{1,2}\s*$/.test(v)) com++; else if (/^\s*-?\d+\.\d{1,2}\s*$/.test(v)) dot++; }
      if (com > dot) prefer = ',';
    }
    return { rows, prefer, sep };
  }

  // -> { panels, skipped: [{ row, name, reason }], header, columns, sheet, file }
  async function readPanels(blob, name = '') {
    if (blob.size > 20 * 1024 * 1024) throw new Error('The file is larger than 20 MB. A panel list should be much smaller; check that it is the right file.');
    const buf = await blob.arrayBuffer();
    const b = new Uint8Array(buf.slice(0, 4));
    if (b[0] === 0x50 && b[1] === 0x4B) {
      const wb = await workbook(buf);
      // a sheet named like a panel list first, then the others in order
      const named = (s) => (/panel|cabinet|led|screen|baza|zaslon/i.test(s.name) ? 1 : 0);
      for (const sh of [...wb.sheets].sort((x, y) => named(y) - named(x))) {
        const r = panelsFromTable(await wb.read(sh), '.');
        if (r.header) return Object.assign(r, { sheet: sh.name, file: name });
      }
      return { panels: [], skipped: [], header: false, columns: [], sheet: '', file: name };
    }
    if (b[0] === 0xD0 && b[1] === 0xCF) throw new Error('This is an old Excel file (.xls). In Excel, save it as an Excel Workbook (.xlsx) and import that.');
    const text = decodeText(buf);
    if (/^\s*</.test(text)) throw new Error(NOT_A_SHEET);
    const { rows, prefer } = parseCSV(text);
    return Object.assign(panelsFromTable(rows, prefer), { sheet: '', file: name });
  }
  return { readPanels, parseCSV };
})();
