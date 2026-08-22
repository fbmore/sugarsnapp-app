/**
 * The web visible-rails editor must never delete what it did not show.
 *
 * iOS curates all fourteen rails; account.html can only offer the four the web
 * registers honour today. Two ways that asymmetry turned into data loss:
 *
 *   1. saveRails filtered the stored list purely on what was ticked, so a rail
 *      the editor never rendered (Check, Trade — curated in the app) was
 *      deleted by saving any unrelated change here.
 *   2. loadRails defaulted an uncurated vendor to cash alone while the register
 *      on the same page defaults to cash plus connected rails, so opening the
 *      editor and pressing Save without changing anything dropped Venmo.
 *
 * Both are the same mistake: an editor that renders a subset and writes as if
 * it were the whole set. Rules are pulled from the page, not copied.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../account.html', import.meta.url), 'utf8');

function grab(re, label) {
  const m = html.match(re);
  assert.ok(m, `account.html no longer contains ${label} — update this test with the page`);
  return m[0];
}
// account.html inherits PROC_NAMES from ss-core.js — take it from there, so
// the rail list under test is the one the page actually loads.
const core = fs.readFileSync(new URL('./ss-core.js', import.meta.url), 'utf8');
const coreMatch = core.match(/var PROC_NAMES=\{[^}]*\};/);
assert.ok(coreMatch, 'ss-core.js no longer defines PROC_NAMES');
const PROC_NAMES_FOR_TEST = new Function(coreMatch[0] + '\nreturn PROC_NAMES;')();

const { RAIL_NOT_CURATABLE, WEBHOOK_VERIFIED_RAIL } = new Function(
  grab(/var RAIL_NOT_CURATABLE=\{[\s\S]*?\};/, 'RAIL_NOT_CURATABLE') + '\n' +
  grab(/var WEBHOOK_VERIFIED_RAIL=\{[^}]*\};/, 'WEBHOOK_VERIFIED_RAIL') +
  '\nreturn {RAIL_NOT_CURATABLE, WEBHOOK_VERIFIED_RAIL};'
)();

/**
 * Drive the REAL saveRails out of the page.
 *
 * The first version of this test re-implemented the ordering rule here, and
 * consequently passed with the bug reinstated — a guard that cannot fail is
 * worse than none, because it manufactures confidence. Everything below now
 * executes the page's own source over stubs.
 */
const saveRailsSrc = grab(/function saveRails\(\)\{[\s\S]*?\n\}/, 'saveRails');

function save(stored, ticked) {
  let written = null;
  const boxes = Object.keys(PROC_NAMES_FOR_TEST)
    .filter(r => !RAIL_NOT_CURATABLE[r])
    .map(r => ({
      checked: ticked.includes(r) || r === 'cash',
      getAttribute: () => r,
    }));
  const el = { querySelectorAll: () => boxes, style: {}, textContent: '', disabled: false };
  const ctx = new Function(
    'PROC_NAMES', 'RAIL_NOT_CURATABLE', 'getSession', '$', 'authRest',
    'renderRails', 'flash', 'show', 'encodeURIComponent', 'capture',
    `let railsOrder = ${JSON.stringify(stored)};
     ${saveRailsSrc}
     return saveRails;`
  )(
    PROC_NAMES_FOR_TEST, RAIL_NOT_CURATABLE,
    () => ({ user_id: 'U1' }),
    () => el,
    (_path, opts) => { written = JSON.parse(opts.body).visible_rails; return Promise.resolve({ ok: true }); },
    () => {}, () => {}, () => {}, encodeURIComponent, null
  );
  ctx();
  assert.ok(written !== null, 'saveRails did not issue a write');
  return written.split(',');
}

test('a rail this editor does not RENDER survives a save from the web', () => {
  // The invariant, not the rail list: an editor may only remove what it showed
  // the person. It used to be Check and Trade that this protected, while the
  // 1.4 hold kept them off this page; now the editor shows those, so the two
  // it still hides are the ones that would be silently deleted.
  const after = save(['cash', 'venmo', 'tap_to_pay', 'ebt'], ['cash', 'venmo']);
  assert.ok(after.includes('tap_to_pay'), 'tap_to_pay was deleted by an editor that never showed it');
  assert.ok(after.includes('ebt'), 'EBT was deleted by an editor that never showed it');
});

test('a rail the editor now DOES show can be removed by un-ticking it', () => {
  // The other half of the same rule, and the reason the hidden list could
  // shrink safely: once Check is on screen, leaving it unticked is a decision.
  const after = save(['cash', 'venmo', 'check', 'trade'], ['cash', 'venmo']);
  assert.ok(!after.includes('check'), 'Check is rendered now, so un-ticking must remove it');
  assert.ok(!after.includes('trade'), 'Trade is rendered now, so un-ticking must remove it');
});

test('un-ticking a rail the editor DOES show still removes it', () => {
  const after = save(['cash', 'venmo', 'paypal'], ['cash', 'venmo']);
  assert.ok(!after.includes('paypal'), 'the editor must still be able to remove what it rendered');
});

test('the vendor\'s own order is preserved, new rails append', () => {
  const after = save(['cash', 'paypal', 'venmo'], ['cash', 'paypal', 'venmo', 'stripe']);
  assert.deepEqual(after, ['cash', 'paypal', 'venmo', 'stripe']);
});

test('cash cannot be removed', () => {
  assert.ok(save(['cash', 'venmo'], ['venmo']).includes('cash'));
});

test('the editor never offers a rail the registers refuse', () => {
  // Only the display-only pair now. tap_to_pay is a device capability rather
  // than a shortlist entry; EBT goes through its own token flow.
  for (const rail of ['tap_to_pay', 'ebt']) {
    assert.ok(RAIL_NOT_CURATABLE[rail], `${rail} must not be tickable while the registers won't offer it`);
  }
  for (const rail of ['cash', 'venmo', 'paypal', 'stripe',
                      'check', 'zelle', 'cashapp', 'apple_cash',
                      'bank_transfer', 'trade', 'comped', 'other']) {
    assert.ok(!RAIL_NOT_CURATABLE[rail], `${rail} should be curatable now that 1.4 is live`);
  }
});

test('the webhook-verified set matches the registers', () => {
  // Drift here changes what an uncurated vendor gets by default.
  assert.deepEqual(Object.keys(WEBHOOK_VERIFIED_RAIL).sort(), ['stripe', 'tap_to_pay']);
});
