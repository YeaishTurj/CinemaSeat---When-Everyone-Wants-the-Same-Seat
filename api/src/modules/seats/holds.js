"use strict";

const { withTx } = require("../../shared/db");
const { NotFoundError, ConflictError } = require("../../shared/errors");

// Phase 3 / plan.md §5.1 — concurrency-critical path.
// Per ARCHITECTURE.md §8: the locked transaction must contain ONLY
// the lock, the check, and the update — no extra queries.
async function createHold({ showtimeId, seatId, holdId, ttlSeconds }) {
  return withTx(async (client) => {
    const { rows } = await client.query(
      `SELECT status, hold_expires_at
         FROM show_seats
        WHERE showtime_id = $1 AND seat_id = $2
        FOR UPDATE`,
      [showtimeId, seatId],
    );
    if (rows.length === 0) {
      throw new NotFoundError("seat not in this showtime");
    }
    const row = rows[0];
    const isExpired =
      row.status === "HELD" &&
      row.hold_expires_at &&
      row.hold_expires_at < new Date();

    if (row.status === "BOOKED") {
      throw new ConflictError("seat already booked");
    }
    if (row.status === "HELD" && !isExpired) {
      throw new ConflictError("seat currently held");
    }

    // AVAILABLE or HELD-expired → proceed.
    await client.query(
      `UPDATE show_seats
          SET status = 'HELD',
              hold_id = $3,
              hold_expires_at = now() + ($4 * interval '1 second'),
              booking_id = NULL
        WHERE showtime_id = $1 AND seat_id = $2`,
      [showtimeId, seatId, holdId, ttlSeconds],
    );
  });
}

module.exports = { createHold };
