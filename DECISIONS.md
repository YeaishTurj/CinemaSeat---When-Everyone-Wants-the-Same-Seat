# CinemaSeat — Engineering Decisions

These are the three decisions that most shaped CinemaSeat. Each records the
alternatives considered, the chosen approach, why it fits this system, and the
cost we knowingly accepted.

## 1. PostgreSQL row locks, not Redis locks or optimistic retries

### Options considered

1. **PostgreSQL `SELECT ... FOR UPDATE`** on the one `show_seats` row.
2. **Optimistic concurrency**, using a version or conditional update and asking
   losers to retry.
3. **Redis distributed locks**, with seat state still persisted in PostgreSQL.

### Choice

PostgreSQL is the single authority for seat ownership. `POST /holds` opens a
transaction, locks `(showtime_id, seat_id)`, checks `AVAILABLE` versus an
unexpired `HELD`/`BOOKED` state, and performs the transition before commit.

### Why

- Seat state already lives in PostgreSQL, so the lock and state change share
  one atomic transaction.
- Waiting contenders observe the winner's committed state and receive a clean
  `409`, which directly matches Scenario A.
- The correctness argument is short: one row, one lock owner, one transition.
- There is no second lock system whose lease, clock, or network partition must
  agree with the database.

### What we gave up

- A premiere seat becomes a serialization point; throughput for that exact
  seat is intentionally one transition at a time.
- Long transactions would create a queue, so the critical transaction must
  contain only the lock, state check, and update—never gateway calls.
- Redis could reduce some database contention at much larger scale, and an
  atomic conditional `UPDATE` could use fewer round trips, but both make the
  ownership and retry story harder to explain and test in this build window.

### Evidence

The 100-request collision test records exactly one `201`, ninety-nine `409`
responses, and zero oversells in [`docs/scenarioA.md`](./docs/scenarioA.md).

## 2. Modular monolith, not premature microservices

### Options considered

1. One Express deployment with explicit catalog, seats, bookings, OTP,
   payments, health, and shared-infrastructure modules.
2. Separate catalog, booking, seat-lock, and payment services.
3. A single unstructured application file for maximum initial speed.

### Choice

We built a modular monolith: one API process, separated routers and business
modules, one PostgreSQL database, plus independently deployed frontend and the
required external gateway container.

### Why

- The hardest invariant crosses seats, bookings, and payments. Keeping it in
  one database avoids distributed transactions and eventual-consistency gaps.
- Module boundaries still keep HTTP, concurrency logic, gateway adaptation,
  persistence, errors, and logging separate and testable.
- One API image and one database are easier to reproduce, deploy, observe, and
  defend during an eight-hour event.
- The gateway is already a real failure boundary, so the design demonstrates
  asynchronous integration without inventing internal network hops.

### What we gave up

- Modules cannot be scaled or deployed independently.
- A CPU or memory failure in the API can affect every internal module, although
  gateway failure is isolated because health/catalog/holds do not call it.
- If catalog reads and premiere writes need very different scaling later, the
  catalog boundary would be the easiest first extraction. We would split only
  after measurements show the monolith—not the database hot row—is the limit.

## 3. Acknowledge signed callbacks and make processing idempotent

### Options considered

1. Process callbacks transactionally, store `event_id`, and return `200` for
   accepted duplicates or internal processing failures while logging them.
2. Return non-2xx whenever internal processing fails and rely on gateway retry.
3. Queue every callback before acknowledging it.

### Choice

The API verifies HMAC-SHA256 over the untouched raw body, then processes the
event in a PostgreSQL transaction. `payment_events.event_id` is the database
deduplication key. Accepted duplicates are no-ops and still receive `200`.
Malformed accepted payloads or processing failures are logged and acknowledged;
invalid signatures receive `401`.

Before calling `/charge`, the API commits a local `PENDING` payment with stable
idempotency key `bk_<booking-id>`. That lets an early callback find its local
record. A timeout/5xx is retried once using the same key; an uncertain outcome
remains pending for a late callback.

### Why

- The provided gateway can duplicate callbacks, race its own `/charge`
  response, and retry non-2xx deliveries up to eight times.
- A primary key arbitrates duplicates even when multiple API workers receive
  them concurrently; an in-memory “seen set” would not.
- Keeping the booking, payment, event, and affected seat transition in one
  transaction prevents partial confirmation or double-counted revenue.
- Stable outbound idempotency prevents a retry from creating a second charge.

### What we gave up

- A processing failure acknowledged with `200` will not be retried by the
  gateway. Structured logs are the current recovery evidence; a production
  design should add a durable inbox/outbox and reconciliation worker.
- Queue-first handling would be more durable and absorb bursts, but it adds a
  broker, another deployment, and another failure mode that the event scope
  does not require.
- Returning `401` for an invalid signature deliberately prioritizes security;
  only authenticated/accepted deliveries receive the always-ack behavior.

### Evidence

Integration tests cover bad signatures, duplicate delivery, the
callback-before-response race, booking confirmation, and booking-scoped seat
release on failure.
