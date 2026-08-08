"use strict";

const crypto = require("node:crypto");

function requestId(req, _res, next) {
  req.id = req.headers["x-request-id"] || crypto.randomUUID();
  next();
}

function accessLogger(req, res, next) {
  const start = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - start;
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        t: "req",
        id: req.id,
        m: req.method,
        p: req.originalUrl,
        s: res.statusCode,
        ms,
      }),
    );
  });
  next();
}

module.exports = { requestId, accessLogger };
