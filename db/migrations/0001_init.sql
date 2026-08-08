-- Phase 2 — initial schema.
-- Source of truth: plan.md §4.1, ARCHITECTURE.md §7.
-- Idempotent so a re-run against an existing volume is safe.

BEGIN;

CREATE TABLE IF NOT EXISTS movies (
  id           SERIAL PRIMARY KEY,
  title        TEXT NOT NULL,
  poster_url   TEXT,
  duration_min INT NOT NULL
);

CREATE TABLE IF NOT EXISTS theatres (
  id        SERIAL PRIMARY KEY,
  name      TEXT NOT NULL,
  location  TEXT
);

CREATE TABLE IF NOT EXISTS screens (
  id          SERIAL PRIMARY KEY,
  theatre_id  INT NOT NULL REFERENCES theatres(id),
  name        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS showtimes (
  id          SERIAL PRIMARY KEY,
  movie_id    INT NOT NULL REFERENCES movies(id),
  screen_id   INT NOT NULL REFERENCES screens(id),
  starts_at   TIMESTAMPTZ NOT NULL,
  base_price  NUMERIC(10,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS seats (
  id          SERIAL PRIMARY KEY,
  screen_id   INT NOT NULL REFERENCES screens(id),
  row_label   TEXT NOT NULL,
  seat_number INT NOT NULL,
  UNIQUE (screen_id, row_label, seat_number)
);

CREATE TABLE IF NOT EXISTS show_seats (
  id              SERIAL PRIMARY KEY,
  showtime_id     INT NOT NULL REFERENCES showtimes(id),
  seat_id         INT NOT NULL REFERENCES seats(id),
  status          TEXT NOT NULL CHECK (status IN ('AVAILABLE','HELD','BOOKED')),
  hold_id         TEXT,
  hold_expires_at TIMESTAMPTZ,
  booking_id      INT,
  UNIQUE (showtime_id, seat_id)
);
CREATE INDEX IF NOT EXISTS show_seats_showtime_status_idx
  ON show_seats (showtime_id, status);
CREATE INDEX IF NOT EXISTS show_seats_hold_expiry_idx
  ON show_seats (hold_expires_at) WHERE status = 'HELD';

CREATE TABLE IF NOT EXISTS bookings (
  id           SERIAL PRIMARY KEY,
  showtime_id  INT NOT NULL REFERENCES showtimes(id),
  user_ref     TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('PENDING','CONFIRMED','CANCELLED','EXPIRED')),
  total_amount NUMERIC(10,2) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payments (
  id                 SERIAL PRIMARY KEY,
  booking_id         INT NOT NULL REFERENCES bookings(id),
  gateway_payment_id TEXT,
  idempotency_key    TEXT NOT NULL,
  status             TEXT NOT NULL CHECK (status IN ('PENDING','SUCCEEDED','FAILED','REFUNDED')),
  amount             NUMERIC(10,2) NOT NULL,
  UNIQUE (booking_id),
  UNIQUE (idempotency_key)
);

CREATE TABLE IF NOT EXISTS payment_events (
  event_id     TEXT PRIMARY KEY,         -- gateway's dedup key
  payment_id   INT NOT NULL REFERENCES payments(id),
  status       TEXT NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS otp_sessions (
  ref        TEXT PRIMARY KEY,
  phone      TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('PENDING','VERIFIED','EXPIRED')),
  attempts   INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
