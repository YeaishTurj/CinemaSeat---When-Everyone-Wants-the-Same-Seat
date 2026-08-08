"use strict";

const express = require("express");

const router = express.Router();

router.post("/webhooks/otp", (_req, res) => {
  res
    .status(501)
    .json({ ok: false, code: "NOT_IMPLEMENTED", message: "Phase 4" });
});

module.exports = router;
