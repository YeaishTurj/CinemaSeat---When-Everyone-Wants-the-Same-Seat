"use strict";

const express = require("express");

const router = express.Router();

// Liveness — does NOT touch DB or gateway, so it answers even when deps are down
// (judging hook #1 from plan.md §3).
router.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, service: "api", ts: Date.now() });
});

module.exports = router;
