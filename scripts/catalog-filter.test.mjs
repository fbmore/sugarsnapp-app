#!/usr/bin/env node
/**
 * The shopper's catalog filter.
 *
 * WHY THIS EXISTS: the filter only appears above a threshold, so on the demo
 * stand (six items) it is invisible — a break here would ship unnoticed and
 * only ever hurt the vendors with the biggest catalogs, who are exactly the
 * ones who need it. The matching rule is also easy to get subtly wrong:
 * case, accents, and the empty query all have to behave.
 *
 * The predicate is lifted from shop.html and RUN, not restated here. A
 * restatement would pass while the page shipped something else.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(ROOT, "shop.html"), "utf8");

const grab = (re, what) => {
  const m = html.match(re);
  assert.ok(m, `could not find ${what} in shop.html`);
  return m[0];
};

const { normName, FILTER_AT } = new Function(
  grab(/var FILTER_AT = \d+;/, "FILTER_AT") + "\n" +
  grab(/function normName\([\s\S]*?\n\}/, "normName") + "\n" +
  "return {normName, FILTER_AT};"
)();

/* The threshold is a product decision, not an accident. Francesco set 12 after
   we agreed 6 was low enough that the box costs more than it saves. */
assert.equal(FILTER_AT, 12, "the filter threshold moved — was that deliberate?");

/** The page's own filter, applied the same way renderItemRows applies it. */
const match = (names, q) => {
  const needle = normName(q).trim();
  return needle ? names.filter((n) => normName(n).indexOf(needle) >= 0) : names;
};

const CATALOG = [
  "Heirloom tomatoes", "Sourdough loaf", "Eggs (dozen)", "Zucchini",
  "Raw honey (8 oz)", "Strawberry jam", "Rainbow chard", "Purple carrots",
  "Shiitake mushrooms", "Goat cheese", "Apple cider", "Kale",
  "Cherry tomatoes", "Basil", "Blueberries", "Rhubarb", "Maple syrup", "Café au lait",
];

// an empty query is not a filter — it must not hide the catalog
assert.equal(match(CATALOG, "").length, CATALOG.length);
assert.equal(match(CATALOG, "   ").length, CATALOG.length);

// plain substring, anywhere in the name
assert.deepEqual(match(CATALOG, "tomato"), ["Heirloom tomatoes", "Cherry tomatoes"]);
assert.deepEqual(match(CATALOG, "honey"), ["Raw honey (8 oz)"]);

// case-insensitive both ways
assert.deepEqual(match(CATALOG, "KALE"), ["Kale"]);
assert.deepEqual(match(CATALOG, "kale"), ["Kale"]);

// accent-insensitive — a shopper types "cafe", the vendor wrote "Café"
assert.deepEqual(match(CATALOG, "cafe"), ["Café au lait"]);
assert.deepEqual(match(CATALOG, "café"), ["Café au lait"]);

// matches mid-word and across punctuation the vendor chose
assert.deepEqual(match(CATALOG, "8 oz"), ["Raw honey (8 oz)"]);

// no match is empty, not everything — the failure mode that would look like
// "the filter does nothing"
assert.deepEqual(match(CATALOG, "zzzz"), []);

// deliberately NOT fuzzy: initials must not match, or the box becomes magic
assert.deepEqual(match(CATALOG, "hny"), [], "matching went fuzzy");
assert.deepEqual(match(CATALOG, "sdl"), [], "matching went fuzzy");

console.log("catalog-filter: all assertions passed");
