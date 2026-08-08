"use strict";

const express = require("express");

const { withTx, query } = require("../../shared/db");
const { verify: verifyHmac } = require("../../shared/hmac");

const router = express.Router();

/**
 * POST /webhooks/payment
 *
 * Gateway reference §"Verifying the signature" — must run on the raw body,
 * NOT a JSON-parsed object. Mounted in app.js ahead of express.json() so the
 * raw Buffer is preserved.
 *
 * Gateway payload (from asifmahmoud414/mock-gateway):
 *   { event_id, payment_id, booking_ref, status, amount }
 *
 * Idempotency: payment_events.event_id is the PRIMARY KEY. The retry storm
 * documented in the gateway contract (8% duplicates) is rejected at the DB
 * level, not in application code.
 *
 * Always returns 2xx once we've accepted the event. The gateway cancels
 * delivery after 8 attempts and the contract is "acknowledge even on
 * failure" — see ARCHITECTURE.md §10.1.
 */
router.post(
  "/webhooks/payment",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.get("X-Signature");
    const secret = process.env.GATEWAY_SECRET;
    if (!secret) {
      req.log?.error({ err: "no GATEWAY_SECRET configured" }, "webhook config");
      return res.status(500).end();
    }
    if (!verifyHmac(req.body, secret, signature)) {
      req.log?.warn({ signature }, "webhook bad signature");
      return res.status(401).end();
    }

    let payload;
    try {
      payload = JSON.parse(req.body.toString("utf8"));
    } catch (e) {
      // Malformed JSON — still ack so the gateway stops retrying; log for ops.
      req.log?.error({ err: e.message }, "webhook malformed json");
      return res.status(200).end();
    }

    try {
      await handlePaymentEvent(payload, req);
    } catch (e) {
      req.log?.error({ err: e.message, event: payload }, "webhook handler failed");
      // Intentionally 200 — see ARCHITECTURE.md §10.1 (ack-and-log contract).
    }
    return res.status(200).end();
  },
);

/**
 * The actual state machine. Split out so it's testable without a Router.
 *
 * expected payload: { event_id, payment_id, booking_ref, status, amount }
 */
async function handlePaymentEvent(payload, req) {
  const { event_id, payment_id, booking_ref, status, amount } = payload;
  if (!event_id || !booking_ref || !status) {
    throw new Error("missing required fields");
  }

  // booking_ref is the bk_<id> sent in /charge. Strip the prefix for FK lookup.
  const bookingId = parseInt(String(booking_ref).replace(/^bk_/, ""), 10);
  if (!Number.isFinite(bookingId)) {
    throw new Error(`invalid booking_ref: ${booking_ref}`);
  }

  await withTx(async (client) => {
    // 1. Idempotency: INSERT on event_id PK. Duplicate → ON CONFLICT DO NOTHING.
    const { rows: inserted } = await client.query(
      `INSERT INTO payment_events (event_id, payment_id, status)
            SELECT $1, p.id, $2
              FROM payments p
             WHERE p.booking_id = $3
         ON CONFLICT (event_id) DO NOTHING
           RETURNING event_id`,
      [event_id, status, bookingId],
    );
    if (inserted.length === 0) {
      // Already processed — no-op. This is the whole point of the PK.
      return;
    }

    // 2. Flip payments.status + book the gateway id.
    await client.query(
      `UPDATE payments
          SET status = $2,
              gateway_payment_id = $3
        WHERE booking_id = $1`,
      [bookingId, status, payment_id || null],
    );

    // 3. Cascade to the booking + seats based on terminal status.
    if (status === "SUCCEEDED") {
      await client.query(
        `UPDATE bookings SET status = 'CONFIRMED'
            WHERE id = $1 AND status = 'PENDING'`,
        [bookingId],
      );
      await client.query(
        `UPDATE show_seats
            SET status = 'BOOKED',
                booking_id = $1
          WHERE showtime_id = (SELECT showtime_id FROM bookings WHERE id = $1)
            AND status = 'HELD'`,
        [bookingId],
      );
    } else if (status === "FAILED") {
      await client.query(
        `UPDATE bookings SET status = 'CANCELLED'
            WHERE id = $1 AND status = 'PENDING'`,
        [bookingId],
      );
      await client.query(
        `UPDATE show_seats
            SET status = 'AVAILABLE',
                hold_id = NULL,
                booking_id = NULL
          WHERE showtime_id = (SELECT showtime_id FROM bookings WHERE id = $1)
            AND status = 'HELD'`,
        [bookingId],
      );
    }

    // 4. Mark the event processed (mainly for observability).
    await client.query(
      `UPDATE payment_events SET processed_at = now() WHERE event_id = $1`,
      [event_id],
    );
  });
}

// Exported for tests.
module.exports = router;
module.exports.handlePaymentEvent = handlePaymentEvent;
