"use strict";

const express = require("express");
const crypto = require("node:crypto");
const { createHold } = require("./holds");
const { BadRequestError } = require("../../shared/errors");

const router = express.Router();

router.post("/holds", async (req, res, next) => {
  try {
    const { showtime_id, seat_id } = req.body || {};
    if (!Number.isFinite(showtime_id) || !Number.isFinite(seat_id)) {
      throw new BadRequestError("showtime_id and seat_id are required numbers");
    }
    const ttl = parseInt(process.env.HOLD_TTL_SECONDS || "300", 10);
    if (!Number.isFinite(ttl) || ttl <= 0) {
      throw new BadRequestError("invalid HOLD_TTL_SECONDS");
    }
    const holdId = crypto.randomUUID();
    await createHold({
      showtimeId: showtime_id,
      seatId: seat_id,
      holdId,
      ttlSeconds: ttl,
    });
    res.status(201).json({ ok: true, hold_id: holdId, expires_in: ttl });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
