import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'claude');
const files = fs.readdirSync(root, {recursive: true}).map(f => path.join(root, f)).filter(f => fs.statSync(f).isFile());
const kind = f => {
  const head = fs.readFileSync(f, 'utf8').split('\n', 1)[0];
  if (/\.py$/.test(f) || /^#!.*python/.test(head)) return 'py';
  if (/\.(mjs|js|cjs)$/.test(f) || /^#!.*node/.test(head)) return 'js';
  if (/^#!.*zsh/.test(head)) return 'zsh';
  if (/\.sh$/.test(f) || /^#!.*\b(ba)?sh\b/.test(head)) return 'sh';
};
const check = {
  js: f => ['node', ['--check', f]],
  py: f => ['python3', ['-c', 'import sys;compile(open(sys.argv[1]).read(),sys.argv[1],"exec")', f]],
  zsh: f => ['zsh', ['-n', f]],
  sh: f => [fs.readFileSync(f, 'utf8').startsWith('#!/bin/bash') ? 'bash' : 'sh', ['-n', f]],
};

test('claude/ scripts pass syntax checks', () => {
  let n = 0;
  for (const f of files) {
    const k = kind(f); if (!k) continue;
    let [cmd, args] = check[k](f);
    if (k === 'js' && !f.endsWith('.mjs') && !f.endsWith('.cjs')) {   // extensionless: node --check needs stdin to honor detection
      const r = spawnSync('node', ['--check', '--input-type=commonjs', '-'], {input: fs.readFileSync(f, 'utf8').replace(/^#!.*\n/, ''), encoding: 'utf8'});
      const esm = spawnSync('node', ['--check', '--input-type=module', '-'], {input: fs.readFileSync(f, 'utf8').replace(/^#!.*\n/, ''), encoding: 'utf8'});
      assert.ok(r.status === 0 || esm.status === 0, `${f}: ${r.stderr}${esm.stderr}`); n++; continue;
    }
    const r = spawnSync(cmd, args, {encoding: 'utf8'});
    assert.equal(r.status, 0, `${path.relative(root, f)}: ${r.stderr}`); n++;
  }
  assert.ok(n >= 20, `only ${n} scripts checked`);
});

test('claude/ has no personal paths or email addresses', () => {
  for (const f of files) {
    const t = fs.readFileSync(f, 'utf8');
    for (const re of [/\/Users\//, /\/private\/tmp/, /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/])
      assert.ok(!re.test(t), `${path.relative(root, f)} matches ${re}`);
  }
});

test('claude/bin/hx -h runs', () => {
  const r = spawnSync(path.join(root, 'bin', 'hx'), ['-h'], {encoding: 'utf8'});
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /hx/);
});
