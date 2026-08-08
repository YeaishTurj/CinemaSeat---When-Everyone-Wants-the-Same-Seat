"use strict";

const express = require("express");

const router = express.Router();

router.post("/bookings", (_req, res) => {
  res
    .status(501)
    .json({ ok: false, code: "NOT_IMPLEMENTED", message: "Phase 4" });
});

router.get("/bookings/:id", (_req, res) => {
  res
    .status(501)
    .json({ ok: false, code: "NOT_IMPLEMENTED", message: "Phase 4" });
});

router.post("/bookings/:id/pay", (_req, res) => {
  res
    .status(501)
    .json({ ok: false, code: "NOT_IMPLEMENTED", message: "Phase 4" });
});

router.post("/bookings/:id/otp/send", (_req, res) => {
  res
    .status(501)
    .json({ ok: false, code: "NOT_IMPLEMENTED", message: "Phase 4" });
});

router.post("/bookings/:id/otp/verify", (_req, res) => {
  res
    .status(501)
    .json({ ok: false, code: "NOT_IMPLEMENTED", message: "Phase 4" });
});

module.exports = router;
