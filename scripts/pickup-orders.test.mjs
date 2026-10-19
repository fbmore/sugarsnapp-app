// Run: node --test scripts/pickup-orders.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import P from "./pickup-orders.js";

const o = (n, extra) => ({ id: "s" + n, order_number: n, status: "paid", processor: "stripe",
  created_at: `2026-10-18T15:${String(n).padStart(2, "0")}:00Z`, ...extra });

test("queue is oldest first and split by ready", () => {
  const g = P.groupOrders([o(3), o(1), o(2, { ready_at: "x" })]);
  assert.deepEqual(g.preparing.map((s) => s.order_number), [1, 3]);
  assert.deepEqual(g.ready.map((s) => s.order_number), [2]);
});

test("only real orders are queued", () => {
  const g = P.groupOrders([
    o(1, { status: "pending", self_declared: false }),   // card still on Stripe
    o(2, { status: "in_progress" }),
    o(3, { status: "canceled" }),
    o(4, { picked_up_at: "x" }),
    o(5, { order_number: null }),
    o(6, { status: "pending", self_declared: true, processor: "cash" }),
  ]);
  assert.deepEqual(g.preparing.map((s) => s.order_number), [6]);
});

test("payment pill flags what the vendor must check", () => {
  assert.deepEqual(P.paymentPill(o(1)), { text: "Card · paid", check: false });
  assert.deepEqual(P.paymentPill(o(1, { status: "pending", self_declared: true, processor: "cash" })),
    { text: "Cash · check it", check: true });
  assert.deepEqual(P.paymentPill(o(1, { self_declared: true, processor: "venmo" })),
    { text: "Venmo · paid", check: false });
});

test("items read like a ticket", () => {
  assert.equal(P.itemsSummary([{ name_snapshot: "Margherita", quantity: 2 }, { name_snapshot: null, quantity: 1 }]),
    "2 × Margherita, Item");
});

test("contact embeds as object or array", () => {
  assert.deepEqual(P.contactOf({ order_contacts: [{ phone: "+1" }] }), { phone: "+1" });
  assert.deepEqual(P.contactOf({ order_contacts: { phone: "+1" } }), { phone: "+1" });
  assert.equal(P.contactOf({ order_contacts: [] }), null);
  assert.equal(P.contactOf({}), null);
});

test("ready text and sms link", () => {
  const body = P.readyMessage("Slice Stand", 12, "abc");
  assert.equal(body, "Slice Stand: your order #12 is ready for pickup. https://getsugarsnapp.com/receipt.html?sale=abc");
  assert.equal(P.smsHref("+1 (555) 123-4567", "hi & bye"), "sms:+15551234567?body=hi%20%26%20bye");
  assert.ok(!P.readyMessage("", 1, "x").startsWith(":"));
});

test("minutes since", () => {
  assert.equal(P.minutesSince("2026-10-18T15:00:00Z", Date.parse("2026-10-18T15:07:59Z")), 7);
  assert.equal(P.minutesSince("2026-10-18T15:00:00Z", Date.parse("2026-10-18T14:00:00Z")), 0);
});
