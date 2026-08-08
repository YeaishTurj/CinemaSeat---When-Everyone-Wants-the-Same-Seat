"use strict";

// Gateway client. Source of truth: plan.md §4.4 + gateway reference.
// IMPORTANT: the callback_url passed in must use the Compose service name
// (http://api:3000/...) so the gateway container can reach us.

const axios = require("axios");

const GATEWAY_URL = process.env.GATEWAY_URL || "http://gateway:9000";
const TIMEOUT_MS = parseInt(process.env.GATEWAY_TIMEOUT_MS || "6000", 10);

async function charge({
  amount,
  currency = "BDT",
  booking_ref,
  callback_url,
  idempotencyKey,
  mock = {},
}) {
  // Force scenarios must run without deterministic mode; the provided
  // gateway gives deterministic success precedence over some force values.
  const mockMode = mock.force
    ? undefined
    : mock.mode || process.env.GATEWAY_MOCK_MODE;
  return axios.post(
    `${GATEWAY_URL}/charge`,
    { amount, currency, booking_ref, callback_url },
    {
      headers: {
        "Idempotency-Key": idempotencyKey,
        ...(mockMode ? { "X-Mock-Mode": mockMode } : {}),
        ...(mock.force ? { "X-Mock-Force": mock.force } : {}),
      },
      timeout: TIMEOUT_MS,
      // We want to inspect 4xx ourselves; only treat 5xx / network errors as throws.
      validateStatus: (s) => s >= 200 && s < 300,
    },
  );
}

async function sendOtp({ phone, ref, callback_url }) {
  const mockMode = process.env.OTP_MOCK_MODE;
  return axios.post(
    `${GATEWAY_URL}/otp/send`,
    { phone, ref, callback_url },
    {
      headers: mockMode ? { "X-Mock-Mode": mockMode } : {},
      timeout: TIMEOUT_MS,
      validateStatus: (s) => s >= 200 && s < 300,
    },
  );
}

async function verifyOtp({ ref, code }) {
  return axios.post(
    `${GATEWAY_URL}/otp/verify`,
    { ref, code },
    { timeout: TIMEOUT_MS, validateStatus: (s) => s >= 200 && s < 300 },
  );
}

module.exports = { charge, sendOtp, verifyOtp, GATEWAY_URL };
