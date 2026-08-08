"use strict";

const express = require("express");

const { requestId, accessLogger } = require("./shared/logger");
const { errorMiddleware } = require("./shared/errors");

const health = require("./modules/health/router");
const catalog = require("./modules/catalog/router");
const seats = require("./modules/seats/router");
const bookings = require("./modules/bookings/router");
const payments = require("./modules/payments/router");
const otp = require("./modules/otp/router");
const otpDev = require("./modules/otp/dev");

function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", true);

  app.use(requestId);
  app.use(accessLogger);

  // Webhook endpoints must read the raw body for HMAC verification.
  // Mount them BEFORE express.json() so the body arrives as a Buffer,
  // not a JSON-parsed object. See ARCHITECTURE.md §10 + gateway reference.
  app.use(payments); // /webhooks/payment
  app.use(otp); // /webhooks/otp

  app.use(
    express.json({
      limit: "256kb",
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  // Modules.
  app.use(health); // /health
  app.use(catalog); // /movies, /showtimes, /showtimes/:id/seats
  app.use(seats); // /holds
  app.use(bookings); // /bookings...
  app.use(otpDev); // /dev/otp-latest/:ref — dev-only

  // 404.
  app.use((req, res) => {
    res.status(404).json({
      ok: false,
      code: "NOT_FOUND",
      message: `no route for ${req.method} ${req.originalUrl}`,
    });
  });

  app.use(errorMiddleware);

  return app;
}

module.exports = { createApp };
