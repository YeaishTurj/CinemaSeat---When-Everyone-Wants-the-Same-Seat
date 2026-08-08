"use strict";

const crypto = require("crypto");

/**
 * HMAC-SHA256 signature helper for gateway webhooks.
 *
 * The gateway sends `X-Signature: <hex>` derived from the raw request body
 * (NOT from the JSON-parsed object — whitespace matters). Receivers must
 * therefore capture the raw Buffer before any JSON parser runs and verify
 * against it.

 * The comparison is constant-time via crypto.timingSafeEqual so signature
 * equality can't be probed by response timing.
 */
function sign(rawBody, secret) {
  return crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
}

function verify(rawBody, secret, signature) {
  if (!signature || typeof signature !== "string") return false;
  const expected = sign(rawBody, secret);
  if (expected.length !== signature.length) return false;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(signature, "hex"),
    );
  } catch (_) {
    // Bad hex on the wire — treat as auth failure.
    return false;
  }
}

module.exports = { sign, verify };
