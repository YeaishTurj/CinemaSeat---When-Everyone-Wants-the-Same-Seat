"use strict";

class AppError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.code = code;
  }
}

class BadRequestError extends AppError {
  constructor(message = "bad request") {
    super(message, 400, "BAD_REQUEST");
  }
}
class UnauthorizedError extends AppError {
  constructor(message = "unauthorized") {
    super(message, 401, "UNAUTHORIZED");
  }
}
class NotFoundError extends AppError {
  constructor(message = "not found") {
    super(message, 404, "NOT_FOUND");
  }
}
class ConflictError extends AppError {
  constructor(message = "conflict") {
    super(message, 409, "CONFLICT");
  }
}
class GatewayError extends AppError {
  constructor(message = "gateway error") {
    super(message, 502, "GATEWAY_ERROR");
  }
}

function errorMiddleware(err, req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({
      ok: false,
      code: err.code,
      message: err.message,
    });
  }
  // eslint-disable-next-line no-console
  console.error("[err]", req.method, req.originalUrl, err);
  return res.status(500).json({
    ok: false,
    code: "INTERNAL",
    message: "internal server error",
  });
}

module.exports = {
  AppError,
  BadRequestError,
  UnauthorizedError,
  NotFoundError,
  ConflictError,
  GatewayError,
  errorMiddleware,
};
