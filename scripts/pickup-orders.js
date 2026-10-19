/* Pickup orders: the pure half of account.html's Orders queue.

   The vendor cooks in the order people paid, so the queue is oldest first and
   split in two: what is still being made, and what is waiting on the counter.
   Mirrored by SugarSnapp/Features/Orders/OrdersModel.swift; the copy, the pill
   wording and the text message must read the same on both faces.

   Tested by scripts/pickup-orders.test.mjs. */
(function (global) {
  "use strict";

  var RAIL_NAMES = { cash: "Cash", venmo: "Venmo", paypal: "PayPal", stripe: "Card",
    tap_to_pay: "Card", ebt: "EBT", check: "Check", zelle: "Zelle", cashapp: "Cash App",
    apple_cash: "Apple Cash", bank_transfer: "Bank transfer", other: "Other" };

  /* PostgREST embeds a one-to-one as an object and a one-to-many as an array;
     which one order_contacts arrives as depends on the server version. */
  function contactOf(sale) {
    var c = sale && sale.order_contacts;
    if (Array.isArray(c)) c = c[0];
    return c || null;
  }

  /* In the vendor's queue once it is real to them: paid, or a shopper's claim
     they still have to check. A card sale still on Stripe is not an order yet;
     cooking it would be cooking for someone who may never pay. */
  function isQueued(sale) {
    if (!sale || sale.order_number == null || sale.picked_up_at) return false;
    return sale.status === "paid" || (sale.status === "pending" && sale.self_declared === true);
  }

  function byCreated(a, b) {
    return String(a.created_at).localeCompare(String(b.created_at)) ||
      (a.order_number - b.order_number);
  }

  function groupOrders(sales) {
    var open = (sales || []).filter(isQueued).sort(byCreated);
    return {
      preparing: open.filter(function (s) { return !s.ready_at; }),
      ready: open.filter(function (s) { return !!s.ready_at; })
    };
  }

  /* What the vendor needs to know about the money, in as few words as fit on
     a phone row. `check` marks the one case that needs their eyes. */
  function paymentPill(sale) {
    var rail = RAIL_NAMES[sale.processor] || (sale.processor ? String(sale.processor) : "Card");
    if (sale.status === "pending" && sale.self_declared) {
      return { text: rail + " · check it", check: true };
    }
    return { text: rail + " · paid", check: false };
  }

  function itemsSummary(items) {
    return (items || []).map(function (l) {
      var q = Number(l.quantity) || 1;
      return (q > 1 ? q + " × " : "") + (l.name_snapshot || "Item");
    }).join(", ");
  }

  function minutesSince(iso, now) {
    var ms = (now || Date.now()) - new Date(iso).getTime();
    return Math.max(0, Math.floor(ms / 60000));
  }

  function receiptUrl(saleId) {
    return "https://getsugarsnapp.com/receipt.html?sale=" + encodeURIComponent(saleId);
  }

  function readyMessage(business, orderNumber, saleId) {
    var who = business ? business + ": " : "";
    return who + "your order #" + orderNumber + " is ready for pickup. " + receiptUrl(saleId);
  }

  /* `sms:<number>?body=` is what Android's Messages reads; iOS since 8 reads
     it too. The `&body=` form some guides give only ever worked on old iOS. */
  function smsHref(phone, body) {
    var to = String(phone || "").replace(/[^\d+]/g, "");
    return "sms:" + to + "?body=" + encodeURIComponent(body);
  }

  var api = { contactOf: contactOf, isQueued: isQueued, groupOrders: groupOrders,
    paymentPill: paymentPill, itemsSummary: itemsSummary, minutesSince: minutesSince,
    receiptUrl: receiptUrl, readyMessage: readyMessage, smsHref: smsHref };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.PickupOrders = api;
})(typeof window !== "undefined" ? window : globalThis);
