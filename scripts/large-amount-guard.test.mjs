#!/usr/bin/env node
/**
 * The large-amount confirmation, executed rather than eyeballed.
 *
 * WHY THIS EXISTS: `confirmIfLarge` was written inside the keypad IIFE and
 * called from three places outside it — Charge, Log payment, and the guest Pay
 * button. A function declaration is scoped to its enclosing function, so all
 * three threw ReferenceError and did nothing. Charge, the most important button
 * on the register, was dead on the live site.
 *
 * Nothing static caught it: `node --check` passes, and the definition and the
 * calls each look right in isolation. Only the brace depth between them was
 * wrong, hundreds of lines apart.
 *
 * So this asserts the two independent things that were both true of the bug:
 *
 *   1. the declaration sits at top level (column 0), reachable by every caller
 *   2. the function actually behaves — run for real, not re-implemented here,
 *      because a re-implementation would have passed happily while the page
 *      threw. (scripts/rails-editor.test.mjs learned that the hard way.)
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(ROOT, "shop.html"), "utf8");

/* 1. Scope. Top-level declarations in this file start at column 0; the bug was
      an indented one. Anchored so re-nesting it fails here immediately. */
assert.match(
  html,
  /^function confirmIfLarge\(cents, profile, what, go\)\{/m,
  "confirmIfLarge must be declared at top level — nested, every caller throws ReferenceError"
);

/* 2. All three callers still route through it. */
for (const [what, needle] of [
  ["guest pay", 'confirmIfLarge(cartTotal(), vendor, "pay"'],
  ["charge", 'confirmIfLarge(reg.grandTotal(), regProfile, "charge"'],
  ["log payment", 'confirmIfLarge(reg.grandTotal(), regProfile, "log"'],
]) {
  assert.ok(html.includes(needle), `${what} no longer goes through confirmIfLarge`);
}

/* 3. Behaviour — the real source, lifted out and run against stubs. */
const src = html.match(/^function confirmIfLarge\([\s\S]*?\n\}/m)[0];
const isLargeSrc = html.match(/^function isLargeAmount\([\s\S]*?\n\}/m)[0];
const largeCentsSrc = html.match(/^function largeAmountCents\([\s\S]*?\n\}/m)[0];

const nodes = {};
const $ = (id) => (nodes[id] ??= {
  textContent: "",
  onclick: null,
  classList: {
    _hidden: true,
    add(c) { if (c === "hidden") this._hidden = true; },
    remove(c) { if (c === "hidden") this._hidden = false; },
  },
});
const money = (c) => "$" + (c / 100).toFixed(2);

const confirmIfLarge = new Function(
  "$", "money",
  `${largeCentsSrc}\n${isLargeSrc}\n${src}\nreturn confirmIfLarge;`
)($, money);

const profile = { large_amount_cents: 10000 };  // $100 guard

// Under the threshold: straight through, no sheet.
let ran = 0;
confirmIfLarge(9999, profile, "charge", () => ran++);
assert.equal(ran, 1, "a small sale must not be interrupted");
assert.equal($("bigConfirm").classList._hidden, true, "no sheet for a small sale");

// Over it: held, and the confirming button repeats the amount.
ran = 0;
confirmIfLarge(100000, profile, "charge", () => ran++);
assert.equal(ran, 0, "a $1,000 sale must not go through unconfirmed");
assert.equal($("bigConfirm").classList._hidden, false, "the sheet must be shown");
assert.match($("bigGo").textContent, /\$1000\.00/, "the button must repeat the amount");

// Confirming runs it exactly once and puts the sheet away.
$("bigGo").onclick();
assert.equal(ran, 1, "confirming must run the action");
assert.equal($("bigConfirm").classList._hidden, true, "confirming must close the sheet");

// Backing out runs nothing.
ran = 0;
confirmIfLarge(100000, profile, "charge", () => ran++);
$("bigFix").onclick();
assert.equal(ran, 0, "backing out must not charge");
assert.equal($("bigConfirm").classList._hidden, true);

console.log("large-amount-guard: scope + behaviour OK");
