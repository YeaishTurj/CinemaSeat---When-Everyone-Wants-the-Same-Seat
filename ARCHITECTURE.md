# CinemaSeat — System Architecture Document

**Event:** Zero to Production · Phase 2 · IEEECS CUET (8 Aug 2026)
**Stack:** Next.js 16 + React 19 (JS), Node.js + Express (JS), PostgreSQL (raw SQL via `pg`), Docker / Docker Compose, GitHub Actions, Poridhi-provided AWS EC2
**Build method:** AI-agent-implemented, human-understood and human-defended (rulebook §6.3 — every member must be able to explain the system regardless of who typed it)

---

## How to read this document

Every architectural choice below follows the same five-part shape, so a judge (or a teammate) can interrogate any decision in the same way:

| Part                   | Question it answers                                                             |
| ---------------------- | ------------------------------------------------------------------------------- |
| **Why this**           | What we picked and what we rejected                                             |
| **Benefit**            | What we gain concretely                                                         |
| **Problem it solves**  | Which scoring criterion or failure mode this neutralises                        |
| **When it can fail**   | The honest conditions under which this choice becomes the bottleneck or the bug |
| **Future if it fails** | The cheapest credible next step if/when that happens                            |

The closing **Failure Modes Summary** (§18) collapses all of the per-choice failure notes into one table for fast defence. The **Engineering Expectations Checklist** (§16) maps the rulebook §8 row-by-row to where in the codebase or this document each expectation is satisfied.

---

## 1. Executive Summary

CinemaSeat's entire engineering challenge reduces to one sentence: **when 100 people grab the same seat at the same millisecond, exactly one must win.** Everything else — movies, showtimes, seat maps, UI — is standard CRUD. The architecture is built backwards from that constraint, then from the three other guaranteed failure sources the gateway spec hands us:

- **Payments that don't respond synchronously** (gateway `/charge` returns 202 immediately; the real outcome arrives at our webhook 2–15 seconds later, or never).
- **Webhooks that arrive late, duplicated, or out of order** (8% duplicate rate; callback may beat the `/charge` response).
- **An OTP service that silently loses 10% of codes** (the literal failure Zayan hit in the problem statement).

**Design philosophy: fewer moving parts, each one defensible.** A modular monolith beats microservices here because the domain is small and the clock is 8 hours, not 8 weeks — and every service boundary you add is one more thing a judge can ask "why?" about.

---

## 2. How This Maps to the Scoring Rubric

| Criterion                    | Weight | What this architecture does about it                                                                                                                                 |
| ---------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| System Architecture & Design | 25     | Modular monolith with explicit module boundaries (§6), relational schema built around the concurrency problem (§7), data model + locking in one sentence (§8)        |
| Functionality & Completeness | 25     | Full flow: browse → seat map → hold → OTP → pay → confirm, with hold-expiry and duplicate-safe payment (§9), every gateway misbehaviour mapped to a mitigation (§10) |
| Code Quality & Testing       | 15     | Raw SQL on the critical path (no ORM magic to hide behaviour); tests cover required Scenarios A/B plus gateway failure paths (§15)                                   |
| Containerization & CI        | 15     | Single `docker compose up` from clean clone, GitHub Actions on push/PR (§11–§13)                                                                                     |
| Deployment                   | 10     | Poridhi-provided AWS EC2, SSH CD, and reproducibility from a clean clone (§14)                                                                                        |
| Documentation                | 5      | This document + `README.md` + `DECISIONS.md`                                                                                                                         |
| Presentation & Defence       | 5      | Every decision below has the five-part shape so any question maps to a known answer (§0, §16)                                                                        |

---

## 3. Technology Stack

### 3.1 Frontend — Next.js 16 + React 19, plain JavaScript

- **Why this:** You already know it; App Router gives file-based routing for the 5-screen flow (browse → seat-map → hold → pay → confirm) with zero extra setup. TS rejected — it adds a compile-error surface to debug live, on a stack you called "good enough" in JS, and isn't worth the risk in 8 hours.
- **Benefit:** One repo, one `npm run dev`, one container. No separate "frontend framework decision" to defend.
- **Problem it solves:** Milestone 2 — _"a minimal frontend showing browse, seat select, hold, pay, confirm is enough."_ Avoids over-engineering.
- **When it can fail:** If we later need SSR for SEO or shared layouts, App Router conventions become load-bearing and a contributor who doesn't know them slows down. If the judge asks "why not TS?", the answer must be in one sentence (we did, on time pressure).
- **Future if it fails:** Add a `tsconfig.json` and rename files to `.tsx` incrementally — Next.js supports mixed `.js`/`.tsx` for transition. Not worth doing during the hackathon.

### 3.2 Styling — Tailwind CSS

- **Why this:** Fast to write, no design system to build from scratch. The rulebook and problem statement both say UI polish earns zero extra marks.
- **Benefit:** A working, presentable UI in an hour instead of a day; no styling decisions to defend.
- **Problem it solves:** Functionality criterion — we need the screens to work end-to-end, not to win design awards.
- **When it can fail:** If a feature requires a non-trivial component (date picker, modal), Tailwind alone slows down vs. a UI library. Not a current concern.
- **Future if it fails:** Adopt a headless component library (`radix-ui`) for the 2–3 complex components only. Keep Tailwind for everything else.

### 3.3 Backend — Node.js + Express (JavaScript)

