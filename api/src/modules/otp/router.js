"use strict";

const express = require("express");

const { withTx } = require("../../shared/db");
const { verify: verifyHmac } = require("../../shared/hmac");

const router = express.Router();

/**
 * POST /webhooks/otp
 *
 * Gateway reference §"Verifying the signature" — must read the raw body,
 * NOT a JSON-parsed object. Mounted in app.js ahead of express.json().
 *
 * Payload: { ref, code, status }
 *   - ref is the idempotency key the api sent on /otp/send (the booking id
 *     stringified, e.g. "bk_1").
 *   - status: "DELIVERED" (code logged), "VERIFIED" (user passed the code),
 *     or "EXPIRED".
 *
 * The otp_sessions.ref PK handles dedup: repeated updates are harmless.
 */
router.post(
  "/webhooks/otp",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.get("X-Signature");
    const secret = process.env.GATEWAY_SECRET;
    if (!secret) {
      req.log?.error({ err: "no GATEWAY_SECRET configured" }, "webhook config");
      return res.status(500).end();
    }
    if (!verifyHmac(req.body, secret, signature)) {
      req.log?.warn({ signature }, "webhook bad signature");
      return res.status(401).end();
    }

    let payload;
    try {
      payload = JSON.parse(req.body.toString("utf8"));
    } catch (e) {
      req.log?.error({ err: e.message }, "webhook malformed json");
      return res.status(200).end();
    }

    try {
      await handleOtpEvent(payload, req);
    } catch (e) {
      req.log?.error({ err: e.message, evt: payload }, "otp webhook failed");
      // Ack-and-log per ARCHITECTURE §10.1.
    }
    return res.status(200).end();
  },
);

async function handleOtpEvent(payload, req) {
  const { ref, status } = payload;
  if (!ref) return; // nothing we can do

  await withTx(async (client) => {
    if (status === "VERIFIED") {
      // Increment attempts on the success path; never decrement VERIFIED → PENDING.
      const { rows } = await client.query(
        `UPDATE otp_sessions
            SET status = 'VERIFIED',
                attempts = attempts + 1
          WHERE ref = $1
        RETURNING ref`,
        [ref],
      );
      if (rows.length === 0) {
        // No matching session yet (race with /otp/send). The /otp/send route
        // upserts, so this only fires if the webhook arrives first. Re-check.
        await client.query(
          `INSERT INTO otp_sessions (ref, phone, status, attempts)
                VALUES ($1, '', 'VERIFIED', 1)
           ON CONFLICT (ref) DO UPDATE SET status = 'VERIFIED',
                                           attempts = otp_sessions.attempts + 1`,
          [ref],
        );
      }
    } else if (status === "EXPIRED") {
      await client.query(
        `UPDATE otp_sessions SET status = 'EXPIRED' WHERE ref = $1`,
        [ref],
      );
    } else {
      // DELIVERED — bump attempts. The code remains gateway-owned; the
      // dev-only helper reads it from the gateway's documented debug API.
      await client.query(
        `UPDATE otp_sessions
            SET status = 'PENDING',
                attempts = attempts + 1
          WHERE ref = $1 AND status <> 'VERIFIED'`,
        [ref],
      );
      // If the session row doesn't exist yet (race with /otp/send), create
      // it. Same shape as the VERIFIED fallback above.
      await client.query(
        `INSERT INTO otp_sessions (ref, phone, status, attempts)
              VALUES ($1, '', 'PENDING', 1)
         ON CONFLICT (ref) DO NOTHING`,
        [ref],
      );
    }
  });
}

module.exports = router;
module.exports.handleOtpEvent = handleOtpEvent;
