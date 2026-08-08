# CinemaSeat — Build Plan

**Event:** Zero to Production · Phase 2 · IEEECS CUET (8 Aug 2026, 9:00 AM – 8:00 PM)
**Reference:** `ARCHITECTURE.md` (design), `CinemaSeat_Problem_Statement.pdf` (what), `CinemaSeat_Gateway_Reference.pdf` (gateway contract), `Zero_to_Production_Rulebook.pdf` (rules + scoring)
**Stack:** Next.js 16 + React 19 (JS), Node.js + Express (JS), PostgreSQL (raw SQL via `pg`), Docker / Docker Compose, GitHub Actions, Poridhi-provided AWS EC2
**Build method:** AI-agent-implemented, human-understood and human-defended (rulebook §6.3)

---

## 0. How to use this plan

- Build the phases **in order**. Each phase has explicit deliverables, docker-validation, and a done-when checklist.
- Every service is **containerised from day one** — never run anything natively on the host unless the phase explicitly says so for a one-off reason.
- A phase is **done** only when its `docker compose up` validation passes and the done-when checklist is empty.
- The build follows the rulebook §5 timeline (09:30 stack up, 14:30 core flow, 17:30 deployed, 18:00 reports, 18:30 freeze). Reverse "nine hours on features, one on Docker" — Docker is the first thing we wire, not the last.

---

## 1. Phase map (all timestamps from the rulebook §5 timeline)

| # | Phase | Time box | Goal | Done when |
|---|---|---|---|---|
| 0 | **Pre-event prep** | before 09:00 | All tooling installed, gateway image pre-pulled, accounts ready | n/a — check before arriving |
| 1 | **The skeleton** | 09:30 – 10:30 | `docker compose up` brings up four containers (frontend placeholder, api placeholder, postgres, gateway) | `curl localhost:3000/health` returns 200 in <1s |
| 2 | **Data model + gateway wiring** | 10:30 – 12:00 | Schema migrated, gateway talked to, raw client works | `psql` shows tables; gateway `/charge` returns 202 from inside the api container |
| 3 | **Concurrency-critical path** | 12:00 – 13:30 | `POST /holds` with `SELECT … FOR UPDATE` working against real Postgres in Docker | 100 concurrent `POST /holds` on one seat → exactly 1 success |
| 4 | **Full booking flow** | 13:30 – 15:00 | browse → seat map → hold → OTP → pay → confirm works end-to-end | Manual demo from `docker compose up` succeeds |
| 5 | **Webhook hardening** | 15:00 – 16:00 | HMAC verification, duplicate dedup, race handling, 2xx-on-duplicate | `/debug/deliveries` shows `ok:true`; duplicate test passes |
| 6 | **Containerisation + CI** | 16:00 – 17:00 | Multi-stage Dockerfiles, CI green on PR | GitHub Actions badge green; image size sane |
| 7 | **Deployment** | 17:00 – 18:00 | Stack live on AWS EC2, public URL | Judge can hit the URL and reserve a seat |
| 8 | **Proof + docs** | 18:00 – 18:30 | Scenario A report, Scenario B report, README, DECISIONS.md | All four deliverables in the repo |

---

## 2. Phase 0 — Pre-event prep (do before arriving)

### 2.1 Local tooling

- `docker --version` → 24+ (Compose v2 included)
- `docker compose version` → v2.20+
- `node --version` → 20+ (only for IDE / linting; everything runs in containers)
- `git --version` → 2.30+
- `psql` client (optional, for sanity-checking migrations)
- `k6` (for Scenario C; install before the day)

### 2.2 Accounts

- GitHub account with a **new public repo** created **after** the Opening Ceremony (rulebook §6.2)
- Poridhi lab launched at 09:00 AM sharp (rulebook §5); one designated infra owner
- AWS account (Poridhi-provided) if we attempt the bonus path

### 2.3 Pre-pull the gateway image (rulebook §9.2, gateway reference §"Run it")

```bash
docker pull asifmahmoud414/mock-gateway:latest
```

- **Why this on day zero:** venue Wi-Fi with 25 teams pulling simultaneously is not where we want to discover a problem (gateway reference explicit).

### 2.4 Repository skeleton (created at 09:00, not before)

```
.
├── ARCHITECTURE.md          ← already exists
├── README.md                ← placeholder
├── plan.md                  ← this file
├── .gitignore               ← already done
├── .env.example             ← committed on day one
├── docker-compose.yml       ← root, brings up everything
├── frontend/                ← Next.js app
├── api/                     ← Node.js + Express
├── db/
│   ├── migrations/          ← SQL migration files
│   └── seed/                ← pre-populated movies/showtimes/seats
├── .github/
│   └── workflows/
│       ├── ci.yml           ← build + test on PR/push
│       └── deploy.yml       ← deploy on main push only
└── docs/
    ├── scenarioA.md         ← filled in Phase 8
    ├── scenarioB.md         ← filled in Phase 8
    └── scenarioC.md         ← filled in Phase 8
```

---

