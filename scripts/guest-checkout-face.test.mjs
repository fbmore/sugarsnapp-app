/**
 * The shopper-facing half of shop.html: what the Pay button claims they owe.
 *
 * B1 — the guest keypad's in-flight amount was excluded from cartTotal, so an
 * honesty-box shopper keyed $20, saw $20 on the display, and found a DISABLED
 * "Pay $0.00" at the bottom. Nothing told them to press +. Most walk away, and
 * on an unattended stall that means the vendor is not paid at all.
 *
 * Rules are executed out of the page, never copied — a copied rule keeps
 * passing after someone edits the page, which is worse than no test.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../shop.html', import.meta.url), 'utf8');
const model = fs.readFileSync(new URL('./register-model.js', import.meta.url), 'utf8');

function grab(re, label) {
  const m = html.match(re);
  assert.ok(m, `shop.html no longer contains ${label} — update this test with the page`);
  return m[0];
}

/** Build cartTotal + guestPendingCents over a real RegisterModel. */
function build({ items = [], cart = {}, customLines = [] } = {}) {
  const mod = { exports: {} };
  new Function('module', 'exports', model)(mod, mod.exports);
  const gm = new mod.exports();
  const fn = new Function(
    'items', 'cart', 'customLines', 'gm',
    grab(/function guestPendingCents\(\)\{[\s\S]*?\n\}/, 'guestPendingCents') + '\n' +
    grab(/function cartTotal\(\)\{[\s\S]*?\n\}/, 'cartTotal') +
    '\nreturn {cartTotal, guestPendingCents};'
  )(items, cart, customLines, gm);
  return { gm, ...fn };
}

test('an amount typed on the keypad counts toward what the shopper owes', () => {
  const { gm, cartTotal } = build();
  assert.equal(cartTotal(), 0, 'nothing typed yet');
  '2000'.split('').forEach(d => gm.tapDigit(+d));   // $20.00
  assert.equal(gm.currentLineTotal(), 2000, 'the display shows $20.00');
  assert.equal(cartTotal(), 2000,
    'Pay said $0.00 while the display said $20.00 — the shopper walks away');
});

test('it adds to items and already-added custom lines rather than replacing them', () => {
  const items = [{ id: 'i1', price_cents: 300 }];
  const { gm, cartTotal } = build({ items, cart: { i1: 2 }, customLines: [{ amount_cents: 150 }] });
  assert.equal(cartTotal(), 750);
  gm.tapDigit(5); gm.tapDoubleZero();               // $5.00
  assert.equal(cartTotal(), 1250);
});

test('clearing the keypad removes it from the total again', () => {
  const { gm, cartTotal } = build();
  gm.tapDigit(9); gm.tapDoubleZero();
  assert.ok(cartTotal() > 0);
  gm.clearAll();
  assert.equal(cartTotal(), 0);
});

test('quantity entry is reflected too, not just the unit amount', () => {
  const { gm, cartTotal } = build();
  gm.tapDigit(2); gm.tapDoubleZero();               // $2.00
  gm.tapMultiply(); gm.tapDigit(3);                 // ×3
  assert.equal(cartTotal(), gm.currentLineTotal());
  assert.equal(cartTotal(), 600);
});

test('Pay commits the pending amount through the SAME floor Add enforces', () => {
  // A pending $0.50 must be refused, not quietly rounded into the order.
  const floor = html.match(/var CA_MIN\s*=\s*(\d+)/);
  assert.ok(floor, 'CA_MIN moved — this test must follow it');
  const { gm, cartTotal } = build();
  gm.tapDigit(5); gm.tapDigit(0);                   // $0.50
  assert.ok(cartTotal() < Number(floor[1]),
    'below the floor, so guestAddLine must refuse and Pay must not proceed');
  assert.match(grab(/\$\("payBtn"\)\.onclick=function\(\)\{[\s\S]*?guestPendingCents\(\)[^\n]*\n/,
                    'the Pay handler'),
               /if\(guestPendingCents\(\)>0 && !guestAddLine\(\)\) return;/,
               'Pay must stop when the pending amount is refused');
});