- **Why this:** You've shipped with it before; the middleware model makes raw-body capture for HMAC verification (§10.3) trivial, unlike some frameworks that pre-parse JSON. Fastify is faster but its plugin/schema model is something to learn under time pressure and buys nothing we need.
- **Benefit:** Battle-tested middleware (`express.raw()`, `express.json()`, error-handler chain) maps 1:1 onto the gateway's quirks.
- **Problem it solves:** Reliability criterion — we need predictable request parsing for webhook signature verification.
- **When it can fail:** Single-threaded event loop becomes the throughput ceiling under sustained CPU-bound work. Not a concern at our scale (seat-locking is dominated by DB roundtrips, not CPU).
- **Future if it fails:** Cluster-mode (`node --cluster`) or move to Fastify with the same handler signatures. Don't pre-optimise.

### 3.4 Database — PostgreSQL

- **Why this:** Only mainstream DB with row-level locking (`SELECT … FOR UPDATE`) mature and simple enough to explain in one sentence to a judge. MongoDB can do transactions but the domain (movies→showtimes→seats→bookings→payments) is inherently relational.
- **Benefit:** Correctness on the concurrency-critical path is one transaction; the schema reads naturally; `pg` is the only driver dependency we need.
- **Problem it solves:** Scenario A (100 concurrent holds on one seat) — without a database that serialises per-row, this problem is genuinely hard.
- **When it can fail:** Single PostgreSQL instance becomes the ceiling on write throughput for hot seats. If a single showtime sells out in 2 seconds with thousands of contenders, the row-lock queue lengthens and p95 latency climbs even though no one double-books.
- **Future if it fails:** Read replicas for catalog reads (movies / showtimes / seat maps); keep writes single-instance to preserve `FOR UPDATE` semantics. Shard seats by showtime if needed. PgBouncer for connection pooling. None of this is on the day-1 critical path.

### 3.5 DB access — `pg` (node-postgres), raw SQL, no ORM

- **Why this:** The one query that decides the Scenario A score (`FOR UPDATE`) must be visible and exact. An ORM is one more layer to explain "what it's actually doing under the hood" — and you said you're not ORM-fluent. Prisma/Drizzle are fine tools, but the rulebook §6.3 explicitly punishes code nobody on the team can explain.
- **Benefit:** Raw SQL is **more** defensible here, not less — every team member can read the critical query and know exactly what Postgres will do.
- **Problem it solves:** Code Quality criterion ("readable, organised code") and Presentation & Defence ("walk us through what happens on this request").
- **When it can fail:** More boilerplate on routine CRUD (movies/showtimes/seats) — every list endpoint becomes a hand-written `SELECT`.
- **Future if it fails:** Introduce Drizzle only for the read-heavy, non-critical tables (`movies`, `theatres`, `screens`, `showtimes`); keep raw SQL for `show_seats`, `bookings`, `payments`, `payment_events`. The boundary is "tables involved in correctness" vs. "tables that just display data".

### 3.6 Containers — Docker + Docker Compose

- **Why this:** Explicit requirement (rulebook §8, problem statement Milestone 2/3). One command must bring up frontend, api, postgres, and the provided gateway.
- **Benefit:** Identical environment for local development, CI, AWS EC2, and the judge's machine. Reproducible from a clean clone.
- **Problem it solves:** Engineering Expectations Checklist — _"a working Dockerfile per service and a root docker-compose.yml that brings the whole stack up in one command."_
- **When it can fail:** Image pulls on event-day venue Wi-Fi with 25 teams doing it simultaneously (gateway reference §"Run it"). Slow build times inside CI if layer caching is misconfigured.
- **Future if it fails:** Pre-pull the gateway image on day-zero; use multi-stage builds with layer caching; pin base images to specific versions to avoid surprise breakage.

### 3.7 CI — GitHub Actions

- **Why this:** Explicit requirement (CI on PR/push, CD on default-branch push only).
- **Benefit:** Free, integrated with the repo, change-aware workflows possible.
- **Problem it solves:** Containerization & CI criterion — _"a functioning CI pipeline that builds and tests on push."_
- **When it can fail:** Flaky concurrency tests in CI under resource constraints; long image-build times if caching isn't set up; secrets leaking into logs.
- **Future if it fails:** Keep the existing PostgreSQL service container, add Docker layer caching, pin actions by digest, and restrict secret access per environment.

### 3.8 Testing — Jest + Supertest

- **Why this:** Enough to write unit tests on the hold-locking function and integration tests on the webhook dedup path. Nothing more elaborate is needed.
- **Benefit:** Familiar API, fast enough for a tight feedback loop.
- **Problem it solves:** Code Quality & Testing criterion — _"unit tests for core logic, especially the concurrency and duplicate-callback paths."_
- **When it can fail:** Concurrency tests using timers/mocks can be flaky. A real Postgres in CI is required for honest concurrency tests; SQLite would lie.
- **Future if it fails:** Keep the existing real PostgreSQL CI service, tune the concurrency count only if runner variance appears, and add a separate k6 job for optional Scenario C (§15).

### 3.9 Deployment — AWS EC2 through the Poridhi lab

- **Why this:** The provided AWS account was available and earns the optional AWS credit while the application still fits safely on one Docker Compose host.
- **Benefit:** A public, judge-reachable deployment with the same images and topology used locally, plus automatic SSH deployment after green CI.
- **Problem it solves:** Deployment criterion (10 pts) and the AWS bonus without introducing ECS/RDS during the build window.
- **When it can fail:** The Poridhi lab and AWS account expire after 12 hours; the auto-assigned public IP can change after a stop/start; a single EC2 instance is not highly available.
- **Future if it fails:** Provision with Terraform, attach a stable address/domain and TLS, publish images to a registry, and move PostgreSQL to RDS before adding multiple application instances.