## 3. Phase 1 — The skeleton (09:30 – 10:30)

**Goal:** `docker compose up` brings up four containers (frontend, api, postgres, gateway) on a clean clone. `/health` returns 200 in <1s. **No business logic yet.**

### 3.1 Deliverables

1. Root `docker-compose.yml` with four services
2. `frontend/Dockerfile` (Next.js placeholder returning 200)
3. `api/Dockerfile` (Express placeholder returning 200 on `/health`)
4. `db/migrations/0001_init.sql` (empty / no tables yet, just to confirm the migration runner works)
5. `.env.example` with: `HOLD_TTL_SECONDS`, `DATABASE_URL`, `GATEWAY_URL`, `GATEWAY_SECRET`, `PORT`
6. `seed/` placeholder folder

### 3.2 Root `docker-compose.yml` (Phase 1 version)

```yaml
services:
  frontend:
    build: ./frontend
    ports: ["3000:3000"]
    depends_on: [api]

  api:
    build: ./api
    ports: ["3001:3000"]
    environment:
      - PORT=3000
      - DATABASE_URL=postgres://postgres:postgres@postgres:5432/cinema
      - GATEWAY_URL=http://gateway:9000
      - GATEWAY_SECRET=${GATEWAY_SECRET}
      - HOLD_TTL_SECONDS=${HOLD_TTL_SECONDS:-300}
    depends_on:
      postgres: { condition: service_healthy }
      gateway:  { condition: service_healthy }

  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: cinemaseat
    volumes:
      - pgdata:/var/lib/postgresql/data
      # Postgres only auto-runs *.sql files at the top of docker-entrypoint-initdb.d
      # in lexicographic order. Mount a single combined directory so
      # migrations then seed run in sequence on first boot.
      # db/init/0001_init.sql  ← schema
      # db/init/0002_seed.sql  ← seed
      - ./db/init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 10

  gateway:
    image: asifmahmoud414/mock-gateway:latest
    ports: ["9000:9000"]
    healthcheck:
      # gateway binds IPv4-only; `localhost` resolves to ::1 inside this image,
      # so use 127.0.0.1 explicitly. wget ships with the image.
      test: ["CMD", "wget", "-q", "-O", "-", "http://127.0.0.1:9000/health"]
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  pgdata:
```

### 3.3 `frontend/Dockerfile` (Phase 1 placeholder — replaced in Phase 4)

```dockerfile
FROM node:20-alpine
WORKDIR /app
RUN npm init -y >/dev/null && npm install next@14 react@18 react-dom@18
COPY . .
RUN npm run build || true
EXPOSE 3000
CMD ["npx", "next", "dev", "-p", "3000"]
```

### 3.4 `api/Dockerfile` (Phase 1 placeholder — extended in Phase 2+)

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["node", "src/server.js"]
```

### 3.5 Done-when checklist

- [ ] `docker compose up -d` succeeds on a clean clone
- [ ] `curl http://localhost:3001/health` returns 200 in <1s
- [ ] `curl http://localhost:9000/health` returns 200
- [ ] `docker compose down -v` then `docker compose up -d` again still works (idempotent)
- [ ] The api container `/health` works **even when the gateway is down** (kill gateway, curl health, restart gateway) — this is judging hook #1

---

## 4. Phase 2 — Data model + gateway wiring (10:30 – 12:00)

**Goal:** Postgres schema migrated, gateway reachable from inside the api container, all five base tables exist.

### 4.1 Migration files

`db/migrations/0001_init.sql` — exact schema from `ARCHITECTURE.md` §7:

