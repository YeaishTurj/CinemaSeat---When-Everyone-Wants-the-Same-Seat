"use strict";

jest.mock("../src/shared/gateway", () => ({
  charge: jest.fn(),
  sendOtp: jest.fn(),
  verifyOtp: jest.fn(),
}));

const request = require("supertest");
const { charge } = require("../src/shared/gateway");
const { createApp } = require("../src/app");
const { pool } = require("../src/shared/db");

describe("payment gateway failure isolation", () => {
  let app;
  let bookingId;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(async () => {
    charge.mockReset();
    const { rows } = await pool.query(
      `INSERT INTO bookings (showtime_id, user_ref, status, total_amount)
            VALUES (1, $1, 'PENDING', 450)
         RETURNING id`,
      [`retry-test-${Date.now()}`],
    );
    bookingId = rows[0].id;
  });

  afterEach(async () => {
    await pool.query("DELETE FROM payments WHERE booking_id=$1", [bookingId]);
    await pool.query("DELETE FROM bookings WHERE id=$1", [bookingId]);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("retries a timeout once and returns PENDING instead of 500", async () => {
    const timeout = Object.assign(new Error("timeout"), {
      code: "ECONNABORTED",
    });
    charge.mockRejectedValue(timeout);

    const response = await request(app)
      .post(`/bookings/${bookingId}/pay`)
      .set("X-Mock-Force", "timeout");

    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({ ok: true, status: "PENDING" });
    expect(charge).toHaveBeenCalledTimes(2);
    expect(charge.mock.calls[0][0]).toMatchObject({
      idempotencyKey: `bk_${bookingId}`,
      mock: { force: "timeout" },
    });
  });

  it("keeps health and catalog available when the gateway is down", async () => {
    charge.mockRejectedValue(
      Object.assign(new Error("connect refused"), { code: "ECONNREFUSED" }),
    );

    const payment = await request(app).post(`/bookings/${bookingId}/pay`);
    const health = await request(app).get("/health");
    const movies = await request(app).get("/movies");

    expect(payment.status).toBe(202);
    expect(health.status).toBe(200);
    expect(movies.status).toBe(200);
  });
});
