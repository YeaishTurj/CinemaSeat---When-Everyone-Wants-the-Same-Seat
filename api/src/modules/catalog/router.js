"use strict";

const express = require("express");
const { query } = require("../../shared/db");

const router = express.Router();

// GET /movies — list of available movies.
router.get("/movies", async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, title, poster_url, duration_min FROM movies ORDER BY id`,
    );
    res.json({ ok: true, movies: rows });
  } catch (e) {
    next(e);
  }
});

// GET /showtimes?movie_id=... — showtimes for a movie.
router.get("/showtimes", async (req, res, next) => {
  try {
    const movieId = parseInt(req.query.movie_id, 10);
    if (!Number.isFinite(movieId)) {
      return res
        .status(400)
        .json({ ok: false, code: "BAD_REQUEST", message: "movie_id required" });
    }
    const { rows } = await query(
      `SELECT s.id, s.movie_id, s.screen_id, s.starts_at, s.base_price,
              sc.name AS screen_name, t.name AS theatre_name
         FROM showtimes s
         JOIN screens sc ON sc.id = s.screen_id
         JOIN theatres t ON t.id = sc.theatre_id
        WHERE s.movie_id = $1
        ORDER BY s.starts_at`,
      [movieId],
    );
    res.json({ ok: true, showtimes: rows });
  } catch (e) {
    next(e);
  }
});

// GET /showtimes/:id/seats — full seat map with availability.
router.get("/showtimes/:id/seats", async (req, res, next) => {
  try {
    const showtimeId = parseInt(req.params.id, 10);
    if (!Number.isFinite(showtimeId)) {
      return res
        .status(400)
        .json({ ok: false, code: "BAD_REQUEST", message: "invalid id" });
    }
    const { rows } = await query(
      `SELECT se.id AS seat_id, se.row_label, se.seat_number,
              ss.status, ss.hold_expires_at
         FROM show_seats ss
         JOIN seats se ON se.id = ss.seat_id
        WHERE ss.showtime_id = $1
        ORDER BY se.row_label, se.seat_number`,
      [showtimeId],
    );
    res.json({ ok: true, showtime_id: showtimeId, seats: rows });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