```sql
CREATE TABLE movies (
  id           SERIAL PRIMARY KEY,
  title        TEXT NOT NULL,
  poster_url   TEXT,
  duration_min INT NOT NULL
);

CREATE TABLE theatres (
  id        SERIAL PRIMARY KEY,
  name      TEXT NOT NULL,
  location  TEXT
);

CREATE TABLE screens (
  id          SERIAL PRIMARY KEY,
  theatre_id  INT NOT NULL REFERENCES theatres(id),
  name        TEXT NOT NULL
);

CREATE TABLE showtimes (
  id          SERIAL PRIMARY KEY,
  movie_id    INT NOT NULL REFERENCES movies(id),
  screen_id   INT NOT NULL REFERENCES screens(id),
  starts_at   TIMESTAMPTZ NOT NULL,
  base_price  NUMERIC(10,2) NOT NULL
);

CREATE TABLE seats (
  id          SERIAL PRIMARY KEY,
  screen_id   INT NOT NULL REFERENCES screens(id),
  row_label   TEXT NOT NULL,
  seat_number INT NOT NULL,
  UNIQUE (screen_id, row_label, seat_number)
);

CREATE TABLE show_seats (
  id              SERIAL PRIMARY KEY,
  showtime_id     INT NOT NULL REFERENCES showtimes(id),
  seat_id         INT NOT NULL REFERENCES seats(id),
  status          TEXT NOT NULL CHECK (status IN ('AVAILABLE','HELD','BOOKED')),
  hold_id         TEXT,
  hold_expires_at TIMESTAMPTZ,
  booking_id      INT,
  UNIQUE (showtime_id, seat_id)
);
CREATE INDEX ON show_seats (showtime_id, status);
CREATE INDEX ON show_seats (hold_expires_at) WHERE status = 'HELD';

CREATE TABLE bookings (
  id           SERIAL PRIMARY KEY,
  showtime_id  INT NOT NULL REFERENCES showtimes(id),
  user_ref     TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('PENDING','CONFIRMED','CANCELLED','EXPIRED')),
  total_amount NUMERIC(10,2) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payments (
  id                 SERIAL PRIMARY KEY,
  booking_id         INT NOT NULL REFERENCES bookings(id),
  gateway_payment_id TEXT,
  idempotency_key    TEXT NOT NULL,
  status             TEXT NOT NULL CHECK (status IN ('PENDING','SUCCEEDED','FAILED','REFUNDED')),
  amount             NUMERIC(10,2) NOT NULL,
  UNIQUE (booking_id),
  UNIQUE (idempotency_key)
);

CREATE TABLE payment_events (
  event_id     TEXT PRIMARY KEY,         -- gateway's dedup key
  payment_id   INT NOT NULL REFERENCES payments(id),
  status       TEXT NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE TABLE otp_sessions (
  ref        TEXT PRIMARY KEY,
  phone      TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('PENDING','VERIFIED','EXPIRED')),
  attempts   INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Migrations run automatically via Postgres's `docker-entrypoint-initdb.d` on first boot. Both files are mirrored into `db/init/0001_init.sql` and `db/init/0002_seed.sql` so Postgres picks them up in lexicographic order. For subsequent boots against an existing volume (`docker compose up -d` without `-v`), scripts do NOT re-run — Postgres only auto-runs them on a fresh `pgdata`. To re-apply, `docker compose down -v` first.

### 4.2 Seed data

`db/seed/0001_seed.sql` — pre-populate:
- 3 movies (including "Spider-Man: Brand New Day" since that's the problem statement scenario)
- 2 theatres × 2 screens × 10x12 seats
- 6 showtimes (mix of today / tomorrow / next week)
- The premiere showtime must have a seat that **all 100 contestants will fight for** — we run Scenario A against it

### 4.3 API module skeleton

```
api/src/
├── server.js          # boot, graceful shutdown
├── app.js             # Express app factory
├── shared/
│   ├── db.js          # pg pool, query() helper, withTx() helper
│   ├── errors.js      # error classes, error middleware
│   └── logger.js      # structured logger with request id
└── modules/
    ├── health/        # already from Phase 1
    ├── catalog/       # GET /movies, GET /showtimes/:id/seats
    ├── seats/         # POST /holds (the critical one)
    ├── bookings/      # POST /bookings, GET /bookings/:id, POST /bookings/:id/pay
    ├── payments/      # POST /webhooks/payment
    └── otp/           # POST /bookings/:id/otp/send, /otp/verify, POST /webhooks/otp
```

### 4.4 Gateway client (`shared/gateway.js`)

```js
const axios = require('axios');
const GATEWAY_URL = process.env.GATEWAY_URL;

async function charge({ amount, currency = 'BDT', booking_ref, callback_url, idempotencyKey, mock = {} }) {
  return axios.post(`${GATEWAY_URL}/charge`, {
    amount, currency, booking_ref, callback_url,
  }, {
    headers: {
      'Idempotency-Key': idempotencyKey,
      ...(mock.mode ? { 'X-Mock-Mode': mock.mode } : {}),
      ...(mock.force ? { 'X-Mock-Force': mock.force } : {}),
    },
    timeout: 6000,
  });
}

async function sendOtp({ phone, ref, callback_url }) {
  return axios.post(`${GATEWAY_URL}/otp/send`, { phone, ref, callback_url }, { timeout: 6000 });
}

async function verifyOtp({ ref, code }) {
  return axios.post(`${GATEWAY_URL}/otp/verify`, { ref, code }, { timeout: 6000 });
}

module.exports = { charge, sendOtp, verifyOtp };
```

### 4.5 Done-when checklist

- [ ] `docker compose down -v && docker compose up -d` runs migrations automatically
- [ ] `docker compose exec postgres psql -U postgres -d cinemaseat -c '\dt'` lists all 10 tables (9 from the schema + the `seats` table)
- [ ] `docker compose exec postgres psql -U postgres -d cinemaseat -c 'SELECT count(*) FROM show_seats;'` returns 720 (6 showtimes × 120 seats)
- [ ] From inside the api container: `wget -q -O - http://gateway:9000/health` returns 200 (proves internal DNS works)
- [ ] From inside the api container: `node -e "require('./src/shared/gateway').charge({amount:1,booking_ref:'x',callback_url:'http://api:3000/webhooks/payment',idempotencyKey:'x'})"` returns 202

> **Status (end of Phase 2):** all four checks pass against the live stack. Confirmed tables, seed counts, and gateway round-trip on 2026-08-08.

