"use strict";

const express = require("express");
const { query, withTx } = require("../../shared/db");
const { charge, sendOtp, verifyOtp } = require("../../shared/gateway");
const {
  BadRequestError,
  NotFoundError,
  ConflictError,
  GatewayError,
} = require("../../shared/errors");

const router = express.Router();

// Plan §6.2 / ARCHITECTURE §9 — booking lifecycle.
// POST /bookings
//   body: { hold_id, user_ref, phone? }
//   - Resolves the held seats via show_seats.hold_id.
//   - Creates a booking row in PENDING and references the seats.
//   - If a phone is provided, also creates an otp_sessions row.
router.post("/bookings", async (req, res, next) => {
  try {
    const { hold_id: holdId, user_ref: userRef, phone } = req.body || {};
    if (!holdId || typeof holdId !== "string") {
      throw new BadRequestError("hold_id is required");
    }
    if (!userRef || typeof userRef !== "string") {
      throw new BadRequestError("user_ref is required");
    }

    const booking = await withTx(async (client) => {
      // Lock and read every seat belonging to this hold.
      const held = await client.query(
        `SELECT showtime_id, seat_id, hold_expires_at
           FROM show_seats
          WHERE hold_id = $1
          FOR UPDATE`,
        [holdId],
      );
      if (held.rows.length === 0) {
        throw new NotFoundError("hold_id not found");
      }
      const now = new Date();
      const expired = held.rows.filter(
        (r) => r.hold_expires_at && r.hold_expires_at < now,
      );
      if (expired.length > 0) {
        throw new ConflictError("hold expired");
      }

      const showtimeId = held.rows[0].showtime_id;
      const seatIds = held.rows.map((r) => r.seat_id);

      // Compute total from base_price × seats.
      const { rows: priceRows } = await client.query(
        `SELECT base_price FROM showtimes WHERE id = $1`,
        [showtimeId],
      );
      const basePrice = Number(priceRows[0].base_price);
      const totalAmount = basePrice * seatIds.length;

      const { rows: bookingRows } = await client.query(
        `INSERT INTO bookings (showtime_id, user_ref, status, total_amount)
              VALUES ($1, $2, 'PENDING', $3)
           RETURNING *`,
        [showtimeId, userRef, totalAmount.toFixed(2)],
      );
      const b = bookingRows[0];

      await client.query(
        `UPDATE show_seats
            SET status = 'HELD',
                booking_id = $2
          WHERE hold_id = $1`,
        [holdId, b.id],
      );

      if (phone) {
        await client.query(
          `INSERT INTO otp_sessions (ref, phone, status)
                VALUES ($1, $2, 'PENDING')
           ON CONFLICT (ref) DO UPDATE SET phone = EXCLUDED.phone, status = 'PENDING', attempts = 0`,
          [`bk_${b.id}`, phone],
        );
      }

      return b;
    });

    res.status(201).json({
      ok: true,
      booking: {
        id: booking.id,
        showtime_id: booking.showtime_id,
        user_ref: booking.user_ref,
        status: booking.status,
        total_amount: booking.total_amount,
        created_at: booking.created_at,
      },
    });
  } catch (e) {
    next(e);
  }
});

// GET /bookings/:id — state for frontend polling.
router.get("/bookings/:id", async (req, res, next) => {
  try {
    const bookingId = parseInt(req.params.id, 10);
    if (!Number.isFinite(bookingId)) {
      throw new BadRequestError("invalid booking id");
    }
    const { rows: bookingRows } = await query(
      `SELECT id, showtime_id, user_ref, status, total_amount, created_at
         FROM bookings WHERE id = $1`,
      [bookingId],
    );
    if (bookingRows.length === 0) {
      throw new NotFoundError("booking not found");
    }
    const { rows: paymentRows } = await query(
      `SELECT id, status, amount, gateway_payment_id
         FROM payments WHERE booking_id = $1`,
      [bookingId],
    );
    const { rows: otpRows } = await query(
      `SELECT ref, phone, status, attempts
         FROM otp_sessions WHERE ref = $1`,
      [`bk_${bookingId}`],
    );
    const { rows: seatRows } = await query(
      `SELECT se.row_label, se.seat_number
         FROM show_seats ss JOIN seats se ON se.id = ss.seat_id
        WHERE ss.booking_id = $1
        ORDER BY se.row_label, se.seat_number`,
      [bookingId],
    );
    res.json({
      ok: true,
      booking: bookingRows[0],
      payment: paymentRows[0] || null,
      otp: otpRows[0] || null,
      seats: seatRows,
    });
  } catch (e) {
    next(e);
  }
});

