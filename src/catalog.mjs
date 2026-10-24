import fs from 'node:fs';
import path from 'node:path';
function frontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text); if (!m) return {};
  const out = {}; let key = null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (kv) { key = kv[1]; out[key] = kv[2].replace(/^["']|["']$/g, '').replace(/^[>|][-+]?$/, ''); }
    else if (key && /^\s+\S/.test(line)) out[key] = (out[key] + ' ' + line.trim()).trim();
  }
  return out;
}
function skillFiles(root, depth, found) {
  let entries; try { entries = fs.readdirSync(root, {withFileTypes: true}); } catch { return; }
  for (const e of entries) {
    if (e.isSymbolicLink() || found.length > 2000) continue;
    const f = path.join(root, e.name);
    if (e.isDirectory() && depth > 0) skillFiles(f, depth - 1, found);
    else if (e.isFile() && e.name === 'SKILL.md') found.push(f);
  }
}
function parseFlow(file) {
  const name = path.basename(file, '.hx'), lines = fs.readFileSync(file, 'utf8').split(/\r?\n/), steps = [];
  const head = /^#\s*(.*)$/.exec(lines[0] || '')?.[1] || '';
  const m = /^(?:include\s+\S+\s+'([^']*)':\s*)?(.*)$/.exec(head);
  const hint = m?.[1] || '', description = m?.[2] || head;
  for (const line of lines) {
    const s = /^(\w[\w-]*):\s+(\w+)\b/.exec(line);
    if (s) steps.push({as: s[1], kind: s[2], quiet: false, has_digest: false});
    else if (steps.length && /^\s+quiet:\s*true/.test(line)) steps.at(-1).quiet = true;
    else if (steps.length && /^\s+digest:\s*\S/.test(line)) steps.at(-1).has_digest = true;
  }
  const args = [...new Set([...lines.join('\n').matchAll(/\{\{\$(\d+)\}\}/g)].map(x => `$${x[1]}`))];
  const invoke = `hx ${name}${hint ? ' ' + hint.split(/\s+/)[0] : args.map((_, i) => ` ARG${i + 1}`).join('')}`;
  return {kind: 'flow', name, description, invoke, args, steps};
}
export function buildCatalog(home) {
  const items = [], claude = path.join(home, '.claude');
  const files = []; skillFiles(path.join(claude, 'skills'), 2, files); const userCount = files.length;
  skillFiles(path.join(claude, 'plugins', 'cache'), 7, files);
  files.forEach((f, i) => {
    try {
      const fm = frontMatter(fs.readFileSync(f, 'utf8').slice(0, 8192)), dir = path.basename(path.dirname(f)), name = fm.name || dir;
      const plugin = i < userCount ? null : (path.relative(path.join(claude, 'plugins', 'cache'), f).split(path.sep)[1] || null);
      items.push({kind: 'skill', source: plugin ? 'plugin' : 'user', plugin, name, description: (fm.description || '').slice(0, 400), invoke: plugin ? `/${plugin}:${name}` : `/${name}`});
    } catch {}
  });
  try { for (const n of fs.readdirSync(path.join(home, '.claude-lean', 'hx.d')).filter(n => n.endsWith('.hx')).sort()) { try { items.push(parseFlow(path.join(home, '.claude-lean', 'hx.d', n))); } catch {} } } catch {}
  return {schema: 'helix.catalog.v1', items};
}