### 4.6 The "one bug everybody makes" reminder

The api's `callback_url` sent to the gateway **must** be `http://api:3000/webhooks/payment` (the Compose service name), **never** `http://localhost:3000/webhooks/payment`. `localhost` inside the gateway container refers to the gateway itself (gateway reference §"Run it").

---

## 5. Phase 3 — Concurrency-critical path (12:00 – 13:30)

**Goal:** `POST /holds` works against a real Postgres in Docker. 100 concurrent holds on one seat → exactly 1 success.

### 5.1 The `seats` module

`api/src/modules/seats/holds.js`:

```js
const { withTx } = require('../../shared/db');

async function createHold({ showtimeId, seatId, holdId, ttlSeconds }) {
  return withTx(async (client) => {
    const { rows } = await client.query(
      `SELECT status, hold_expires_at
         FROM show_seats
        WHERE showtime_id = $1 AND seat_id = $2
        FOR UPDATE`,
      [showtimeId, seatId]
    );
    if (rows.length === 0) throw new NotFoundError('seat not in this showtime');
    const row = rows[0];
    const isExpired = row.status === 'HELD' && row.hold_expires_at && row.hold_expires_at < new Date();
    if (row.status === 'BOOKED')                       throw new ConflictError('seat already booked');
    if (row.status === 'HELD' && !isExpired)          throw new ConflictError('seat currently held');
    // AVAILABLE or HELD-expired → proceed
    await client.query(
      `UPDATE show_seats
          SET status = 'HELD',
              hold_id = $3,
              hold_expires_at = now() + ($4 * interval '1 second')
        WHERE showtime_id = $1 AND seat_id = $2`,
      [showtimeId, seatId, holdId, ttlSeconds]
    );
  });
}
```

### 5.2 The route

```js
router.post('/holds', async (req, res, next) => {
  try {
    const { showtime_id, seat_id } = req.body;
    const ttl = parseInt(process.env.HOLD_TTL_SECONDS || '300', 10);
    if (!Number.isFinite(ttl) || ttl <= 0) throw new BadRequestError('invalid HOLD_TTL_SECONDS');
    const holdId = crypto.randomUUID();
    await createHold({ showtimeId: showtime_id, seatId: seat_id, holdId, ttlSeconds: ttl });
    res.status(201).json({ ok: true, hold_id: holdId, expires_in: ttl });
  } catch (e) { next(e); }
});
```

### 5.3 The test (maps to Scenario A, run in CI too)

`api/tests/holds.concurrency.test.js`:

```js
const request = require('supertest');
const app = require('../src/app');
const { pool } = require('../src/shared/db');

describe('POST /holds concurrency', () => {
  it('100 concurrent holds on one seat → exactly 1 success', async () => {
    const showtimeId = 1;       // from seed
    const seatId = 50;          // just any seat
    const N = 100;
    const responses = await Promise.all(
      Array.from({ length: N }, () =>
        request(app).post('/holds').send({ showtime_id: showtimeId, seat_id: seatId })
      )
    );
    const successes = responses.filter(r => r.status === 201).length;
    const conflicts = responses.filter(r => r.status === 409).length;
    expect(successes).toBe(1);
    expect(conflicts).toBe(N - 1);
    const { rows } = await pool.query(
      `SELECT status FROM show_seats WHERE showtime_id = $1 AND seat_id = $2`,
      [showtimeId, seatId]
    );
    expect(rows[0].status).toBe('HELD');
  }, 30000);
});
```

### 5.4 Done-when checklist

- [ ] `npm test` in `api/` passes the concurrency test
- [ ] Manual reproduction from `scripts/concurrent-holds.sh` (run from host against the dockerised api) shows 1 success / 99 conflicts
- [ ] `pool.max` is set to at least 20 in `shared/db.js`
- [ ] The locked transaction contains **only** the lock, the check, and the update — no extra queries

---

## 6. Phase 4 — Full booking flow (13:30 – 15:00)

**Goal:** browse → seat map → hold → OTP → pay → confirm works end-to-end from `docker compose up`.

### 6.1 Frontend screens (Next.js App Router)

```
frontend/app/
├── page.jsx               # /            — list of movies
├── showtimes/[id]/page.jsx
├── showtimes/[id]/seats/page.jsx
├── holds/new/page.jsx     # POST /holds, then redirect to /bookings/:id
├── bookings/[id]/page.jsx # OTP send/verify, pay, poll status
└── confirm/page.jsx       # post-success confirmation
```

Tailwind for styling. Each page is a small `fetch(...)` to the api (relative URL via nginx proxy in production, `NEXT_PUBLIC_API_URL` in dev).

### 6.2 The full backend flow

```
POST /bookings                       → create booking + reference seats by hold_id
POST /bookings/:id/otp/send          → call gateway /otp/send, return 202
POST /bookings/:id/otp/verify        → call gateway /otp/verify
POST /bookings/:id/pay               → §6.3
POST /webhooks/payment               → §7 (in Phase 5)
GET  /bookings/:id                   → current state for polling
```

