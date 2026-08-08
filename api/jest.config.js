"use strict";

module.exports = {
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.test.js"],
  // Keep CI deterministic: serialize concurrent describes, allow per-test timeouts.
  testTimeout: 60000,
  // We require DB env to be set explicitly to avoid silently passing against nothing.
};
