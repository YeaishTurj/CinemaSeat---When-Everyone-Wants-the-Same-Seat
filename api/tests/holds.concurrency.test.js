"use strict";

// plan.md §5.3 — Scenario A concurrency test.
// 100 simultaneous POST /holds on the same (showtime, seat) → exactly 1 success.

const request = require("supertest");
const { createApp } = require("../src/app");
const { pool } = require("../src/shared/db");

describe("POST /holds concurrency", () => {
  const showtimeId = 1; // Spider-Man premiere (seed)
  const seatId = 50; // any seat in Hall A (screen_id=1)
  const N = 100;

  let app;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(async () => {
    // Reset the target seat to AVAILABLE so each test starts from a clean slate.
    await pool.query(
      `UPDATE show_seats SET status='AVAILABLE', hold_id=NULL, hold_expires_at=NULL, booking_id=NULL
        WHERE showtime_id=$1 AND seat_id=$2`,
      [showtimeId, seatId],
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it(`100 concurrent holds on one seat → exactly 1 success`, async () => {
    const responses = await Promise.all(
      Array.from({ length: N }, () =>
        request(app)
          .post("/holds")
          .send({ showtime_id: showtimeId, seat_id: seatId }),
      ),
    );

    const successes = responses.filter((r) => r.status === 201).length;
    const conflicts = responses.filter((r) => r.status === 409).length;
    const others = N - successes - conflicts;

    expect(successes).toBe(1);
    expect(conflicts).toBe(N - 1);
    expect(others).toBe(0);

    const { rows } = await pool.query(
      `SELECT status, hold_id, hold_expires_at
         FROM show_seats
        WHERE showtime_id=$1 AND seat_id=$2`,
      [showtimeId, seatId],
    );
    expect(rows[0].status).toBe("HELD");
    expect(rows[0].hold_id).toBeTruthy();
    expect(new Date(rows[0].hold_expires_at).getTime()).toBeGreaterThan(
      Date.now(),
    );
  }, 30000);
});
