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

const msgSrc = html.match(/function writeFailureMessage\(e,verb\)\{[\s\S]*?\n\}/);
assert.ok(msgSrc, 'writeFailureMessage no longer matches — update this test with the page');
const writeFailureMessage = new Function(msgSrc[0] + '\nreturn writeFailureMessage;')();

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

test('both callers route their failure through the one shared rule', () => {
  // A cleanup that works is worthless if the copy says the same thing anyway.
  // The two call sites used to carry duplicate ternaries; they now share
  // writeFailureMessage, so the invariant is that neither hand-writes copy.
  // Match to the end of the statement, not the first ')': the argument is
  // itself a call, and a lazy pattern truncated it into a false failure.
  const callers = [...html.matchAll(/regError\((.*?)\);/g)].map(m => m[1].trim());
  assert.ok(callers.length >= 2, 'expected the Charge and Log payment callers');
  for (const arg of callers) {
    assert.match(arg, /^(writeFailureMessage\(e,"[a-z]+"\)|msg)$/,
      `regError(${arg}) hand-writes copy instead of using the shared rule`);
  }
  assert.doesNotMatch(html, /regError\("No signal/,
    'no caller may hard-code "No signal" — that was the bug');
});


/**
 * B7 — every register write failure used to read "No signal", whatever had
 * happened. An expired session, an RLS refusal and a 500 have different fixes,
 * and sending a vendor mid-market to check a connection that is working sends
 * them to fix the wrong thing.
 */
test('a dead zone still reads as a dead zone', () => {
  const m = writeFailureMessage({ clean: true }, 'logged');
  assert.match(m, /No signal/);
  assert.match(m, /safe to retry/, 'nothing was written, so retrying is genuinely safe');
});

test('an invalid session says so, and does not blame the connection', () => {
  for (const http of [401, 403]) {
    const m = writeFailureMessage({ clean: true, http }, 'logged');
    assert.doesNotMatch(m, /No signal/, `${http} is not a connectivity problem`);
    assert.match(m, /[Ss]ign in again/, 'name the actual fix');
    assert.doesNotMatch(m, /safe to retry/, 'retrying without signing in just fails again');
  }
});

test('a server fault is distinguishable and retryable', () => {
  const m = writeFailureMessage({ clean: true, http: 500 }, 'created');
  assert.match(m, /500/, 'carry the code so a support conversation has something to go on');
  assert.match(m, /safe to retry/);
  assert.doesNotMatch(m, /No signal/);
});

test('a refusal says nothing was recorded, and does not invite a retry', () => {
  const m = writeFailureMessage({ clean: true, http: 400 }, 'created');
  assert.match(m, /refused/);
  assert.match(m, /[Nn]othing was recorded/);
  assert.doesNotMatch(m, /safe to retry/, 'the same request will be refused again');
});

test('the half-recorded warning outranks every other cause', () => {
  // It changes what the vendor should DO — check before retrying — so it must
  // survive whatever else went wrong.
  for (const e of [{ clean: false }, { clean: false, http: 500 }, { clean: false, http: 403 }]) {
    const m = writeFailureMessage(e, 'logged');
    assert.match(m, /half-recorded/, `lost for ${JSON.stringify(e)}`);
    assert.match(m, /check today's sales/i);
    assert.doesNotMatch(m, /safe to retry/, 'it is precisely NOT safe to retry');
  }
});
