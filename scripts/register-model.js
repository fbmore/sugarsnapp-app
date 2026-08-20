/* The calculator state machine — a faithful port of the iOS register
   (SugarSnapp/Features/Register/RegisterModel.swift). Intentionally minimal
   math: multiply (price × quantity) and add (combine lines). No subtract, no
   divide, no discounts — for a dollar off, type the lower number.

   Digits shift in as cents, cash-register style: typing 9 5 0 reads $9.50.
   After ×, digits type a whole-number quantity.

   Any behavior change here must land in RegisterModel.swift too (and vice
   versa); scripts/register-model.test.mjs mirrors the Swift test suite so
   drift fails loudly. One deliberate web extension: removeLineAt(), because
   the web tape shipped with per-line ✕ buttons before this port. */
(function (global) {
  "use strict";

  var MAX_CENTS = 9999999; // $99,999.99 keeps QR params + UI sane

  function lineTotal(l) { return l.unitCents * l.quantity; }

  function RegisterModel() {
    this.entryCents = 0;
    this.quantity = null;
    this.phase = "amount"; // "amount" | "quantity"
    this.lines = [];       // {itemId, name, unitCents, quantity}
  }

  RegisterModel.prototype.currentLineTotal = function () {
    return this.entryCents * (this.quantity === null ? 1 : this.quantity);
  };
  RegisterModel.prototype.grandTotal = function () {
    return this.lines.reduce(function (s, l) { return s + lineTotal(l); }, 0) +
      this.currentLineTotal();
  };
  RegisterModel.prototype.hasEntry = function () { return this.entryCents > 0; };
  RegisterModel.prototype.isEmpty = function () {
    return this.lines.length === 0 && this.entryCents === 0;
  };
  RegisterModel.prototype.canCharge = function () { return this.grandTotal() > 0; };

  RegisterModel.prototype.tapDigit = function (d) {
    if (this.phase === "amount") {
      var next = this.entryCents * 10 + d;
      if (next > MAX_CENTS) return;
      this.entryCents = next;
    } else {
      var q = ((this.quantity === null ? 0 : this.quantity) * 10) + d;
      if (q > 999 || this.entryCents * q > MAX_CENTS) return;
      this.quantity = q;
    }
  };

  RegisterModel.prototype.tapDoubleZero = function () {
    if (this.phase !== "amount") return;
    var next = this.entryCents * 100;
    if (this.entryCents <= 0 || next > MAX_CENTS) return;
    this.entryCents = next;
  };

  /* Price × quantity ("9 by 4" for four at nine dollars). */
  RegisterModel.prototype.tapMultiply = function () {
    if (this.phase !== "amount" || this.entryCents <= 0) return;
    this.phase = "quantity";
    this.quantity = null;
  };

  /* Commit the current line and start the next. */
  RegisterModel.prototype.tapAdd = function () { this._commit(); };

  RegisterModel.prototype.backspace = function () {
    if (this.phase === "amount") {
      this.entryCents = Math.floor(this.entryCents / 10);
    } else if (this.quantity !== null && this.quantity > 0) {
      this.quantity = this.quantity >= 10 ? Math.floor(this.quantity / 10) : null;
    } else {
      // Backing out of an empty quantity returns to the amount.
      this.phase = "amount";
      this.quantity = null;
    }
  };

  /* Clear. A mistake means clear and retype — no editing of past lines. */
  /* Whether C would wipe the basket rather than the digits being typed. C is
     the widest key on the pad, and with nothing in flight it emptied a whole
     order on one tap with no undo — one mis-reach mid-rush and a twelve-line
     basket is gone with a customer standing there. Callers ask first; the
     model only reports. MIRRORS RegisterModel.clearWouldWipeBasket on iOS. */
  RegisterModel.prototype.clearWouldWipeBasket = function () {
    return !(this.hasEntry() || this.phase === "quantity") && this.lines.length > 0;
  };

  /* Clears the entry in flight. Returns false, touching nothing, when the tap
     would instead have wiped the basket — that needs confirming, and the model
     must not decide it silently. */
  RegisterModel.prototype.clear = function () {
    if (this.hasEntry() || this.phase === "quantity") {
      this.entryCents = 0; this.quantity = null; this.phase = "amount";
      return true;
    }
    return this.lines.length === 0;
  };

  RegisterModel.prototype.clearAll = function () {
    this.entryCents = 0; this.quantity = null; this.phase = "amount"; this.lines = [];
  };

  /* All lines including the in-flight one; what a charge commits. */
  RegisterModel.prototype.linesForCharge = function () {
    var all = this.lines.slice();
    if (this.entryCents > 0) {
      all.push({ itemId: null, name: null, unitCents: this.entryCents,
        quantity: Math.max(this.quantity === null ? 1 : this.quantity, 1) });
    }
    return all;
  };

  /* Ring up an inventory item ({id, name, priceCents}). Tapping the same item
     again bumps its quantity: 3 taps on a $3.00 zucchini reads "3.00 ×3". */
  RegisterModel.prototype.addItem = function (item) {
    this._commit();
    var idx = this._indexOf(item);
    if (idx >= 0) this.lines[idx].quantity += 1;
    else this.lines.push({ itemId: item.id || null, name: item.name,
      unitCents: item.priceCents, quantity: 1 });
  };

  /* How many of this item are rung up right now (drives the chip badge). */
  RegisterModel.prototype.quantityOf = function (item) {
    var idx = this._indexOf(item);
    return idx >= 0 ? this.lines[idx].quantity : 0;
  };

  /* Set an item's rung-up quantity outright (0 removes the line). */
  RegisterModel.prototype.setQuantity = function (item, qty) {
    var idx = this._indexOf(item);
    if (idx >= 0) {
      if (qty <= 0) this.lines.splice(idx, 1);
      else this.lines[idx].quantity = qty;
    } else if (qty > 0) {
      this.lines.push({ itemId: item.id || null, name: item.name,
        unitCents: item.priceCents, quantity: qty });
    }
  };

  /* Web extension (no iOS counterpart): the tape's per-line ✕. Drops one unit,
     removing the line at quantity 1 — matching the pre-keypad web behavior. */
  RegisterModel.prototype.removeLineAt = function (idx) {
    var l = this.lines[idx];
    if (!l) return;
    if (l.quantity > 1) l.quantity -= 1;
    else this.lines.splice(idx, 1);
  };

  RegisterModel.prototype._indexOf = function (item) {
    for (var i = 0; i < this.lines.length; i++) {
      if (this.lines[i].name === item.name && this.lines[i].unitCents === item.priceCents) return i;
    }
    return -1;
  };

  RegisterModel.prototype._commit = function () {
    if (this.entryCents <= 0) return false;
    this.lines.push({ itemId: null, name: null, unitCents: this.entryCents,
      quantity: Math.max(this.quantity === null ? 1 : this.quantity, 1) });
    this.entryCents = 0; this.quantity = null; this.phase = "amount";
    return true;
  };

  RegisterModel.lineTotal = lineTotal;

  if (typeof module !== "undefined" && module.exports) module.exports = RegisterModel;
  else global.RegisterModel = RegisterModel;
})(typeof window !== "undefined" ? window : globalThis);
