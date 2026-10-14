#!/usr/bin/env node
/* Checks the translations. Every text the planner shows goes through tr, trc, trn or trnc (or kindDef
   for the screen types) in source/src, or is the fixed text of shell.html; each language file
   (lang-sl.js) needs an entry for it, with the same {placeholders}, and four plural forms in Slovenian.
   Also reports entries nothing uses any more, duplicates, and double quotes, which would break the
   HTML attributes some texts go into.

   Run from anywhere:  node source/check-lang.js
   Prints what is wrong and exits with 1, or prints a summary and exits with 0. */
const fs = require('fs'), path = require('path'), vm = require('vm');

const SRC = path.join(__dirname, 'src');
const JS = ['engine.js', 'sheets.js', 'pens.js', 'draw.js', 'three3d.js', 'storage.js', 'pdf.js', 'ui.js'];
const PLURAL_FORMS = { sl: 4 };

// index just after the string or template literal that starts at i
function skipString(src, i) {
  const q = src[i];
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === '\\') { j++; continue; }
    if (src[j] === q) return j + 1;
    if (q === '`' && src[j] === '$' && src[j + 1] === '{') j = skipBraces(src, j + 1) - 1;
  }
  return src.length;
}
// index just after the } that closes the { at i
function skipBraces(src, i) {
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const ch = src[j];
    if (ch === "'" || ch === '"' || ch === '`') { j = skipString(src, j) - 1; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return j + 1;
  }
  return src.length;
}
// the arguments of the call whose ( is just before i, as source text split at the top-level commas
function callArgs(src, i) {
  const out = [];
  let depth = 0, start = i, j = i;
  for (; j < src.length; j++) {
    const ch = src[j];
    if (ch === "'" || ch === '"' || ch === '`') { j = skipString(src, j) - 1; continue; }
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) { if (depth === 0) break; depth--; }
    else if (ch === ',' && depth === 0) { out.push(src.slice(start, j).trim()); start = j + 1; }
  }
  out.push(src.slice(start, j).trim());
  return out;
}
// the value of a plain '...' or "..." literal, else undefined
function literal(code) {
  if (!/^(['"])(?:\\.|(?!\1).)*\1$/s.test(code || '')) return undefined;
  return vm.runInNewContext(code);
}

/* ---- what the sources ask for ---- */
const used = new Map();   // key -> { plural, where }: needs a translation
const known = new Set();  // every key the sources mention, fallbacks included
const dynamic = [];
const use = (key, plural, where) => { known.add(key); if (!used.has(key)) used.set(key, { plural, where }); };
for (const f of JS) {
  const src = fs.readFileSync(path.join(SRC, f), 'utf8');
  for (const m of src.matchAll(/(?<![\w$.])(tr|trc|trn|trnc|kindDef)\(/g)) {
    const a = callArgs(src, m.index + m[0].length), where = `${f}:${src.slice(0, m.index).split('\n').length}`;
    // the functions' own definitions, getters named tr, and examples in comments ("trn()") are not calls
    if (!a[0] || /(function|get)\s+$/.test(src.slice(Math.max(0, m.index - 9), m.index))) continue;
    const fn = m[1], lit = a.map(literal);
    if (fn === 'tr' || fn === 'kindDef') { if (lit[0] !== undefined) use(lit[0], false, where); else dynamic.push(`${where} ${fn}(${a[0]})`); }
    // trc and trnc fall back to the plain text when the language has no entry for the context
    else if (fn === 'trc') { if (lit[0] !== undefined && lit[1] !== undefined) { use(`${lit[0]}::${lit[1]}`, false, where); known.add(lit[1]); } else dynamic.push(`${where} trc(${a.slice(0, 2).join(', ')})`); }
    else if (fn === 'trn') { if (lit[1] !== undefined) use(lit[1], true, where); else dynamic.push(`${where} trn(${a.slice(0, 2).join(', ')})`); }
    else if (fn === 'trnc') { if (lit[0] !== undefined && lit[2] !== undefined) { use(`${lit[0]}::${lit[2]}`, true, where); known.add(lit[2]); } else dynamic.push(`${where} trnc(...)`); }
  }
}
// shell.html: the text between tags and the title, aria-label and placeholder attributes (not the icon sprite)
const shell = fs.readFileSync(path.join(SRC, 'shell.html'), 'utf8').replace(/<svg[^>]*>\s*<defs>[\s\S]*?<\/svg>/, '');
for (const m of shell.matchAll(/(?:title|aria-label|placeholder)="([^"]+)"/g)) use(m[1], false, 'shell.html');
for (const m of shell.matchAll(/>([^<>]+)</g)) { const t = m[1].trim(); if (/[A-Za-z]/.test(t)) use(t, false, 'shell.html'); }

/* ---- what each language file has ---- */
const engine = fs.readFileSync(path.join(SRC, 'engine.js'), 'utf8');
const files = fs.readdirSync(SRC).filter((f) => /^lang-\w+\.js$/.test(f));
const DICT = vm.runInNewContext(`${engine}\n${files.map((f) => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n')}\n;DICT`, { console });
const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const problems = [];
for (const f of files) {
  const lang = f.slice(5, -3), dict = DICT[lang] || {}, forms = PLURAL_FORMS[lang] || 2;
  // the same key twice in the file: the later one silently wins
  const seen = new Map(), text = fs.readFileSync(path.join(SRC, f), 'utf8');
  for (const m of text.matchAll(/^\s*('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")\s*:/gm)) { const k = literal(m[1]); seen.set(k, (seen.get(k) || 0) + 1); }
  for (const [k, n] of seen) if (n > 1) problems.push(`${f}: ${JSON.stringify(k)} is in the file ${n} times`);
  for (const [key, u] of used) {
    const ctx = key.includes('::'), en = ctx ? key.split('::')[1] : key;
    const v = dict[key] !== undefined ? dict[key] : ctx ? dict[en] : undefined;
    if (v === undefined) { problems.push(`${f}: no translation for ${JSON.stringify(key)}${ctx ? ` or ${JSON.stringify(en)}` : ''} (${u.where})`); continue; }
    if (u.plural) {
      if (!Array.isArray(v) || v.length !== forms) problems.push(`${f}: ${JSON.stringify(key)} needs a list of ${forms} plural forms (${u.where})`);
      else for (const form of v) if (placeholders(form) !== placeholders(en)) problems.push(`${f}: placeholders of ${JSON.stringify(key)} differ in ${JSON.stringify(form)}`);
    } else if (typeof v !== 'string') problems.push(`${f}: ${JSON.stringify(key)} should be text, not a list (${u.where})`);
    else if (placeholders(v) !== placeholders(en)) problems.push(`${f}: placeholders of ${JSON.stringify(key)} differ in ${JSON.stringify(v)}`);
  }
  for (const [k, v] of Object.entries(dict)) {
    if (!known.has(k)) problems.push(`${f}: ${JSON.stringify(k)} is not used anywhere`);
    if ([].concat(v).some((x) => String(x).includes('"'))) problems.push(`${f}: the translation of ${JSON.stringify(k)} contains a double quote; use „ “ instead`);
  }
}

if (problems.length) { console.log(problems.join('\n')); process.exit(1); }
console.log(`${used.size} texts, all translated in ${files.join(', ')}.`);
console.log(`Built at run time, not checked here (they are covered by the rest): ${dynamic.join('; ')}`);