// POST /bookings/:id/pay — plan §6.3.
// 1. create payment row keyed on booking_id
// 2. call gateway /charge with Idempotency-Key = bk_<id>
// 3. retry once on 5xx / timeout
// 4. return 202 immediately
router.post("/bookings/:id/pay", async (req, res, next) => {
  try {
    const bookingId = parseInt(req.params.id, 10);
    if (!Number.isFinite(bookingId)) {
      throw new BadRequestError("invalid booking id");
    }

    // 1. Insert (or no-op fetch) the payment row keyed on booking_id.
    const payment = await withTx(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO payments (booking_id, idempotency_key, status, amount)
              SELECT id, $2, 'PENDING', total_amount
                FROM bookings WHERE id = $1
           ON CONFLICT (booking_id) DO UPDATE SET status = payments.status
           RETURNING *`,
        [bookingId, `bk_${bookingId}`],
      );
      if (rows.length === 0) throw new NotFoundError("booking not found");
      return rows[0];
    });

    // 2 + 3. Call gateway, retry once on 5xx / timeout.
    const callbackUrl = "http://api:3000/webhooks/payment";
    const idempotencyKey = `bk_${bookingId}`;
    const mockForce = req.get("X-Mock-Force") || undefined;
    const callOnce = () =>
      charge({
        amount: Number(payment.amount),
        booking_ref: idempotencyKey,
        callback_url: callbackUrl,
        idempotencyKey,
        mock: { force: mockForce },
      });
    try {
      await callOnce();
    } catch (e) {
      const isServerErr = e.response && e.response.status >= 500;
      const isTimeout =
        e.code === "ECONNABORTED" ||
        e.code === "ETIMEDOUT" ||
        e.message?.includes("timeout");
      if (isServerErr || isTimeout) {
        try {
          await callOnce(); // retry once with the same idempotency key
        } catch (retryError) {
          // The charge may have reached the gateway. Preserve PENDING and
          // return 202 so a late callback can still finish the booking.
          req.log?.warn(
            { err: retryError.message, bookingId },
            "gateway retry exhausted; payment remains pending",
          );
        }
      } else if (e.response) {
        // 4xx from gateway — surface as GatewayError so the frontend sees a clean error.
        throw new GatewayError(`gateway rejected: ${e.response.status}`);
      } else {
        // Network error — leave payment PENDING, return 202 (the /charge may have reached the gateway).
        // eslint-disable-next-line no-console
        console.warn("[pay] gateway unreachable, leaving PENDING:", e.message);
      }
    }

    res.status(202).json({ ok: true, status: "PENDING" });
  } catch (e) {
    next(e);
  }
});

// POST /bookings/:id/otp/send — call gateway /otp/send, return 202.
// If no session exists yet (e.g. /bookings was called without `phone`),
// create one here from the request body so the flow stays forgiving.
router.post("/bookings/:id/otp/send", async (req, res, next) => {
  try {
    const bookingId = parseInt(req.params.id, 10);
    if (!Number.isFinite(bookingId)) {
      throw new BadRequestError("invalid booking id");
    }
    const ref = `bk_${bookingId}`;
    const { phone: phoneInBody } = req.body || {};

    // Verify the booking exists before touching OTP.
    const { rows: bRows } = await query(
      `SELECT id FROM bookings WHERE id = $1`,
      [bookingId],
    );
    if (bRows.length === 0) {
      throw new NotFoundError("booking not found");
    }

    // Upsert an OTP session, deriving phone from existing row or body.
    const { rows: phoneRows } = await withTx(async (client) => {
      const existing = await client.query(
        `SELECT phone FROM otp_sessions WHERE ref = $1`,
        [ref],
      );
      if (existing.rows.length > 0) {
        return existing;
      }
      if (!phoneInBody) {
        throw new BadRequestError(
          "no OTP session for this booking; pass phone in the body",
        );
      }
      const inserted = await client.query(
        `INSERT INTO otp_sessions (ref, phone, status)
              VALUES ($1, $2, 'PENDING')
           ON CONFLICT (ref) DO UPDATE SET phone = EXCLUDED.phone, status = 'PENDING', attempts = 0
           RETURNING phone`,
        [ref, phoneInBody],
      );
      return inserted;
    });
    const phone = phoneRows[0].phone;

    const callbackUrl = "http://api:3000/webhooks/otp";
    try {
      await sendOtp({ phone, ref, callback_url: callbackUrl });
    } catch (e) {
      // Mirror the /pay policy: surface, don't crash.
      throw new GatewayError(`gateway /otp/send failed: ${e.message}`);
    }
    res.status(202).json({ ok: true, status: "PENDING" });
  } catch (e) {
    next(e);
  }
});

// POST /bookings/:id/otp/verify — synchronous against the gateway.
router.post("/bookings/:id/otp/verify", async (req, res, next) => {
  try {
    const bookingId = parseInt(req.params.id, 10);
    if (!Number.isFinite(bookingId)) {
      throw new BadRequestError("invalid booking id");
    }
    const { code } = req.body || {};
    if (!code || typeof code !== "string") {
      throw new BadRequestError("code is required");
    }
    const ref = `bk_${bookingId}`;
    let result;
    try {
      result = await verifyOtp({ ref, code });
    } catch (e) {
      if (e.response && e.response.status === 400) {
        return res
          .status(400)
          .json({ ok: false, code: "OTP_BAD", message: "invalid code" });
      }
      if (e.response && e.response.status === 429) {
        return res.status(429).json({
          ok: false,
          code: "OTP_RATE_LIMIT",
          message: "too many attempts",
        });
      }
      throw new GatewayError(`gateway /otp/verify failed: ${e.message}`);
    }
    // The gateway contract returns { verified: true }; tolerate a status
    // field too so the adapter remains compatible with older images.
    const verified =
      result.data?.verified === true || result.data?.status === "VERIFIED";
    if (verified) {
      await query(
        `UPDATE otp_sessions SET status='VERIFIED', attempts = attempts + 1 WHERE ref = $1`,
        [ref],
      );
    } else {
      await query(
        `UPDATE otp_sessions SET attempts = attempts + 1 WHERE ref = $1`,
        [ref],
      );
    }
    res.json({ ok: true, status: verified ? "VERIFIED" : "PENDING" });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
