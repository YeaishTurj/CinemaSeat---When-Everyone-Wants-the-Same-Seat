"use strict";

const express = require("express");
const axios = require("axios");
const { GATEWAY_URL } = require("../../shared/gateway");

const router = express.Router();

/**
 * DEV-ONLY endpoint that returns the most recent OTP code the mock gateway
 * delivered for a given booking ref. The mock gateway doesn't actually send
 * SMS — it just logs to stdout — so during demos we expose that to the
 * browser to avoid alt-tabbing to a terminal. It uses the gateway's
 * documented GET /debug/otp/:ref endpoint; no Docker socket is required.
 *
 * Disabled unless ENABLE_DEV_OTP=true.
 */
router.get("/dev/otp-latest/:ref", async (req, res) => {
  if (process.env.ENABLE_DEV_OTP !== "true") {
    return res.status(404).json({ ok: false, code: "NOT_FOUND" });
  }
  const ref = String(req.params.ref || "").replace(/[^a-zA-Z0-9_]/g, "");
  if (!ref) {
    return res
      .status(400)
      .json({ ok: false, code: "BAD_REQUEST", message: "bad ref" });
  }

  try {
    const response = await axios.get(
      `${GATEWAY_URL}/debug/otp/${encodeURIComponent(ref)}`,
      {
        timeout: 4000,
        validateStatus: (status) => status === 200 || status === 404,
      },
    );
    if (response.status === 404) {
      return res.json({ ok: true, ref, delivered: false });
    }

    const record = response.data?.otp || response.data || {};
    const code = record.code == null ? null : String(record.code);
    return res.json({
      ok: true,
      ref,
      delivered: Boolean(code),
      code,
      status: record.status || null,
      verified: Boolean(record.verified),
    });
  } catch (e) {
    return res
      .status(503)
      .json({ ok: false, code: "GATEWAY_UNAVAILABLE", message: e.message });
  }
});

module.exports = router;