### 6.3 `/pay` handler

```js
router.post('/bookings/:id/pay', async (req, res, next) => {
  try {
    const bookingId = parseInt(req.params.id, 10);
    // 1. create payment row keyed on booking_id
    const payment = await withTx(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO payments (booking_id, idempotency_key, status, amount)
              SELECT $1, $1, 'PENDING', total_amount
                FROM bookings WHERE id = $1
              ON CONFLICT (booking_id) DO UPDATE SET status = payments.status
              RETURNING *`,
        [bookingId]
      );
      return rows[0];
    });
    // 2. call gateway, retry once on 500/timeout
    const callbackUrl = `http://api:3000/webhooks/payment`;
    const callOnce = () => gateway.charge({
      amount: Number(payment.amount),
      booking_ref: `bk_${bookingId}`,
      callback_url: callbackUrl,
      idempotencyKey: `bk_${bookingId}`,
    });
    try {
      await callOnce();
    } catch (e) {
      if (e.response?.status >= 500 || e.code === 'ECONNABORTED') {
        await callOnce();   // retry once
      } else {
        throw e;
      }
    }
    res.status(202).json({ ok: true, status: 'PENDING' });
  } catch (e) { next(e); }
});
```

### 6.4 Done-when checklist

- [x] Manual demo from a clean `docker compose up`:
  1. Open http://localhost:3000
  2. Pick a movie → showtime → seat
  3. Click hold → success
  4. Receive OTP, type it in
  5. Click pay → see pending → wait → see confirmed
- [x] The whole demo completes in <30 seconds on deterministic mode
- [ ] Frontend talks to backend via one base URL (no second port from the user's view, or `nginx` reverse proxy in front)
- [ ] No raw SQL errors in the logs

---

## 7. Phase 5 — Webhook hardening (15:00 – 16:00)

**Goal:** Handle all five documented gateway misbehaviours + the race condition. Map everything in `ARCHITECTURE.md` §10.

### 7.1 HMAC verification with raw body (gateway reference §"Verifying the signature")

```js
const crypto = require('crypto');

