-- Phase 2 — seed data.
-- 3 movies, 2 theatres × 2 screens × 10x12 seats, 6 showtimes.
-- Scenario A (Phase 8) targets the Spider-Man premiere showtime:
--   movie = "Spider-Man: Brand New Day"
--   showtime at tonight 20:00 in Star Cineplex - Hall A (screen_id = 1)
-- Idempotent via TRUNCATE ... RESTART IDENTITY CASCADE so re-seeding is safe.

BEGIN;

TRUNCATE
  payment_events, payments, bookings, show_seats,
  showtimes, seats, screens, theatres, movies, otp_sessions
RESTART IDENTITY CASCADE;

-- Movies (Spider-Man is intentionally first so it gets id = 1).
INSERT INTO movies (title, poster_url, duration_min) VALUES
  ('Spider-Man: Brand New Day',
   'https://upload.wikimedia.org/wikipedia/commons/thumb/2/26/Spider-Man_2024_Poster.jpg/220px-Spider-Man_2024_Poster.jpg',
   148),
  ('The Batman: Part II',
   NULL,
   175),
  ('Dune: Part Three',
   NULL,
   166);

-- Theatres and screens.
INSERT INTO theatres (name, location) VALUES
  ('Star Cineplex', 'Bashundhara City, Dhaka'),
  ('Blockbuster Cinemas', 'Jamuna Future Park, Dhaka');

-- Screens: 2 per theatre → ids 1..4.
INSERT INTO screens (theatre_id, name) VALUES
  (1, 'Hall A'),
  (1, 'Hall B'),
  (2, 'Screen 1'),
  (2, 'Screen 2');

-- Seats: 10 rows × 12 seats per screen = 120 per screen, 480 total.
-- Rows A..J, seats 1..12.
INSERT INTO seats (screen_id, row_label, seat_number)
SELECT s.id, r.lbl, n.num
FROM screens s
CROSS JOIN (VALUES ('A'), ('B'), ('C'), ('D'), ('E'),
                   ('F'), ('G'), ('H'), ('I'), ('J')) AS r(lbl)
CROSS JOIN generate_series(1, 12) AS n(num)
ORDER BY s.id, r.lbl, n.num;

-- Showtimes.
-- "tonight" computed in the DB so the demo always lines up.
WITH base AS (
  SELECT date_trunc('day', now()) AS d
)
INSERT INTO showtimes (movie_id, screen_id, starts_at, base_price)
SELECT * FROM (VALUES
  -- Today — Scenario A target is this one (movie 1, screen 1, tonight 20:00).
  (1, 1, ((SELECT d FROM base) + interval '20 hour')::timestamptz, 550.00),
  -- Today — second show, different screen.
  (2, 2, ((SELECT d FROM base) + interval '18 hour')::timestamptz, 600.00),
  -- Tomorrow.
  (3, 3, ((SELECT d FROM base) + interval '1 day 17 hour')::timestamptz, 500.00),
  -- Tomorrow (second hall of Star Cineplex).
  (1, 1, ((SELECT d FROM base) + interval '1 day 14 hour')::timestamptz, 550.00),
  -- +5 days.
  (2, 4, ((SELECT d FROM base) + interval '5 day 20 hour')::timestamptz, 650.00),
  -- +7 days.
  (3, 3, ((SELECT d FROM base) + interval '7 day 21 hour')::timestamptz, 500.00)
) AS s(movie_id, screen_id, starts_at, base_price);

-- show_seats — one row per (showtime, seat) pair, all AVAILABLE.
INSERT INTO show_seats (showtime_id, seat_id, status)
SELECT st.id, se.id, 'AVAILABLE'
FROM showtimes st
JOIN seats se ON se.screen_id = st.screen_id;

COMMIT;