---

## 4. High-Level Architecture

```
                              INTERNET
                                 │
                     ┌───────────────────────┐
                     │   Next.js (React)      │  ← one page per step:
                     │   browse → seats →     │    browse, seatmap, hold,
                     │   hold → pay → confirm │    pay, confirm
                     └───────────┬────────────┘
                                 │ REST / JSON
                     ┌───────────▼────────────┐
                     │   Node.js + Express     │
                     │   Modular Monolith      │
                     │ ┌─────────────────────┐ │
                     │ │ catalog   (read)    │ │
                     │ │ seats     (critical)│ │
                     │ │ bookings  (lifecycle)│ │
                     │ │ payments  (webhooks)│ │
                     │ │ otp       (wrapper) │ │
                     │ │ health    (isolated)│ │
                     │ └─────────────────────┘ │
                     └──────┬──────────┬───────┘
                             │          │
                  ┌──────────▼──┐  ┌────▼─────────────┐
                  │ PostgreSQL  │  │ CinemaSeat Gateway │
                  │ source of   │  │ (provided image,  │
                  │ truth       │  │  never mocked)    │
                  └─────────────┘  └───────────────────┘
```

All four containers (frontend, api, postgres, gateway) run under one `docker-compose.yml`. PostgreSQL is the single source of truth for both seat state and payment state — no Redis, no message queue, no service mesh. The seat-locking and webhook-handling responsibilities live in the same Node process so the boundary a judge can question is the module folder, not a network call.

---

## 5. The One-Line Defence

> "When 100 people hold the same seat at the same time, the hold operation runs inside a Postgres transaction that locks that specific seat row; concurrent requests serialise on the row, so only one creates the hold. The webhook handler is made duplicate-safe by a `UNIQUE(event_id)` constraint on the `payment_events` table, so the gateway's documented 8% duplicate-callback rate is rejected at the database level, not in application code."

If a judge interrupts with any question, this is the sentence every other answer should be defending.

---

## 6. Module Boundaries (inside the monolith)

```
api/
├── src/
│   ├── modules/
│   │   ├── catalog/      movies, theatres, showtimes (read-heavy, simple CRUD)
│   │   ├── seats/        seat map, hold create/release — THE critical module
│   │   ├── bookings/     booking lifecycle, ties hold → payment → confirmation
│   │   ├── payments/     /charge calls, webhook handler, idempotency
│   │   ├── otp/          /otp/send, /otp/verify wrapper
│   │   └── health/       fast liveness check, independent of gateway
│   ├── shared/
│   │   ├── db/           pg pool, transaction helper
│   │   ├── errors/       consistent error shape across modules
│   │   └── logger/       structured logs with request id
│   ├── app.js
│   └── server.js
├── tests/
└── Dockerfile
```

### Why one module per business concept, not one file

- **Why this:** Satisfies rulebook §8 — _"no single-file monolith"_ — while staying a single deployable unit.
- **Benefit:** Boundary clarity without network calls between modules; the boundary a judge can question is a folder, not a service.
- **Problem it solves:** System Architecture criterion — _"sensible service and module boundaries, clean API design."_
- **When it can fail:** If a module grows past ~500 LOC and the imports across modules turn into a tangle, the monolith stops being "modular" and starts being a big ball of mud.
- **Future if it fails:** Enforce module boundaries with an ESLint `no-restricted-imports` rule (each module may only import from `shared/`). If that still isn't enough, split the seats module into its own service — but only after the monolith is provably the bottleneck.

### What microservices would cost

- Service registry or shared network, inter-service auth, distributed transactions across the seats/payments boundary (the hardest part of this problem), 3× the Docker/CI surface — all to buy scalability the traffic profile of a single showtime rush doesn't need yet.
- This is the answer to a judge's "why didn't you split services?" question.

---

## 7. Data Model

```sql
movies        (id, title, poster_url, duration_min, ...)
theatres      (id, name, location)
screens       (id, theatre_id, name)
showtimes     (id, movie_id, screen_id, starts_at, base_price)
seats         (id, screen_id, row_label, seat_number)

show_seats    (id, showtime_id, seat_id, status, hold_id, hold_expires_at, booking_id)
              status ∈ { AVAILABLE, HELD, BOOKED }
              INDEX (showtime_id, status)
              INDEX (hold_expires_at) WHERE status = 'HELD'

bookings      (id, showtime_id, user_ref, status, total_amount, created_at)
              status ∈ { PENDING, CONFIRMED, CANCELLED, EXPIRED }

payments      (id, booking_id, gateway_payment_id, idempotency_key, status, amount)
              status ∈ { PENDING, SUCCEEDED, FAILED, REFUNDED }
              UNIQUE (booking_id)                 -- one payment row per booking

payment_events (event_id PK, payment_id, status, received_at, processed_at)
              -- event_id is the gateway's dedup key; UNIQUE PK does the work

otp_sessions  (ref, phone, status, attempts, created_at)
```

- **Why this:** `show_seats` is the row that gets fought over, so it's the row that gets locked — one table, one status column, one lock target. `payment_events` exists purely so a `UNIQUE(event_id)` constraint can reject duplicate webhook processing at the database level, not in application logic — belt and suspenders.
- **Benefit:** Every correctness invariant is enforced by a constraint, not by hopeful code.
- **Problem it solves:** Concurrency (Scenario A), duplicate webhooks (rulebook explicit requirement), and the "callback before /charge returns" race (§10).
- **When it can fail:** Indexes missing on `show_seats(showtime_id, status)` will make the seat-map read slow under load. Missing `UNIQUE(booking_id)` on `payments` would let a buggy retry double-charge. Both are caught in code review but not in production until they bite.
- **Future if it fails:** Add a `CHECK` constraint that `hold_expires_at` is always in the future for `status = 'HELD'` (defence in depth). Partition `payment_events` by month if it grows large. Add a partial index on `show_seats(showtime_id) WHERE status = 'AVAILABLE'` if hot shows have very few free seats.