router.post('/webhooks/payment',
  express.raw({ type: 'application/json' }),    // raw body, NOT JSON-parsed
  async (req, res) => {
    const signature = req.get('X-Signature');
    const expected = crypto
      .createHmac('sha256', process.env.GATEWAY_SECRET)
      .update(req.body)                          // Buffer
      .digest('hex');
    if (signature !== expected) return res.sendStatus(401);

    let payload;
    try { payload = JSON.parse(req.body.toString('utf8')); }
    catch { return res.status(200).end(); }      // ack malformed, log for later

    try {
      await handlePaymentEvent(payload);
    } catch (e) {
      req.log.error(e, 'webhook handler failed');
      // still 200 — see ARCHITECTURE.md §10.1
    }
    res.status(200).end();
  }
);
```

### 7.2 Duplicate-safe event handling

```js
async function handlePaymentEvent(evt) {
  // INSERT into payment_events — UNIQUE PK rejects dupe
  const inserted = await withTx(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO payment_events (event_id, payment_id, status, processed_at)
            SELECT $1, p.id, $2, now()
              FROM payments p
              JOIN bookings b ON b.id = p.booking_id
             WHERE b.id::text = $3 OR p.gateway_payment_id = $4
             ON CONFLICT (event_id) DO NOTHING
             RETURNING event_id`,
      [evt.event_id, evt.status, evt.booking_ref, evt.payment_id]
    );
    return rows[0];
  });
  if (!inserted) return;                        // duplicate, no-op

  await withTx(async (client) => {
    await client.query(
      `UPDATE payments SET status = $2, gateway_payment_id = $3 WHERE booking_id = $4`,
      [null, evt.status, evt.payment_id, evt.booking_ref.replace(/^bk_/, '')]
    );
    if (evt.status === 'SUCCEEDED') {
      await client.query(
        `UPDATE bookings SET status = 'CONFIRMED'
            WHERE id = $1 AND status = 'PENDING'`,
        [evt.booking_ref.replace(/^bk_/, '')]
      );
      await client.query(
        `UPDATE show_seats SET status = 'BOOKED', booking_id = $1
            WHERE showtime_id = (SELECT showtime_id FROM bookings WHERE id = $1)
              AND status = 'HELD'`,
        [evt.booking_ref.replace(/^bk_/, '')]
      );
    }
  });
}
```

### 7.3 OTP webhook

Same shape: `express.raw`, HMAC verify, `UNIQUE` on `otp_sessions.ref`, update the row so frontend polling can see the code.

### 7.4 Tests

```js
describe('POST /webhooks/payment', () => {
  it('rejects bad signature', async () => {
    const res = await request(app)
      .post('/webhooks/payment')
      .set('X-Signature', 'bad')
      .send({ event_id: 'x' });
    expect(res.status).toBe(401);
  });

  it('deduplicates by event_id', async () => {
    const event = { event_id: 'evt_1', payment_id: 'p_1', booking_ref: 'bk_1', status: 'SUCCEEDED', amount: 450 };
    const sig = sign(event);
    const r1 = await request(app).post('/webhooks/payment').set('X-Signature', sig).send(event);
    const r2 = await request(app).post('/webhooks/payment').set('X-Signature', sig).send(event);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const { rows } = await pool.query(`SELECT count(*) FROM payment_events WHERE event_id = 'evt_1'`);
    expect(rows[0].count).toBe('1');
  });
});
```

### 7.5 Done-when checklist

- [ ] `X-Mock-Force: duplicate` produces exactly one `payment_events` row
- [ ] `X-Mock-Force: fail` sets payment to FAILED and booking to CANCELLED
- [ ] `X-Mock-Force: race` does not crash (payment row exists before /charge returns)
- [ ] `X-Mock-Force: timeout` retries once then surfaces PENDING (no 500 to frontend)
- [ ] Bad signature → 401
- [ ] Gateway down → `/health` still 200, `/movies` and `/holds` still work, `/pay` returns clean error

---

## 8. Phase 6 — Containerisation + CI (16:00 – 17:00)

**Goal:** Every Dockerfile is multi-stage, image sizes are sane, CI is green on PRs.

> **Implemented and verified locally and on GitHub on 8 August 2026.** Both images are
> multi-stage/non-root, lockfiles are committed, real lint replaces placeholder
> scripts, all seven API tests pass against PostgreSQL, the Next.js production
> build passes, and Compose health checks are green. Measured images: API
> 49.9 MB, frontend 63.8 MB. The push CI and SSH deployment workflows passed,
> and the protected `main` ruleset requires both CI jobs before merging.

### 8.1 Multi-stage `api/Dockerfile`

```dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY src ./src
EXPOSE 3000
USER node
CMD ["node", "src/server.js"]
```

### 8.2 Multi-stage `frontend/Dockerfile`

```dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
EXPOSE 3000
USER node
CMD ["node", "server.js"]
```

### 8.3 `.github/workflows/ci.yml`

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
jobs:
  api-test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: cinema_test
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 5s --health-timeout 5s --health-retries 10
    env:
      DATABASE_URL: postgres://postgres:postgres@localhost:5432/cinema_test
      GATEWAY_SECRET: z2p-2026-secret
      HOLD_TTL_SECONDS: "10"
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm, cache-dependency-path: api/package-lock.json }
      - run: cd api && npm ci
      - run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/init/0001_init.sql
      - run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/init/0002_seed.sql
      - run: cd api && npm run lint
      - run: cd api && npm audit --omit=dev --audit-level=high
      - run: cd api && npm test
      - run: cd api && docker build -t api:ci .

  frontend-build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm, cache-dependency-path: frontend/package-lock.json }
      - run: cd frontend && npm ci
      - run: cd frontend && npm run lint
      - run: cd frontend && npm audit --omit=dev --audit-level=high
      - run: cd frontend && npm run build
      - run: cd frontend && docker build -t frontend:ci .
```

### 8.4 Deploy workflow (CD on main only — rulebook §7.1)

`.github/workflows/deploy.yml` is triggered by a completed CI workflow and
deploys only when that CI run succeeded, came from a push, and targeted
`main`. Required secrets are `PORIDHI_HOST`, `PORIDHI_USER`, and
`PORIDHI_SSH_KEY`. The remote script fast-forwards `~/cinemaseat`, rebuilds
Compose, and fails unless the API health check succeeds.

```yaml
name: Deploy
on:
  workflow_run:
    workflows: [CI]
    types: [completed]
jobs:
  deploy:
    if: github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.head_branch == 'main' && github.event.workflow_run.event == 'push'
    runs-on: ubuntu-latest
    steps:
      - uses: appleboy/ssh-action@v1.2.0
        with:
          host: ${{ secrets.PORIDHI_HOST }}
          username: ${{ secrets.PORIDHI_USER }}
          key: ${{ secrets.PORIDHI_SSH_KEY }}
          script: |
            set -e
            cd ~/cinemaseat
            git fetch origin main
            git checkout main
            git pull --ff-only origin main
            docker compose up -d --build --remove-orphans
            docker compose exec -T api node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
```

### 8.5 Done-when checklist

- [x] Every PR runs the api tests against a real Postgres service container
- [x] Every PR builds the api and frontend Docker images
- [x] `docker images` shows `api` < 250 MB and `frontend` < 400 MB (49.9 MB / 63.8 MB measured)
- [x] Successful default-branch push CI triggers the deploy workflow
- [x] PRs without green CI cannot be merged (branch protection rule)

The active `Main branch protection` ruleset protects `main`, blocks deletion
and force-pushes, requires pull requests, and requires the
`API lint, test, and image` and `Frontend lint, build, and image` checks.

---

## 9. Phase 7 — Deployment (17:00 – 18:00)

**Goal:** Stack live on the Poridhi-provided AWS EC2 instance, reachable at a public URL.

### 9.1 AWS EC2 setup (one-time)

1. Launch the Poridhi AWS lab and an Ubuntu 24.04 EC2 instance
2. Allow SSH plus public frontend/API ports in its security group
3. Install Docker + Compose v2
4. Clone the repo
5. Configure the three GitHub SSH secrets
6. `docker compose up -d --build`
7. Verify `curl http://localhost:3001/health` from the VM
8. Verify the public frontend and API health URLs

