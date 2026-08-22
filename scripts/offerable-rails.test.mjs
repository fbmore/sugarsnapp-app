/**
 * The web register must never OFFER a rail the product cannot honour.
 *
 * This is a claim-surface guarantee, not a preference: docs/CLAIM_SURFACES.md
 * forbids any Tap to Pay UI while the feature ships dark, and an EBT sale
 * written without the SNAP-vs-match question is evidence a vendor cannot use.
 *
 * The rules live inside an IIFE in shop.html, so this evaluates the real
 * source of both the guard and the shortlist/more split rather than a copy —
 * a copy would keep passing after someone edited the page.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../shop.html', import.meta.url), 'utf8');

/** Pull a named region of real page source and evaluate it. */
function evalFromPage(...snippets) {
  const src = snippets.map(re => {
    const m = html.match(re);
    assert.ok(m, `shop.html no longer contains ${re} — update this test with the page`);
    return m[0];
  }).join('\n');
  return new Function(src + '\nreturn {PROC_NAMES, RAIL_DISPLAY_ONLY, OFFERABLE, WEBHOOK_VERIFIED};')();
}

const { PROC_NAMES, OFFERABLE, WEBHOOK_VERIFIED } = evalFromPage(
  /var RAIL_DISPLAY_ONLY=\{[^}]*\};/,
  /var WEBHOOK_VERIFIED=\{[^}]*\};/,
  /function OFFERABLE\([^)]*\)\{[^}]*\}/,
  /var PROC_NAMES=\{[^}]*\};/,
);

/** Reproduce the page's split using the real predicate. */
function split(stored) {
  const shortlist = stored.filter(OFFERABLE);
  const more = Object.keys(PROC_NAMES).filter(r => !stored.includes(r) && OFFERABLE(r));
  return { shortlist, more, all: [...shortlist, ...more] };
}

test('Tap to Pay is offered nowhere, however the vendor got there', () => {
  // Default account, roamed shortlist, and a hand-crafted profile value alike.
  for (const stored of [['cash'], ['cash', 'tap_to_pay'], ['tap_to_pay']]) {
    const { all } = split(stored);
    assert.ok(!all.includes('tap_to_pay'),
      `tap_to_pay offerable from stored=${JSON.stringify(stored)} — this is the false claim CLAIM_SURFACES.md names`);
  }
});

test('EBT is not offerable until the token-kind question exists', () => {
  const { all } = split(['cash', 'ebt']);
  assert.ok(!all.includes('ebt'),
    'an EBT row with no snap/match split is invisible to reconciliation');
});

test('the rails that ARE honourable all remain reachable', () => {
  const { all } = split(['cash']);
  for (const rail of ['cash', 'venmo', 'paypal', 'stripe']) {
    assert.ok(all.includes(rail), `${rail} vanished from the picker`);
  }
});

test('the eight held rails are offerable now that 1.4 is live', () => {
  // The hold existed because 1.3 decodes a day of sales as one array and throws
  // on a rail it cannot name, so logging a cheque blanked that vendor's whole
  // ledger day. 1.4 tolerates an unknown rail and is READY_FOR_SALE, so the
  // condition the hold was named for is met. Asserting the release rather than
  // deleting the test: a rail silently dropping back out is the regression.
  const { all } = split(['cash']);
  for (const rail of ['check', 'zelle', 'cashapp', 'apple_cash',
                      'bank_transfer', 'trade', 'comped', 'other']) {
    assert.ok(all.includes(rail), `${rail} is no longer offerable on the web register`);
  }
});

test('display-only rails are still never OFFERED as a choice', () => {
  // The two that were never about the 1.4 hold: tap_to_pay is a device
  // capability rather than a shortlist entry, and EBT is written through its
  // own token flow, where a mis-tap writes federal-audit-flavoured data.
  const { all } = split(['cash']);
  for (const rail of ['tap_to_pay', 'ebt']) {
    assert.ok(!all.includes(rail), `${rail} must not be offerable as a log-payment choice`);
  }
});

test('both dark rails keep their display names, so old sales still read right', () => {
  // Gating what a vendor may RING UP must not change what the ledger SHOWS.
  assert.equal(PROC_NAMES.tap_to_pay, 'Card · Tap to Pay');
  assert.equal(PROC_NAMES.ebt, 'EBT');
});

/**
 * The default shortlist must mirror VisibleRails.defaults on iOS. A vendor who
 * uses both halves should not meet two different pickers, and the reason Stripe
 * is excluded — an unbacked assertion reaching an organizer's grant report —
 * applies identically on the web.
 */
function defaultShortlist(accounts) {
  return ['cash'].concat(accounts.filter(a => !WEBHOOK_VERIFIED[a]));
}

test('Stripe is not a default hand-log choice, even when connected', () => {
  const rails = defaultShortlist(['stripe', 'venmo']);
  assert.ok(!rails.includes('stripe'),
    'hand-logging Stripe asserts a card settled with no charge behind it');
  assert.ok(rails.includes('venmo'),
    'nothing calls back for Venmo — hand-confirming it is the intended flow');
});

test('a Stripe-only vendor still gets a usable picker', () => {
  assert.deepEqual(defaultShortlist(['stripe']), ['cash']);
});

test('Stripe stays reachable under More ways to pay', () => {
  const stored = defaultShortlist(['stripe']);
  const more = Object.keys(PROC_NAMES).filter(r => !stored.includes(r) && OFFERABLE(r));
  assert.ok(more.includes('stripe'), 'excluded from the default, never from the product');
});
