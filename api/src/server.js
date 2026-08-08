"use strict";

const { createApp } = require("./app");

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = "0.0.0.0";

const app = createApp();

const server = app.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`[api] listening on http://${HOST}:${PORT}`);
});

function shutdown(signal) {
  // eslint-disable-next-line no-console
  console.log(`[api] received ${signal}, draining…`);
  server.close((err) => {
    if (err) {
      // eslint-disable-next-line no-console
      console.error("[api] error during shutdown", err);
      process.exit(1);
    }
    process.exit(0);
  });
  // Force exit if close hangs (gateway down tests etc.).
  setTimeout(() => process.exit(1), 8000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