### 9.2 Production `docker-compose.yml` overlay

Same `docker-compose.yml` works in production. The only difference is the api container's `callback_url` already points to `http://api:3000/webhooks/payment` (Compose internal DNS works the same in any environment that uses Compose).

### 9.3 Done-when checklist

- [x] Public URL returns 200 on `/health` in <1s
- [x] Judge can run the full demo at the public URL (browse → seat → hold → OTP → pay → confirm)
- [ ] Public URL works with the gateway container stopped (bonus — fault isolation)
- [x] No localhost references anywhere in `callback_url` (the gateway reference's one-bug-everybody-makes)

### 9.4 AWS bonus result

- [x] Ubuntu EC2 deployment in the Poridhi-provided AWS account
- [x] Automated deployment over SSH after successful `main` CI
- [x] Same Compose images, environment contract, and health checks as local
- [ ] ALB, RDS, and multiple application instances (deliberately out of scope)

---

## 10. Phase 8 — Proof + docs (18:00 – 18:30)

**Goal:** Every required deliverable in the repo, every report reproducible.

### 10.1 Scenario A report (`docs/scenarioA.md`)

Run from the host (NOT inside the api container) against the deployed URL:

```bash
# scripts/scenarioA.sh
URL="${PUBLIC_URL:-http://localhost:3000}"
SHOWTIME_ID=1
SEAT_ID=50
N=100

for i in $(seq 1 $N); do
  curl -s -o /tmp/r$i.json -w "%{http_code}\n" \
    -X POST "$URL/holds" \
    -H "Content-Type: application/json" \
    -d "{\"showtime_id\":$SHOWTIME_ID,\"seat_id\":$SEAT_ID}" &
done
wait

SUCCESS=$(grep -l '"ok":true' /tmp/r*.json 2>/dev/null | wc -l)
CONFLICT=$(grep -l '409' /tmp/r*.json 2>/dev/null | wc -l)
echo "successful_holds: $SUCCESS"
echo "conflicts:        $CONFLICT"
echo "oversell:         $(curl -s $URL/showtimes/$SHOWTIME_ID/seats | jq "[.seats[] | select(.id==$SEAT_ID) | .status] | {status: .[0]}")"
```

The report must contain: requests sent, successful holds, conflicts, oversell count, and proof that the seat is shown `HELD` exactly once.

### 10.2 Scenario B report (`docs/scenarioB.md`)

```bash
URL="${PUBLIC_URL:-http://localhost:3000}"
SHOWTIME_ID=1
SEAT_ID=51
HOLD_TTL=10      # seconds — short, per problem statement

# 1. hold
HOLD=$(curl -s -X POST "$URL/holds" -H "Content-Type: application/json" \
  -d "{\"showtime_id\":$SHOWTIME_ID,\"seat_id\":$SEAT_ID}")
echo "T=$(date +%s) hold: $HOLD"

# 2. wait past expiry
sleep $((HOLD_TTL + 2))

# 3. confirm seat is available again
curl -s "$URL/showtimes/$SHOWTIME_ID/seats" | jq ".seats[] | select(.id==$SEAT_ID) | .status"

# 4. hold from a different user
curl -s -X POST "$URL/holds" -H "Content-Type: application/json" \
  -d "{\"showtime_id\":$SHOWTIME_ID,\"seat_id\":$SEAT_ID,\"user_ref\":\"second_user\"}"
```

### 10.3 Scenario C report — bonus (`docs/scenarioC.md`)

Run k6 from the host (NOT the api container):

```js
// scripts/scenarioC.js
import http from 'k6/http';
import { check } from 'k6';
export const options = {
  stages: [
    { duration: '30s', target: 50 },
    { duration: '30s', target: 200 },
    { duration: '30s', target: 500 },
    { duration: '30s', target: 1000 },
    { duration: '30s', target: 2000 },
  ],
  thresholds: {
    'http_req_duration: p(95)': ['200ms'],
    http_req_failed: ['rate<0.01'],
  },
};
export default function () {
  const r = http.get(`${__ENV.URL}/showtimes/1/seats`);
  check(r, { '200': (r) => r.status === 200 });
}
```

The report must name: where p95 turns upward, where errors begin, the bottleneck (pool / DB / event loop / memory), and the fix.

### 10.4 README.md

Must contain:
- One-paragraph architecture summary
- Architecture diagram (the one from `ARCHITECTURE.md`)
- How to run locally from clone to `docker compose up`
- Deployed URL
- The **exact** request for holding a seat (judging hook #3)
- The **exact** request for fetching a seat map (judging hook #3)
- Acknowledgements (gateway image, libraries used)

### 10.5 DECISIONS.md

Three decisions, each with: options considered, what we chose, why, what we gave up. Drafts are in `ARCHITECTURE.md` §17.

### 10.6 Done-when checklist

- [x] `docs/scenarioA.md` shows 1 success / 99 conflicts / 0 oversell
- [x] `docs/scenarioB.md` shows the timeline and the second user's success
- [ ] `docs/scenarioC.md` (if attempted) names the bottleneck
- [x] `README.md` lists the two exact request shapes
- [x] `DECISIONS.md` documents the three decisions
- [x] `docker compose up` from a clean clone still works (judging hook #4)

---

## 11. Engineering Expectations Checklist (rulebook §8)

| Area | Where in this plan |
|---|---|
| Design (modular, no single-file monolith) | Phase 2 §4.3 module skeleton; Phase 4 module wiring |
| APIs (consistent, predictable) | Phase 4 §6.1 frontend routing; Phase 4 §6.2 backend routes |
| Reliability (input validation, error handling) | Phase 2 §4.3 (`shared/errors`); Phase 5 §7.1 (top-level try/catch + 2xx) |
| Configuration (env vars, `.env.example`) | Phase 1 §3.2 (env in compose); Phase 2 (`.env.example`) |
| Testing (unit over core logic) | Phase 3 §5.3 (concurrency test); Phase 5 §7.4 (webhook tests) |
| Containerization (Dockerfile per service + Compose) | Phase 1 §3.2; Phase 6 §8.1, §8.2 (multi-stage builds) |
| CI (builds + tests on push) | Phase 6 §8.3 |
| Deployment (Poridhi or AWS) | Phase 7 §9 |
| Documentation (README + API + setup) | Phase 8 §10.4 |
| Version control (frequent commits) | Throughout — commit at the end of every phase |

---

## 12. Daily Anchor Points (rulebook §5)

| Time | Anchor |
|---|---|
| 09:00 | Opening ceremony + problem reveal |
| 09:30 | Repo initialised; Phase 1 done (`docker compose up` works) |
| 10:30 | Phase 1 + Phase 2 done (schema migrated, gateway talking) |
| 12:30 | Phase 3 done (concurrency test green) |
| 14:30 | Phase 4 done (full flow works end-to-end) |
| 16:00 | Phase 5 done (webhook hardening) |
| 16:00 | Phase 6 done (containerisation + CI green) |
| 17:30 | Phase 7 done (deployed to AWS EC2) |
| 18:00 | Phase 8 done (reports + README + DECISIONS.md) |
| 18:30 | Code freeze |
| 18:30 – 19:45 | Presentation + defence |

---

## 13. What we always do (rules that apply to every phase)

1. **Always commit working state at the end of every phase.** Rulebook §6.2 — commit history is part of the score.
2. **Never push to `main` after 18:30.** Rulebook §6.2.
3. **Never commit secrets.** `.env` is ignored; `.env.example` is committed. Rulebook §6.2.
4. **Always return 2xx from `/webhooks/*`.** Gateway reference explicit; non-2xx triggers 8 retries.
5. **Always use the Compose service name in `callback_url`.** `http://api:3000/...`, never `http://localhost:3000/...`. Gateway reference explicit.
6. **Always read `HOLD_TTL_SECONDS` from env.** Judging hook #2.
7. **Always have a `/health` that works when the gateway is down.** Judging hook #1.
8. **Always know why every line of code is in the repo.** Rulebook §6.3.

---

## 14. Risk register (what can derail us)

| Risk | Mitigation |
|---|---|
| Image pull fails on event-day Wi-Fi | Pre-pull on day zero |
| `FOR UPDATE` test flaky in CI | Run against a real Postgres service container, keep CI count modest (20) |
| Gateway `/charge` 500 storm | Retry once with same `Idempotency-Key`, then surface PENDING |
| Webhook verification fails because of a global JSON middleware | `express.raw()` only on `/webhooks/*`; ESLint rule prevents global JSON on those routes |
| Hold expiry leaks seats | `hold_expires_at < now()` check in every read of `show_seats` |
| Frontend spins forever on OTP loss | Explicit "no code yet" state with Resend action |
| Temporary AWS EC2 account expires mid-event | 100% reproducible from clean clone; designated infra owner |
| Run out of time | Drop Scenario C first, then the OG explicitly mentioned "smaller system that never double-books beats a larger one with a race condition" |

---

## 15. One-line defence (carry this to every meeting)

> "When 100 people hold the same seat at the same time, the hold operation runs inside a Postgres transaction that locks that specific seat row; concurrent requests serialise on the row, so only one creates the hold. The webhook handler is made duplicate-safe by a `UNIQUE(event_id)` constraint on the `payment_events` table, so the gateway's documented 8% duplicate-callback rate is rejected at the database level, not in application code."

---

*This plan is the operational reference for the build day. Update it as we discover things — the architecture in `ARCHITECTURE.md` is the contract; this is the route.*
