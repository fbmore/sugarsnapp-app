#!/usr/bin/env node
/**
 * One pre-push check for anything touching the register.
 *
 * WHY THIS EXISTS: shop.html shipped `reg.total()` when the model's method is
 * `grandTotal()`. That is syntactically perfect, so `node --check` passed, and
 * it only throws when the code actually runs — which for a sheet nobody opens
 * during review means it reaches production silently. The Log payment button
 * did nothing on the live site until a second pair of eyes hit it.
 *
 * The page's script is IIFE-wrapped, so its internals cannot be poked from a
 * browser console, which pushes you toward faking a render in a test — and a
 * faked render never calls the function containing the bug. This does the
 * opposite: it loads the real model, instantiates it, and asserts that every
 * member accessed on every RegisterModel instance in the HTML actually exists.
 *
 * Instances are DISCOVERED, not hardcoded. `reg` and `gm` exist today; a third
 * one gets checked automatically the moment someone writes `new RegisterModel`.
 *
 *   node scripts/check-register-api.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODEL = path.join(root, 'scripts', 'register-model.js');
// Every scripts/*.test.mjs, discovered — a new guard should not need a code
// change here to start running before a push.
const TESTS = fs.readdirSync(path.join(root, 'scripts'))
  .filter(f => f.endsWith('.test.mjs'))
  .map(f => path.join(root, 'scripts', f))
  .sort();

/** Load the browser-shaped model into node and instantiate it. */
function loadModel() {
  const mod = { exports: {} };
  new Function('module', 'exports', fs.readFileSync(MODEL, 'utf8'))(mod, mod.exports);
  if (typeof mod.exports !== 'function') {
    console.error('register-model.js did not export a constructor.');
    process.exit(1);
  }
  return new mod.exports();
}

/** Inline <script> bodies only — markup and attributes are not code. */
function scripts(html) {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
}

/** Comments would otherwise report member names that are only ever discussed. */
function stripComments(js) {
  return js.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

let failed = false;
const instance = loadModel();
const pages = fs.readdirSync(root).filter(f => f.endsWith('.html'));

for (const page of pages) {
  const html = fs.readFileSync(path.join(root, page), 'utf8');
  const code = scripts(html).map(stripComments).join('\n');

  // Every identifier bound to a RegisterModel on this page.
  const names = [...code.matchAll(/(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+RegisterModel\b/g)]
    .map(m => m[1]);
  if (!names.length) continue;

  for (const name of names) {
    const used = [...new Set(
      [...code.matchAll(new RegExp(`\\b${name}\\.([A-Za-z_$][\\w$]*)`, 'g'))].map(m => m[1])
    )].sort();
    const missing = used.filter(k => !(k in instance) && instance[k] === undefined);

    if (missing.length) {
      failed = true;
      console.error(`\n${page}: \`${name}\` calls ${missing.length} thing(s) RegisterModel does not have:`);
      for (const k of missing) {
        // Point at the line, so the fix is obvious rather than a hunt.
        const line = html.split('\n').findIndex(l => new RegExp(`\\b${name}\\.${k}\\b`).test(l)) + 1;
        console.error(`   ${page}:${line}  ${name}.${k}`);
      }
    } else {
      console.log(`ok    ${page}: ${name} — ${used.length} member(s), all resolve`);
    }
  }
}

for (const file of TESTS) {
  const name = path.basename(file);
  const r = spawnSync('node', ['--test', file], { encoding: 'utf8' });
  const pass = (r.stdout.match(/^.\s*pass (\d+)/m) || [])[1];
  if (r.status !== 0) {
    failed = true;
    console.error(`\n${name} FAILED:\n` + r.stdout.slice(-1500));
  } else {
    console.log(`ok    ${name} — ${pass ?? '?'} passing`);
  }
}

if (failed) {
  console.error('\nA call site does not match the model. This is the class of bug that '
              + 'reaches production because it parses cleanly and only throws when run.');
  process.exit(1);
}
