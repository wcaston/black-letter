#!/usr/bin/env node
// Know Your Shit build: readable source -> encrypted content.enc.json.
//
// node tools/build.mjs --source source.md --config config.json \
//   --passphrase-file passphrase.txt --out . [--updated YYYY-MM-DD] [--check-only]
//
// The readable source and the passphrase never belong in the site folder.
// After writing, the build scans the site folder and refuses to finish if any
// readable guide text or the passphrase shows up in a file there.

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { webcrypto as crypto, createHash } from 'node:crypto';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return acc;
}, []));
for (const k of ['source', 'config', 'passphrase-file', 'out']) {
  if (!args[k]) { console.error(`missing --${k}`); process.exit(2); }
}

const md = readFileSync(args.source, 'utf8');
const config = JSON.parse(readFileSync(args.config, 'utf8'));
const passphrase = readFileSync(args['passphrase-file'], 'utf8').trim();
if (!passphrase) throw new Error('empty passphrase');

// ---------- parse ----------
function slugify(s) {
  return s.toLowerCase().replace(/™/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'page';
}

function parse(text) {
  const lines = text.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/);
  const root = { level: 0, children: [] };
  const stack = [root];
  let cur = null;
  const last = (node) => node.blocks[node.blocks.length - 1];
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    let m = line.match(/^(#{1,6})\s+(.*)$/);
    if (m) {
      const level = m[1].length;
      let title = m[2].trim();
      const teaser = /\s*\{teaser\}$/.test(title);
      title = title.replace(/\s*\{teaser\}$/, '').trim();
      while (stack[stack.length - 1].level >= level) stack.pop();
      const parent = stack[stack.length - 1];
      if (level !== parent.level + 1) throw new Error(`Heading "${title}" skips a level`);
      const node = { title, level, children: [], blocks: [], teaser };
      parent.children.push(node);
      stack.push(node);
      cur = node;
      continue;
    }
    if (!cur) throw new Error(`Text before the first heading: ${line}`);
    if ((m = line.match(/^(\d+)\.\s+(.*)$/))) {
      const b = last(cur);
      const item = { n: Number(m[1]), text: m[2].trim(), notes: [] };
      if (b && b.type === 'ol') b.items.push(item); else cur.blocks.push({ type: 'ol', items: [item] });
    } else if ((m = line.match(/^\s+[-*]\s+(.*)$/))) {
      const b = last(cur);
      if (b && b.type === 'ol') b.items[b.items.length - 1].notes.push(m[1].trim());
      else if (b && b.type === 'ul') b.items.push({ text: m[1].trim() });
      else cur.blocks.push({ type: 'ul', items: [{ text: m[1].trim() }] });
    } else if ((m = line.match(/^[-*]\s+(.*)$/))) {
      const b = last(cur);
      if (b && b.type === 'ul') b.items.push({ text: m[1].trim() });
      else cur.blocks.push({ type: 'ul', items: [{ text: m[1].trim() }] });
    } else if ((m = line.match(/^(\([a-z]+\))\s+(.*)$/))) {
      const b = last(cur);
      const item = { label: m[1], text: m[2].trim() };
      if (b && b.type === 'lettered') b.items.push(item); else cur.blocks.push({ type: 'lettered', items: [item] });
    } else if ((m = line.match(/^Source:\s*(.*)$/))) {
      cur.blocks.push({ type: 'source', text: m[1].trim() });
    } else {
      cur.blocks.push({ type: 'p', text: line.trim() });
    }
  }
  const clean = (node) => {
    const seen = new Set();
    for (const c of node.children) {
      if (c.children.length && c.blocks.length) throw new Error(`"${c.title}" has both sub-headings and text`);
      if (c.teaser && (c.children.length || c.blocks.length)) throw new Error(`Teaser "${c.title}" has content`);
      let slug = slugify(c.title), n = 2;
      while (seen.has(slug)) slug = `${slugify(c.title)}-${n++}`;
      seen.add(slug);
      c.slug = slug;
      delete c.level;
      if (!c.teaser) delete c.teaser;
      if (c.children.length) { delete c.blocks; clean(c); } else { delete c.children; }
    }
    return node;
  };
  return clean(root).children;
}

const tree = parse(md);
const updated = typeof args.updated === 'string' ? args.updated : new Date().toISOString().slice(0, 10);
const data = {
  title: config.title,
  updated,
  form: { action: config.form.action, fields: config.form.fields, types: config.form.types },
  children: tree,
};

// ---------- encrypt ----------
const b64 = (u8) => Buffer.from(u8).toString('base64');
const enc = new TextEncoder();
const salt = Buffer.from(config.kdf.salt, 'base64');
const iterations = config.kdf.iterations;
const material = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, material,
  { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
const iv = crypto.getRandomValues(new Uint8Array(12));
const plaintext = enc.encode(JSON.stringify(data));
const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
const payload = {
  v: 1,
  kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: config.kdf.salt },
  cipher: { name: 'AES-GCM', iv: b64(iv) },
  ct: b64(ct),
};
// Round-trip check before writing anything.
const back = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)));
if (JSON.stringify(back) !== JSON.stringify(data)) throw new Error('decrypt round-trip failed');

if (!args['check-only']) {
  writeFileSync(join(args.out, 'content.enc.json'), JSON.stringify(payload) + '\n');
  const swPath = join(args.out, 'sw.js');
  const sw = readFileSync(swPath, 'utf8');
  const version = `kys-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}-${createHash('sha256').update(payload.ct).digest('hex').slice(0, 6)}`;
  writeFileSync(swPath, sw.replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`));
  console.log(`wrote content.enc.json (${payload.ct.length} chars) and set sw.js VERSION ${version}`);
}

// ---------- leak check ----------
const snippets = new Set([passphrase]);
const walk = (nodes) => {
  for (const n of nodes) {
    if (n.title.length >= 8) snippets.add(n.title);
    for (const b of n.blocks || []) {
      for (const t of [b.text, ...(b.items || []).flatMap((i) => [i.text, ...(i.notes || [])])]) {
        if (t && t.length >= 12) snippets.add(t.slice(0, 40));
      }
    }
    if (n.children) walk(n.children);
  }
};
walk(tree);
const leaks = [];
const scan = (dir) => {
  for (const name of readdirSync(dir)) {
    if (name === '.git') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { scan(p); continue; }
    if (['.png', '.jpg', '.ico'].includes(extname(name))) continue;
    const body = readFileSync(p, 'utf8');
    for (const s of snippets) if (body.includes(s)) leaks.push(`${p}: "${s.slice(0, 30)}…"`);
  }
};
scan(args.out);
if (leaks.length) {
  console.error('READABLE TEXT FOUND IN SITE FOLDER — do not publish:\n' + leaks.join('\n'));
  process.exit(1);
}
const count = (nodes) => nodes.reduce((a, n) => a + 1 + (n.children ? count(n.children) : 0), 0);
console.log(`ok: ${count(tree)} entries, updated ${updated}, no readable text or passphrase in ${args.out}`);
