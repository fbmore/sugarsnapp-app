/**
 * createSale's failure paths, exercised for real.
 *
 * WHY: the sales row is written before its lines. When the second write fails
 * the row is a phantom on the vendor's ledger, and the old copy told them
 * "it's safe to retry" — which rings the sale twice and inflates the day.
 *
 * The cleanup cannot always run: the usual cause of the second write failing
 * is lost signal, and then the DELETE has no signal either. So what matters is
 * that the two outcomes are DISTINGUISHABLE, and this pins that. The function
 * is pulled out of shop.html rather than copied, so it cannot drift.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../shop.html', import.meta.url), 'utf8');
const src = html.match(/function createSale\(extra\)\{[\s\S]*?\n\}/);
assert.ok(src, 'createSale no longer matches — update this test with the page');

/** Build createSale over a scripted authRest. Returns [fn, calls]. */
function build(script) {
  const calls = [];
  const authRest = (path, opts) => {
    calls.push({ path, method: (opts && opts.method) || 'GET' });
    const step = script.shift();
    if (step === 'throw') return Promise.reject(new Error('offline'));
    return Promise.resolve({ ok: step, json: () => Promise.resolve([{ id: 'S1', total_cents: 700 }]) });
  };
  const fn = new Function(
    'authRest', 'syncTape', 'tapeTotal', 'getSession', 'saleLinesBody',
    src[0] + '\nreturn createSale;'
  )(authRest, () => {}, () => 700, () => ({ user_id: 'U1' }), () => []);
  return [fn, calls];
}

test('the happy path returns the sale', async () => {
  const [createSale] = build([true, true]);
  assert.equal((await createSale({ status: 'paid' })).id, 'S1');
});

test('lines fail, cleanup succeeds → retry really is safe', async () => {
  const [createSale, calls] = build([true, false, true]);
  const err = await createSale({ status: 'paid' }).then(() => null, e => e);
  assert.equal(err.clean, true, 'nothing was left behind, so the caller may say "safe to retry"');
  const del = calls.find(c => c.method === 'DELETE');
  assert.ok(del, 'the dangling sale must be deleted');
  assert.match(del.path, /status=neq\.paid/, 'never delete a sale that actually settled');
});

test('lines fail and the cleanup ALSO fails → the caller must not say "safe"', async () => {
  // The realistic dead-zone case: no signal for either request.
  const cases = {
    'lines !ok, delete !ok': [true, false, false],
    'lines REJECT (real dead zone), delete !ok': [true, 'throw', false],
    'lines REJECT, delete REJECTS': [true, 'throw', 'throw'],
    'lines !ok, delete REJECTS': [true, false, 'throw'],
  };
  for (const [name, script] of Object.entries(cases)) {
    const [createSale] = build([...script]);
    const err = await createSale({ status: 'paid' }).then(() => null, e => e);
    assert.equal(err.clean, false,
      `${name}: a possibly-orphaned sales row must be reported as such`);
  }
});

test('a failure creating the sale at all is clean — nothing was written', async () => {
  const [createSale, calls] = build([false]);
  const err = await createSale({ status: 'paid' }).then(() => null, e => e);
  assert.equal(err.clean, true);
  assert.ok(!calls.some(c => c.method === 'DELETE'), 'nothing to clean up');
});

test('both callers distinguish the two outcomes', () => {
  // A cleanup that works is worthless if the copy says the same thing anyway.
  const halfRecorded = html.match(/may be half-recorded/g) || [];
  assert.equal(halfRecorded.length, 2, 'both the Charge and Log payment paths must warn');
  assert.ok(!/regError\("No signal[^"]*safe to retry/.test(html),
    'no caller may claim "safe to retry" unconditionally');
});