---

## 8. Core Flow 1 — Seat Hold (the concurrency-critical path)

### The problem

Scenario A — 100 concurrent `POST /holds` for one seat, exactly one must win, zero oversell. Then the seat map must show the seat held once, not twice.

### The mechanism — `SELECT … FOR UPDATE`

```sql
BEGIN;
SELECT status, hold_expires_at
FROM show_seats
WHERE showtime_id = $1 AND seat_id = $2
FOR UPDATE;                            -- locks this row only; other seats unaffected

-- application logic inside the transaction:
--   BOOKED                      → ROLLBACK, return 409
--   HELD and not expired        → ROLLBACK, return 409
--   AVAILABLE or HELD-expired   → proceed

UPDATE show_seats
SET status = 'HELD',
    hold_id = $3,
    hold_expires_at = now() + ($HOLD_TTL_SECONDS * interval '1 second')
WHERE showtime_id = $1 AND seat_id = $2;

COMMIT;
```

- **Why this:** `FOR UPDATE` makes Postgres serialise any concurrent transaction touching that exact row. The 99 losing requests simply wait, then see the new status and get cleanly rejected. No application-level locking, no Redis lock, no distributed consensus needed.
- **Benefit:** One sentence answers the judges' most likely question ("how do you guarantee no double-booking?") — see §5.
- **Problem it solves:** Scenario A — 100 concurrent holds on one seat, exactly one wins, zero oversell. The seat-map read confirms "held once, not twice".
- **When it can fail:**
  - **Connection pool exhaustion** under very high concurrency — if 100+ simultaneous holds hit the pool limit, requests queue at the pool, not at the row, and latency spikes even though correctness holds.
  - **Long-held locks from a slow client** — if a transaction holding the row stalls (slow query elsewhere in the same transaction), every other request for that seat blocks until it resolves or times out.
  - **Single-instance bottleneck** — correctness lives in one Postgres instance, so that instance becomes the ceiling on throughput for hot seats.
- **Future if it fails:**
  - Tune `pool.max` and add a statement timeout so a stuck transaction fails fast instead of blocking the queue.
  - Keep the locked transaction as short as physically possible — lock, check, write, commit. Nothing else inside it.
  - If this needed to scale past one Postgres instance, the honest next step is sharding showtimes across read replicas with a single writer per showtime, not a lock-free approach. Scenario C (§15) exists precisely so we can name this bottleneck instead of hiding it.

---

## 9. Core Flow 2 — Booking → Payment → Confirmation

### 9.1 The synchronous parts

```
POST /bookings                  → create booking (status=PENDING), reserve seats by hold_id
POST /bookings/:id/otp/send     → call gateway /otp/send, return 202
POST /bookings/:id/otp/verify   → call gateway /otp/verify (sync, handles 400/429)
POST /bookings/:id/pay          → see §9.2
POST /webhooks/payment          → see §9.3
POST /webhooks/otp              → optional: surface code to user via polling/SSE
GET  /bookings/:id              → returns current state (PENDING / CONFIRMED / FAILED / EXPIRED)
```

### 9.2 `/pay` is async by design

```
POST /bookings/:id/pay
   │
   ├─ create payment row (status=PENDING) keyed on booking_id
   ├─ call gateway POST /charge with Idempotency-Key = booking_id
   │     (this call may 202 immediately or occasionally 500 — retry once, then surface PENDING)
   └─ return 202 to frontend immediately — DO NOT wait for callback

... later, out of band ...

POST /webhooks/payment   (gateway → us)
   │
   ├─ verify HMAC over raw body (see §10.3)
   ├─ INSERT payment_events (event_id, ...) — UNIQUE PK rejects duplicates at the DB level
   │     if duplicate → return 200 immediately, do nothing else
   ├─ if new: update payment.status; if SUCCEEDED → mark booking CONFIRMED, seat BOOKED
   └─ always return 2xx, even on duplicates — non-2xx triggers up to 8 retries
```

- **Why this:** The `/charge` handler cannot wait for the gateway (problem statement explicit). Returning 202 immediately, then completing the work in the webhook handler, is the only honest shape.
- **Benefit:** Two independent idempotency layers for two independent failure sources — `Idempotency-Key` protects against double-charging on our own retries; `event_id` UNIQUE protects against the gateway's 8% duplicate-callback rate.
- **Problem it solves:** Functionality criterion — full flow works end-to-end even when the gateway misbehaves.
- **When it can fail:**
  - **Callback never arrives** (network partition, gateway outage) — the booking sits `PENDING` forever unless something reconciles it.
  - **The "race" case** — callback arrives before `/charge`'s own response finishes writing `gateway_payment_id`. Handled by keying the payment row on `booking_id` _before_ calling the gateway, so the webhook always has something to match against.
