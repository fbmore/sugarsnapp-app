// Mirrors SugarSnappTests/RegisterModelTests.swift so the two registers can't
// drift silently. Run: node --test scripts/register-model.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import RegisterModel from "./register-model.js";

const zucchini = { id: "z1", name: "Zucchini", priceCents: 300 };

test("digits shift in as cents", () => {
  const m = new RegisterModel();
  m.tapDigit(9); m.tapDigit(5); m.tapDigit(0);
  assert.equal(m.entryCents, 950);
  assert.equal(m.grandTotal(), 950);
});

test("double zero", () => {
  const m = new RegisterModel();
  m.tapDigit(9); m.tapDoubleZero();
  assert.equal(m.entryCents, 900);
});

test("double zero is a no-op on an empty entry", () => {
  const m = new RegisterModel();
  m.tapDoubleZero();
  assert.equal(m.entryCents, 0);
});

test("multiply price by quantity", () => {
  const m = new RegisterModel();
  m.tapDigit(9); m.tapDoubleZero(); // $9.00
  m.tapMultiply(); m.tapDigit(4);   // × 4
  assert.equal(m.grandTotal(), 3600);
  const lines = m.linesForCharge();
  assert.equal(lines.length, 1);
  assert.equal(lines[0].unitCents, 900);
  assert.equal(lines[0].quantity, 4);
});

test("add combines lines", () => {
  const m = new RegisterModel();
  m.tapDigit(5); m.tapDigit(0); m.tapDigit(0); // $5.00
  m.tapAdd();
  m.tapDigit(2); m.tapDigit(5); m.tapDigit(0); // $2.50
  assert.equal(m.lines.length, 1);
  assert.equal(m.grandTotal(), 750);
  assert.equal(m.linesForCharge().length, 2);
});

test("multiply then add", () => {
  const m = new RegisterModel();
  m.tapDigit(9); m.tapDoubleZero(); m.tapMultiply(); m.tapDigit(4); // 36.00
  m.tapAdd();
  m.tapDigit(1); m.tapDoubleZero(); // + 1.00
  assert.equal(m.grandTotal(), 3700);
});

test("clear clears the entry — and no longer wipes lines on a second tap", () => {
  const m = new RegisterModel();
  m.tapDigit(5); m.tapAdd(); m.tapDigit(3);
  assert.equal(m.clear(), true);        // clears the in-flight entry
  assert.equal(m.entryCents, 0);
  assert.equal(m.lines.length, 1);

  // This used to empty the basket. Two taps of the widest key on the pad, no
  // undo, with a customer waiting — so the model now refuses and reports,
  // and the view asks before calling clearAll().
  assert.equal(m.clear(), false, "the second tap must not decide this alone");
  assert.equal(m.lines.length, 1, "the basket survives an unconfirmed tap");
  assert.equal(m.clearWouldWipeBasket(), true);
  m.clearAll();                          // what the confirmation calls
  assert.ok(m.isEmpty());
});

test("backspace in quantity returns to amount", () => {
  const m = new RegisterModel();
  m.tapDigit(5); m.tapMultiply();
  m.backspace(); // empty quantity → back to amount phase
  assert.equal(m.phase, "amount");
  assert.equal(m.entryCents, 5);
});

test("no charge when empty", () => {
  const m = new RegisterModel();
  assert.equal(m.canCharge(), false);
  assert.equal(m.linesForCharge().length, 0);
});

test("item taps multiply", () => {
  const m = new RegisterModel();
  m.addItem(zucchini); m.addItem(zucchini); m.addItem(zucchini);
  assert.equal(m.quantityOf(zucchini), 3);
  assert.equal(m.grandTotal(), 900);
  m.setQuantity(zucchini, 2);
  assert.equal(m.quantityOf(zucchini), 2);
  assert.equal(m.grandTotal(), 600);
  m.setQuantity(zucchini, 0);
  assert.equal(m.quantityOf(zucchini), 0);
  assert.ok(m.isEmpty());
  m.setQuantity(zucchini, 7);
  assert.equal(m.grandTotal(), 2100);
});

test("zero quantity falls back to one", () => {
  const m = new RegisterModel();
  m.tapDigit(5); m.tapDoubleZero(); m.tapMultiply();
  // charge without typing a quantity
  const lines = m.linesForCharge();
  assert.equal(lines[0].quantity, 1);
  assert.equal(RegisterModel.lineTotal(lines[0]), 500);
});

test("caps: amount, quantity, and their product", () => {
  const m = new RegisterModel();
  for (const d of [9, 9, 9, 9, 9, 9, 9]) m.tapDigit(d); // $99,999.99
  m.tapDigit(9); // would exceed — dropped, not clamped
  assert.equal(m.entryCents, 9999999);
  const m2 = new RegisterModel();
  m2.tapDigit(5); m2.tapDoubleZero(); m2.tapDoubleZero(); // $500.00
  m2.tapMultiply();
  m2.tapDigit(9); m2.tapDigit(9); m2.tapDigit(9); // qty 999 → over product cap at some point
  assert.ok(m2.entryCents * (m2.quantity ?? 1) <= 9999999);
});

test("web extension: removeLineAt drops one unit, then the line", () => {
  const m = new RegisterModel();
  m.addItem(zucchini); m.addItem(zucchini);
  m.removeLineAt(0);
  assert.equal(m.quantityOf(zucchini), 1);
  m.removeLineAt(0);
  assert.ok(m.isEmpty());
});

/**
 * C must not wipe a basket without asking.
 *
 * C is the widest key on the pad, and with nothing in flight it emptied the
 * whole order on one tap with no undo — one mis-reach mid-rush and a
 * twelve-line basket is gone with a customer standing there. The model now
 * reports rather than decides, so the view can ask first.
 */
test('C clears only the digits being typed, and says it handled it', () => {
  const m = new RegisterModel();
  m.addItem({ name: 'Jam', priceCents: 600 });
  m.tapDigit(5); m.tapDoubleZero();               // $5.00 in flight
  assert.equal(m.clearWouldWipeBasket(), false, 'there is an entry to clear first');
  assert.equal(m.clear(), true, 'handled');
  assert.equal(m.currentLineTotal(), 0, 'the entry went');
  assert.equal(m.lines.length, 1, 'the basket did not');
});

test('C on a basket with nothing in flight refuses to act', () => {
  const m = new RegisterModel();
  m.addItem({ name: 'Jam', priceCents: 600 });
  m.addItem({ name: 'Bread', priceCents: 450 });
  assert.equal(m.clearWouldWipeBasket(), true, 'this is the destructive case');
  assert.equal(m.clear(), false, 'the model must not decide this alone');
  assert.equal(m.lines.length, 2, 'and must not have wiped anything');
});

test('C on an empty register is a no-op that needs no confirmation', () => {
  const m = new RegisterModel();
  assert.equal(m.clearWouldWipeBasket(), false);
  assert.equal(m.clear(), true, 'nothing to lose, nothing to ask');
});

test('a quantity in flight is cleared without asking', () => {
  const m = new RegisterModel();
  m.addItem({ name: 'Jam', priceCents: 600 });
  m.tapDigit(2); m.tapDoubleZero(); m.tapMultiply(); m.tapDigit(3);
  assert.equal(m.clearWouldWipeBasket(), false, 'the quantity is what C takes');
  assert.equal(m.clear(), true);
  assert.equal(m.lines.length, 1);
});

test('clearAll still wipes — it is what the confirmation calls', () => {
  const m = new RegisterModel();
  m.addItem({ name: 'Jam', priceCents: 600 });
  m.clearAll();
  assert.equal(m.lines.length, 0);
});
