"use strict";

const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Plan §4.5 / §5.4: max ≥ 20 so the 100-concurrent holds test has headroom.
  max: parseInt(process.env.PG_POOL_MAX || "30", 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (err) => {
  // eslint-disable-next-line no-console
  console.error("[pg] idle client error", err);
});

async function query(text, params) {
  const started = Date.now();
  try {
    const res = await pool.query(text, params);
    return res;
  } finally {
    const ms = Date.now() - started;
    if (ms > 200) {
      // eslint-disable-next-line no-console
      console.warn(
        `[pg] slow query ${ms}ms: ${text.split("\n")[0].slice(0, 80)}`,
      );
    }
  }
}

async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {
      /* swallow rollback error */
    }
    throw e;
  } finally {
    client.release();
  }
}

async function shutdown() {
  await pool.end();
}

module.exports = { pool, query, withTx, shutdown };