- **Future if it fails:**
  - Periodic reconciliation job that polls `GET /debug/payments/:id` (or a real gateway's status endpoint) for any payment still `PENDING` past a threshold.
  - Surface a manual "check payment status" button in the UI as a stopgap for the demo.

### 9.3 OTP flow

Same async shape as payment: `POST /otp/send` returns immediately, the code (or nothing — 10% of the time) arrives at `/webhooks/otp` later. `POST /otp/verify` is synchronous against the gateway and handles the 400/429 cases directly.

- **Why this:** Mirrors the payment flow so the team only learns one async pattern.
- **Benefit:** Frontend can poll `GET /bookings/:id` and react to OTP state without coupling to gateway internals.
- **Problem it solves:** Functionality criterion + the literal Zayan story from the problem statement.
- **When it can fail:** OTP silently lost (documented 10%) — user is stuck with no code and no error message.
- **Future if it fails:** Visible "Resend OTP" action with a cooldown, and a UI state that explicitly says "no code yet" rather than a silent spinner. This is literally the failure Zayan hit, so handling it visibly is a functionality point, not just polish.

### 9.4 Hold expiry

Two acceptable mechanisms — pick one and be ready to defend it:

| Mechanism                                         | How                                                                                                                             | Pros                                                                              | Cons                                                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Lazy expiry (recommended for the time budget)** | Every read of `show_seats` treats `HELD` rows with `hold_expires_at < now()` as effectively `AVAILABLE`. No background process. | Correctness doesn't depend on a background job being alive. Can't silently break. | Seat map may briefly show a stale `HELD` seat if read query doesn't apply the same check. |
| **Active sweep**                                  | `setInterval` job flips expired holds back to `AVAILABLE`.                                                                      | Cleaner audit trail.                                                              | One more moving part; can silently break if the sweeper crashes.                          |

- **Why this (lazy):** If the sweep job crashes, a sweeper-based design silently breaks; lazy expiry can't silently break because the check happens exactly where it matters, inside the locked transaction in §8.
- **Benefit:** Less code, fewer failure modes.
- **Problem it solves:** Scenario B — abandoned hold returns to `AVAILABLE` and becomes bookable by a different user.
- **When it can fail:** Seat-map read endpoint doesn't apply the same expiry check as the hold-write path → users see stale "unavailable" seats.
- **Future if it fails:** Apply the same `hold_expires_at < now()` check in the seat-map read query, not just the hold-write path, so the UI reflects reality without needing the active sweep. (Or flip to active sweep once traffic is high enough that a background job is justified.)

---

## 10. Reliability: Gateway Misbehaviour × Mitigation

The gateway reference documents five specific failure rates. Each one has a known location in the architecture and a known handler.

| Documented misbehaviour                        | Rate                 | Where it lands      | Mitigation in this design                                                                                                                                                            |
| ---------------------------------------------- | -------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Callback delayed 2–15 s                        | always               | `/webhooks/payment` | `/pay` returns 202 immediately; frontend polls `GET /bookings/:id` until status changes                                                                                              |
| Payment fails (`FAILED`)                       | 10%                  | `/webhooks/payment` | On FAILED: payment row → `FAILED`, booking → `CANCELLED`, hold released, seat → `AVAILABLE` (lazy-expiry logic handles it)                                                           |
| Same callback delivered twice, same `event_id` | 8%                   | `/webhooks/payment` | `UNIQUE(event_id)` PK on `payment_events` — second insert fails, handler returns 200, no double-confirm, no double-count                                                             |
| `/charge` returns 500 or times out             | 2%                   | `/pay`              | Retry the `/charge` call once with the same `Idempotency-Key`; if still failing, surface PENDING to the frontend (don't pretend it failed)                                           |
| OTP never delivered                            | 10%                  | `/webhooks/otp`     | UI shows explicit "no code yet" state with a Resend action after cooldown; this is the literal Zayan failure mode                                                                    |
| Callback arrives before `/charge` responds     | force-header only    | `/webhooks/payment` | Payment row is keyed on `booking_id` _before_ calling `/charge`, so the webhook always has something to match against even if the gateway_payment_id isn't written yet               |
| Retries on non-2xx webhook response            | up to 8× exponential | `/webhooks/payment` | Always return 2xx from the webhook handler — even on duplicates, even on internal errors after we've logged them. A non-2xx tells the gateway we failed and triggers the retry storm |

### 10.1 Always return 2xx from webhooks

- **Why this:** A non-2xx tells the gateway the delivery failed, and it will retry up to 8 times with exponential backoff.
- **Benefit:** Once-and-done semantics; we never play retry-tag with a service we don't control.
- **Problem it solves:** The duplicate-callback requirement (problem statement explicit).
- **When it can fail:** If the handler `throw`s after we've validated the signature, an unhandled exception might bubble up to a 500. Wrap the body in a top-level try/catch and log+ignore inside.
- **Future if it fails:** Move to a queue (SQS / RabbitMQ) where the webhook ack is decoupled from the actual processing — but only if the request volume justifies it.

### 10.2 Fault isolation — gateway down

- **Why this:** Bonus marks per the problem statement — _"with the gateway container stopped completely, browsing, seat maps and holds still work, /health stays green, nothing returns 500."_
- **Benefit:** The architecture already does this _if_ nothing in the catalog/seats read path calls the gateway — it doesn't, by design. The one thing to verify explicitly: a failed `/charge` call (gateway down) leaves the payment `PENDING` and returns a clean error, not an unhandled exception that takes the whole request handler down.
- **Problem it solves:** Bonus marks criterion; also matches the user's "show never freezes" expectation from Zayan's story.
- **When it can fail:** If any handler synchronously awaits `/charge` and the request hangs longer than the client timeout, the UI freezes (literally what happened to Zayan).
- **Future if it fails:** Add a circuit breaker around the gateway client; once tripped, fail-fast for N seconds rather than letting requests pile up.

### 10.3 HMAC verification (bonus marks)

- **Why this:** _"Anyone on the internet can POST to your webhook path"_ (gateway reference). Verifying the HMAC is the only honest answer to "is this callback actually from the gateway?"
- **Benefit:** Defence against spoofed webhooks; required for bonus security marks.
- **Problem it solves:** Security basics criterion (bonus list).
- **Implementation note (this is the one bug everybody makes):** compute the HMAC over the **raw** request body, before Express's JSON parser touches it. Reserialising JSON changes byte order and silently breaks the signature. This means the webhook route needs `express.raw()` specifically, not the app-wide `express.json()`.

  ```js
  const expected = crypto
    .createHmac("sha256", process.env.GATEWAY_SECRET)
    .update(req.body) // Buffer, NOT req.body parsed
    .digest("hex");
  if (req.get("X-Signature") !== expected) return res.sendStatus(401);
  ```

- **When it can fail:** A future contributor adds a global JSON middleware "for convenience" and the signature stops matching. Mitigation: keep `express.raw({type: 'application/json'})` only on `/webhooks/*` routes.
- **Future if it fails:** Rotate the secret via env var without restart (live config); add a request-id header from the gateway's `X-Gateway-Event` for traceability.

---

## 11. API Contract (minimum viable surface)

```
GET  /health                          — fast, never touches the gateway; <1s, gateway-independent
GET  /movies
GET  /showtimes/:id/seats             — the exact seat-map request (README must document this)
POST /holds                           — the exact hold request (README must document this)
POST /bookings/:id/otp/send
POST /bookings/:id/otp/verify
POST /bookings/:id/pay                — returns 202 immediately
POST /webhooks/payment                — HMAC-verified, raw body, always 2xx
POST /webhooks/otp                    — optional, for OTP code delivery
GET  /bookings/:id                    — poll for current state
```

Endpoint names are ours to choose per the rulebook — this is a minimum, not a spec.

- **Why this:** Smallest surface that proves the concurrency, payment, OTP, and hold-expiry flows work end-to-end.
- **Benefit:** Less to defend, less to test, less to break.
- **Problem it solves:** Functionality & Code Quality criteria — depth over breadth.
- **When it can fail:** If the frontend needs more (e.g., seat reservation hold-by-seat-list, not hold-by-one-seat), we extend.
- **Future if it fails:** Add `/holds/bulk` (one transaction, multiple seats), `/bookings?user=`, `/admin/*` only after the core path is stable and tested.

---

## 12. Containerization

```yaml
services:
  frontend:
    build: ./frontend
    depends_on:
      api: { condition: service_healthy }

  api:
    build: ./api
    depends_on:
      postgres: { condition: service_healthy }
      gateway: { condition: service_healthy }
    environment:
      - HOLD_TTL_SECONDS=${HOLD_TTL_SECONDS:-300}
      - DATABASE_URL=${DATABASE_URL:-postgres://postgres:postgres@postgres:5432/cinemaseat}
      - GATEWAY_URL=${GATEWAY_URL:-http://gateway:9000}
      - GATEWAY_SECRET=${GATEWAY_SECRET:-z2p-2026-secret}

  postgres:
    image: postgres:16
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      retries: 10

  gateway:
    image: asifmahmoud414/mock-gateway:latest
    ports: ["9000:9000"]
    healthcheck:
      test: ["CMD", "wget", "-q", "-O", "-", "http://127.0.0.1:9000/health"]
      interval: 5s
      retries: 10
```

### 12.1 The one bug everybody makes

The api's `callback_url` sent to the gateway **must** be `http://api:3000/webhooks/payment` (the Compose service name), **never** `http://localhost:3000/webhooks/payment`. `localhost` inside the gateway container refers to the gateway itself. The gateway reference calls this out explicitly.

### 12.2 `HOLD_TTL_SECONDS` from env, not hardcoded

Judges will override this to a small value (e.g., 10) to watch a hold expire in under a minute — hardcoding it fails the judging hook outright. Read it in the hold-creation handler:

```js
const ttl = parseInt(process.env.HOLD_TTL_SECONDS || "300", 10);
```

- **Why this:** Single-command clean-clone reproducibility (rulebook §8 judging hook).
- **Benefit:** Judge sees the system working with their override, not ours.
- **Problem it solves:** Judging hook #2 — _"HOLD_TTL_SECONDS is read from the environment, not hardcoded."_
- **When it can fail:** If a hot-reload picks up a malformed value, the handler crashes; guard with `Number.isFinite()` and a sane default.
- **Future if it fails:** Per-showtime TTLs (premiere shows get longer holds than matinees).

### 12.3 `.env.example` committed

- **Why this:** Rulebook §8 — _"all environment-specific values and secrets in environment variables, with an .env.example committed."_
- **Benefit:** Compose has safe mock-service defaults, so a clean clone starts directly; `.env.example` documents every supported override without containing production credentials.
- **Problem it solves:** Documentation criterion; also prevents the "works on my machine" failure mode.
- **When it can fail:** A contributor commits a real `.env` by accident (GitHub secret-scanning blocks it, but only if it's a recognised pattern).
- **Future if it fails:** Add `.env` to `.gitignore` (it is), and add a CI check that the diff doesn't introduce new env keys not in `.env.example`.

### 12.4 Production image design and measured size

- Both application Dockerfiles are multi-stage and install from committed lockfiles with `npm ci`.
- Runtime containers execute as the unprivileged `node` user.
- The API runtime copies only production dependencies and `src/`.
- Next.js uses `output: "standalone"`; the frontend runtime copies only the standalone server and static assets.
- Compose health checks gate frontend startup on API readiness.
- Measured on 8 August 2026: API **49.9 MB**, frontend **63.8 MB**, both comfortably below the Phase 6 limits of 250 MB and 400 MB.

---

## 13. CI/CD

```
Pull request / push
   → install deps
   → lint
   → unit + integration tests (Jest/Supertest) — concurrency test against real Postgres
   → docker build (frontend, api)
successful CI from a main-branch push only
   → deploy workflow → AWS EC2 over SSH → post-deploy API health check
```

The repository workflow supplies the required CI status checks; the active GitHub ruleset blocks merging when either job fails. CD is gated through `workflow_run`, so it cannot run until push-triggered CI on `main` succeeds.

- **Why this:** Explicit rulebook requirement (CI on PR/push, CD on default-branch push only).
- **Benefit:** Every push is a candidate for production, every PR must be green.
- **Problem it solves:** Containerization & CI criterion (15 pts).
- **When it can fail:** Flaky concurrency tests in CI (the same `FOR UPDATE` test that's deterministic locally can behave differently under CI's resource constraints).
- **Future if it fails:** Keep the existing real PostgreSQL service and 100-request collision test, then isolate runner variance with timing diagnostics or a dedicated test database rather than weakening the invariant.

---

## 14. Deployment

- **Implemented path:** Ubuntu 24.04 on a Poridhi-provided AWS EC2 instance.
  Docker Compose runs frontend, API, PostgreSQL, and the required gateway on
  the same host; ports 3000 and 3001 expose the demo and health endpoint.
- **Delivery:** A successful push-triggered CI run on protected `main` starts
  the SSH workflow. It fast-forwards `~/cinemaseat`, rebuilds Compose, and
  executes an in-container API health check.

- **Why this:** It is the smallest AWS topology that can be completed and defended in the event window.
- **Benefit:** The deployment uses exactly the same committed artifacts as local and CI environments and can be recreated from a clean clone.
- **Problem it solves:** Deployment criterion (10 pts) plus the AWS bonus.
- **When it can fail:** It is a disposable 12-hour account, has a changing public IP after stop/start, and has no rolling deployment or redundant node.
- **Future if it fails:** Add infrastructure as code, registry-backed immutable images, HTTPS/domain routing, RDS, and at least two application instances behind an ALB.

---

## 15. Testing Strategy

| Test                                                                                            | Maps to                                          | What it proves                                                                                                                       |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Unit: seat-lock function under simulated concurrent calls                                       | Scenario A (preliminary)                         | Exactly one hold succeeds, rest cleanly rejected                                                                                     |
| Integration: fire **100** concurrent `POST /holds` at one seat                                  | Scenario A (the real report)                     | Oversell count = 0, seat map shows held once                                                                                         |
| Integration: duplicate webhook (same `event_id` twice)                                          | Problem-statement duplicate-callback requirement | Second delivery is a no-op, booking not double-confirmed                                                                             |
| Integration: hold created with short `HOLD_TTL_SECONDS`, wait, then re-hold as a different user | Scenario B                                       | Seat returns to available and is bookable by a different "user"                                                                      |
| Integration: gateway-down (stop the container)                                                  | Bonus — fault isolation                          | `/health` green, `/movies`, `/showtimes/:id/seats`, `/holds` all succeed; `/pay` returns clean error, no 500                         |
| Load test: ramp virtual users on `/showtimes/:id/seats` and `/holds`                            | Scenario C (bonus)                               | Identify p95 inflection point and bottleneck (pool, DB contention, event loop, memory) — **the explanation is what earns the marks** |

Depth over count, per the rulebook §8 checklist — these seven earn more than twenty trivial CRUD tests.

### Scenario C — what earns the marks

The number alone is not the point; the explanation is. The test report must name:

- where p95 latency turns upward
- where errors begin
- the bottleneck — connection pool exhaustion, DB row contention, blocked event loop, or memory
- what the fix would be if given another hour

Run the load generator **off** the application host (laptop against deployed URL, or host against local containers) — k6 competing for the same 2 vCPUs as your app measures your load tool fighting your service, not your service's actual ceiling.

---

## 16. Engineering Expectations Checklist (rulebook §8)

The rulebook gives us a checklist that maps directly to scoring rows. Here is how each item is satisfied.

| Area                 | Expectation                                                         | Where it's satisfied                                                                                        |
| -------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Design**           | Modular, well-organised, no single-file monolith                    | §6 — six explicit modules under `api/src/modules/`                                                          |
| **APIs**             | Consistent, predictable endpoints with sensible status codes        | §11 — minimum viable surface; errors use `{ok:false, code, message}`                                        |
| **Reliability**      | Input validation on every entry point; errors handled and logged    | Route-level validation, `shared/errors` middleware, structured request logs                                |
| **Configuration**    | All env-specific values in env vars, `.env.example` committed       | §12.3; `process.env.*` everywhere with defaults; `.env.example` lists every key                             |
| **Testing**          | Unit tests over core logic; depth over count                        | §15 — seven tests, all on critical paths                                                                    |
| **Containerization** | Dockerfile per service; root `docker-compose.yml` brings stack up   | §12 — `frontend/Dockerfile`, `api/Dockerfile`, root `docker-compose.yml`                                    |
| **CI**               | GitHub Actions builds image and runs tests on every push            | §13                                                                                                         |
| **Deployment**       | App deployed and reachable at a public URL                          | §14 — Poridhi-provided AWS EC2                                                                              |
| **Documentation**    | README with architecture, setup, deployment, API                    | This file + `README.md` + `DECISIONS.md`                                                                    |
| **Version control**  | Frequent, meaningful commits; branches/PRs as workflow calls for it | Repo policy — commit early and often (rulebook §6.2 explicitly)                                             |

---

## 17. Three Decisions Worth Defending (`DECISIONS.md` preview)

These are the three arguments a judge is most likely to interrupt with. Each is fully defended in the corresponding section above; the summary is here for `DECISIONS.md`.

### 17.1 PostgreSQL row locking vs. Redis distributed lock

- **Chosen:** Postgres `SELECT … FOR UPDATE` (§8).
- **Rejected:** Redis `SETNX` with TTL.
- **Why:** Keeps seat state and lock state in the same system — no cross-system consistency gap (what if Redis dies but Postgres commits? what if Postgres commits and the Redis lock hasn't expired?). One transaction, one source of truth.
- **What we gave up:** Postgres becomes the throughput ceiling for hot seats. Acceptable per the rulebook (Milestone 1 explicitly permits monolith trade-offs) and observable via Scenario C.

### 17.2 Modular monolith vs. microservices

- **Chosen:** Modular monolith, six folders under `modules/` (§6).
- **Rejected:** Splitting seats / payments / catalog into separate services.
- **Why:** Domain is small, clock is 8 hours. A service boundary at the seats/payments interface would force us to solve distributed transactions on the hardest problem in the spec.
- **What we gave up:** Independent scaling of, say, catalog reads from seat writes. Not needed at this traffic profile.

### 17.3 Idempotent callback handling vs. retry-driven processing

- **Chosen:** Verify raw-body HMAC, persist `event_id` as a primary key, process in one transaction, and acknowledge accepted duplicates.
- **Rejected:** In-memory deduplication or returning non-2xx for every internal processing failure.
- **Why:** The gateway deliberately duplicates and races callbacks; database arbitration works across workers and avoids an eight-attempt retry storm.
- **What we gave up:** An accepted event that fails internally is logged but not redelivered. A production successor needs a durable inbox and reconciliation worker.

---

## 18. Failure Modes Summary (for fast defence)

| Area         | Failure mode                                      | Present mitigation                                                                               | Future if given more time                                                |
| ------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Seat locking | Pool exhaustion under extreme burst               | Pool capped at 30; lock transaction contains only check/update                                   | Add statement timeout and PgBouncer                                      |
| Seat locking | Long-held transaction blocks the row queue        | Keep the `FOR UPDATE` block minimal                                                              | Add lock/statement timeouts and contention metrics                       |
| Seat locking | Single Postgres instance ceiling                  | N/A — matches current traffic profile                                                            | Read replicas for catalog reads; keep writes single-instance             |
| Payment      | Callback never arrives                            | None yet — booking stuck PENDING                                                                 | Reconciliation polling job against gateway debug/status endpoint         |
| Payment      | Gateway down entirely                             | Payment remains `PENDING`; health, catalog, maps, and holds stay available                       | Circuit breaker + queued retry once gateway health recovers              |
| Payment      | Callback arrives before `/charge` returns         | Payment row keyed on `booking_id` before gateway call                                            | Idempotency layer upgrades to a saga pattern if cross-service            |
| Webhook      | Non-2xx response triggers 8× exponential retries  | Accepted duplicates/errors return 200; invalid signatures return 401                             | Move to a durable inbox with decoupled ack                               |
| Webhook      | HMAC verification breaks (raw body re-serialised) | Webhook routers mount before `express.json()` and use `express.raw()`; integration test covers it | Live secret rotation                                                     |
| OTP          | Silently lost (10% documented)                    | Visible resend action and explicit no-delivery state; demo helper uses gateway debug API         | Cooldown, rate limiting, and a real SMS delivery channel                 |
| Hold expiry  | Seat-map read doesn't reflect expiry              | Seat-map query normalizes expired holds; next contender atomically reclaims the row               | Active sweep job with audit log if traffic justifies it                  |
| Container    | Image pulls fail on event-day Wi-Fi               | Pre-pull on day-zero                                                                             | Pin image digests, not tags                                              |
| CI           | Flaky concurrency test under CI resource limits   | Real PostgreSQL service and the same 100-request invariant used manually                         | Add diagnostics; do not hide failures with retries                       |
| Deployment   | Temporary AWS lab account expires mid-event       | Reproducible clean-clone deployment and one designated infrastructure owner                      | Terraform plus a persistent account/domain                               |

---

## 19. Build-Day Timeline (suggested)

The rulebook §5 explicitly warns: _"the most common way teams lose points here is spending nine hours on features and one hour on Docker, CI and deployment."_ Reverse that instinct.

| Time  | Target state                                                                                                             |
| ----- | ------------------------------------------------------------------------------------------------------------------------ |
| 09:30 | Repo initialised, `docker-compose up` brings up a placeholder stack (postgres + a "hello" api), `.env.example` committed |
| 10:30 | This architecture reviewed; module folders scaffolded; data model migrated                                               |
| 12:30 | `POST /holds` with `FOR UPDATE` working against a real Postgres in Docker; unit + concurrency test passing               |
| 14:30 | Full flow working: browse → seat map → hold → OTP → pay (mock webhook) → confirm                                         |
| 16:00 | Containerised stack runs end-to-end via `docker compose up`; gateway integrated with HMAC + dedup                        |
| 17:30 | Deployed to AWS EC2, reachable at a public URL                                                                           |
| 18:00 | Scenario A and Scenario B reports ready; README + DECISIONS.md finalised                                                 |
| 18:30 | Code freeze                                                                                                              |

---

_This document is the design reference for implementation. Whether written by hand or by an AI agent, every module and query above should be something any team member can walk a judge through line by line._
