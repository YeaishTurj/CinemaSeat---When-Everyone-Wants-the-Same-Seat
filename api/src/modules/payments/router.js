"use strict";

const express = require("express");

const router = express.Router();

router.post("/webhooks/payment", (_req, res) => {
  res
    .status(501)
    .json({ ok: false, code: "NOT_IMPLEMENTED", message: "Phase 5" });
});

module.exports = router;
