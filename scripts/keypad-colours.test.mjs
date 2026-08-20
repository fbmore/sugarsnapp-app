/**
 * The keycap is a physical object: cream cap, dark ink, whatever the light in
 * the room. Its colours must not follow the page theme.
 *
 * The bug this pins: the fill was pinned (--key-cream) while the ink came from
 * --ink, which flips to near-white in the dark theme. So the dark theme drew
 * #f2efe9 digits on a #f4ead5 cap — 1.04:1, i.e. no digits at all — and the
 * Clear key, whose background was --ink, turned white.
 *
 * Values are Theme.swift's, so the two registers are the same object.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../shop.html', import.meta.url), 'utf8');

/** Tokens the dark theme redefines — anything a keycap must NOT depend on. */
function themeFlipping() {
  const dark = html.match(/:root\[data-theme="dark"\]\{([^}]*)\}/);
  assert.ok(dark, 'dark theme block moved — update this test with the page');
  return [...dark[1].matchAll(/(--[a-z-]+)\s*:/g)].map(m => m[1]);
}

/** Every declaration inside the .keypad .key rules. */
function keypadRules() {
  return [...html.matchAll(/\.keypad \.key[^{]*\{([^}]*)\}/g)].map(m => m[1]);
}

test('no keycap colour follows the page theme', () => {
  const flips = themeFlipping();
  for (const body of keypadRules()) {
    for (const decl of body.match(/(?:background|color|border-color)\s*:\s*var\((--[a-z-]+)\)/g) || []) {
      const token = decl.match(/--[a-z-]+/)[0];
      assert.ok(!flips.includes(token),
        `keycap uses ${token}, which the dark theme redefines — that is how the digits vanished`);
    }
  }
});

test('the keycap tokens carry the app\'s exact values', () => {
  // Theme.swift: Color.keyCream, Color.keyInk, Color.vermillion, clear-key ink.
  const expected = {
    '--key-cream': '#f4ead5',
    '--key-ink': '#2b211c',
    '--key-clear-ink': '#f28c73',
    '--accent': '#d95421',
  };
  for (const [token, hex] of Object.entries(expected)) {
    const m = html.match(new RegExp(`${token}\\s*:\\s*(#[0-9a-f]{6})`, 'i'));
    assert.ok(m, `${token} is not defined`);
    assert.equal(m[1].toLowerCase(), hex, `${token} drifted from the iOS value`);
  }
});

test('the digits are legible on the cap in every theme', () => {
  const lin = c => (c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  const lum = h => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  // One number, because the colours no longer depend on the theme.
  assert.ok(ratio('#2b211c', '#f4ead5') >= 4.5,
    'dark ink on the cream cap must stay readable');
  assert.ok(ratio('#f28c73', '#2b211c') >= 3.0,
    'the C must stay readable on its dark cap');
  assert.ok(ratio('#f4ead5', '#d95421') >= 3.0,
    'the operator glyphs must stay readable on vermillion');
});
