"use strict";

const request = require("supertest");
const { createApp } = require("../src/app");
const { pool } = require("../src/shared/db");
const { sign } = require("../src/shared/hmac");

const SECRET = "z2p-2026-secret";

describe("payment webhook hardening", () => {
  let app;
  let fixture;

  beforeAll(() => {
    process.env.GATEWAY_SECRET = SECRET;
    app = createApp();
  });

  async function createFixture() {
    const { rows: seats } = await pool.query(
      `SELECT id, showtime_id, seat_id, status, hold_id, hold_expires_at, booking_id
         FROM show_seats
        WHERE status = 'AVAILABLE' AND booking_id IS NULL
        ORDER BY id
        LIMIT 1`,
    );
    if (seats.length === 0) throw new Error("test requires one available seat");
    const originalSeat = seats[0];
    const { rows: bookings } = await pool.query(
      `INSERT INTO bookings (showtime_id, user_ref, status, total_amount)
            VALUES ($1, $2, 'PENDING', 450)
         RETURNING id`,
      [originalSeat.showtime_id, `webhook-test-${Date.now()}`],
    );
    const bookingId = bookings[0].id;
    await pool.query(
      `UPDATE show_seats
          SET status='HELD', hold_id=$2,
              hold_expires_at=now() + interval '5 minutes', booking_id=$3
        WHERE id=$1`,
      [originalSeat.id, `test-hold-${bookingId}`, bookingId],
    );
    const { rows: payments } = await pool.query(
      `INSERT INTO payments (booking_id, idempotency_key, status, amount)
            VALUES ($1, $2, 'PENDING', 450)
         RETURNING id`,
      [bookingId, `webhook-test-${bookingId}`],
    );
    return { originalSeat, bookingId, paymentId: payments[0].id };
  }

  async function cleanupFixture(value) {
    if (!value) return;
    await pool.query("DELETE FROM payment_events WHERE payment_id=$1", [
      value.paymentId,
    ]);
    await pool.query("DELETE FROM payments WHERE id=$1", [value.paymentId]);
    await pool.query(
      `UPDATE show_seats
          SET status=$2, hold_id=$3, hold_expires_at=$4, booking_id=$5
        WHERE id=$1`,
      [
        value.originalSeat.id,
        value.originalSeat.status,
        value.originalSeat.hold_id,
        value.originalSeat.hold_expires_at,
        value.originalSeat.booking_id,
      ],
    );
    await pool.query("DELETE FROM bookings WHERE id=$1", [value.bookingId]);
  }

  function postSigned(event) {
    const raw = JSON.stringify(event);
    return request(app)
      .post("/webhooks/payment")
      .set("Content-Type", "application/json")
      .set("X-Signature", sign(Buffer.from(raw), SECRET))
      .send(raw);
  }

  beforeEach(async () => {
    fixture = await createFixture();
  });

  afterEach(async () => {
    await cleanupFixture(fixture);
    fixture = null;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("rejects an invalid signature", async () => {
    const response = await request(app)
      .post("/webhooks/payment")
      .set("Content-Type", "application/json")
      .set("X-Signature", "bad")
      .send(JSON.stringify({ event_id: "bad-signature" }));

    expect(response.status).toBe(401);
  });

  it("deduplicates an event and handles the callback-before-response race", async () => {
    const event = {
      event_id: `evt-success-${fixture.bookingId}`,
      payment_id: `pay-${fixture.bookingId}`,
      booking_ref: `bk_${fixture.bookingId}`,
      status: "SUCCEEDED",
      amount: 450,
    };

    expect((await postSigned(event)).status).toBe(200);
    expect((await postSigned(event)).status).toBe(200);

    const { rows: events } = await pool.query(
      "SELECT count(*)::int AS count FROM payment_events WHERE event_id=$1",
      [event.event_id],
    );
    const { rows: bookings } = await pool.query(
      "SELECT status FROM bookings WHERE id=$1",
      [fixture.bookingId],
    );
    const { rows: seats } = await pool.query(
      "SELECT status FROM show_seats WHERE id=$1",
      [fixture.originalSeat.id],
    );
    expect(events[0].count).toBe(1);
    expect(bookings[0].status).toBe("CONFIRMED");
    expect(seats[0].status).toBe("BOOKED");
  });

  it("cancels the booking and releases only its seat on FAILED", async () => {
    const event = {
      event_id: `evt-failed-${fixture.bookingId}`,
      payment_id: `pay-${fixture.bookingId}`,
      booking_ref: `bk_${fixture.bookingId}`,
      status: "FAILED",
      amount: 450,
    };

    expect((await postSigned(event)).status).toBe(200);

    const { rows: bookings } = await pool.query(
      "SELECT status FROM bookings WHERE id=$1",
      [fixture.bookingId],
    );
    const { rows: seats } = await pool.query(
      "SELECT status, booking_id FROM show_seats WHERE id=$1",
      [fixture.originalSeat.id],
    );
    expect(bookings[0].status).toBe("CANCELLED");
    expect(seats[0]).toMatchObject({ status: "AVAILABLE", booking_id: null });
  });
});
