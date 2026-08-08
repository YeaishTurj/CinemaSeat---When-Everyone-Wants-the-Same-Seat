# CinemaSeat — When Everyone Wants the Same Seat

[![CI](https://github.com/YeaishTurj/CinemaSeat---When-Everyone-Wants-the-Same-Seat/actions/workflows/ci.yml/badge.svg)](https://github.com/YeaishTurj/CinemaSeat---When-Everyone-Wants-the-Same-Seat/actions/workflows/ci.yml)

CinemaSeat is a production-shaped movie-ticket booking demo built for **Zero to
Production · Phase 2 · IEEECS CUET**. It covers the complete customer path:
browse movies and showtimes, inspect a live seat map, hold exactly one seat,
verify OTP, start an asynchronous payment, and receive confirmation without
ever selling the same seat twice.

- **Live demo:** <http://13.212.112.161:3000>
- **API health:** <http://13.212.112.161:3001/health>
- **Detailed design:** [`ARCHITECTURE.md`](./ARCHITECTURE.md)
- **Trade-offs:** [`DECISIONS.md`](./DECISIONS.md)
- **Required proof:** [Scenario A](./docs/scenarioA.md) · [Scenario B](./docs/scenarioB.md)

> The deployment uses the event's temporary Poridhi-provided AWS lab. Its
> public IP and the entire account disappear when the 12-hour lab expires. The
> repository remains fully reproducible from a clean clone.

## What works

- Seeded movies, theatres, showtimes, prices, and 120-seat screens.
- Live seat availability with lazy release of expired holds.
- PostgreSQL row locks (`SELECT ... FOR UPDATE`) on the contested seat.
- A configurable `HOLD_TTL_SECONDS`; no expiry value is hardcoded.
- OTP send, resend, verify, and a clearly labelled local-demo OTP helper.
- Asynchronous payment initiation with a stable idempotency key and one retry.
- HMAC-SHA256 verification over raw webhook bytes.
- Database-enforced webhook deduplication and callback-before-response handling.
- Failure isolation: health, browsing, seat maps, and holds work if the gateway
  is unavailable; an uncertain payment remains `PENDING` instead of returning
  an internal error.
- Multi-stage, non-root production containers and health-gated Compose startup.
- CI on pull requests and `main`, protected-branch checks, and CD only after a
  successful push CI run on `main`.

## Architecture

```mermaid
flowchart LR
    U[Browser] -->|HTTP :3000| F[Next.js frontend]
    F -->|/api rewrite| A[Express API :3000]
    A --> C[Catalog module]
    A --> S[Seat and hold module]
    A --> B[Booking / OTP / payment modules]
    C --> P[(PostgreSQL 16)]
    S -->|row lock + transaction| P
    B --> P
    B -->|charge / OTP| G[Provided gateway :9000]
    G -->|signed async webhooks| B
```

This is a **modular monolith**, not a collection of microservices. The API has
separate catalog, seats, bookings, OTP, payments, health, and shared-infrastructure
modules, while one PostgreSQL transaction remains the authority for seat
ownership. See [`DECISIONS.md`](./DECISIONS.md) for the reasoning and costs.

### The no-oversell invariant

For a `(showtime_id, seat_id)`, `POST /holds` starts a transaction and locks the
single `show_seats` row. Only `AVAILABLE` or expired `HELD` rows can transition
to a new hold. Concurrent requests wait for that lock, observe the winner's
unexpired hold, and return `409 CONFLICT`. The database also enforces a unique
`(showtime_id, seat_id)` row.

## Run from a clean clone

Requirements: Git, Docker Engine, and Docker Compose v2. No Node.js or local
PostgreSQL installation is needed.

```bash
git clone https://github.com/YeaishTurj/CinemaSeat---When-Everyone-Wants-the-Same-Seat.git
cd CinemaSeat---When-Everyone-Wants-the-Same-Seat
docker compose up --build
```

Compose initializes and seeds PostgreSQL automatically. Wait until all four
services are healthy, then open <http://localhost:3000>.

| Service | Local URL | Purpose |
|---|---|---|
| Frontend | <http://localhost:3000> | Customer booking UI |
| API | <http://localhost:3001> | Public application API |
| Gateway | <http://localhost:9000> | Event-provided payment/OTP service |
| PostgreSQL | `localhost:5432` | Seeded application database |

The committed Compose defaults intentionally enable deterministic gateway
behavior: OTP is `123456`, and payment succeeds after about two seconds. This
makes the clean-clone demo repeatable. To stop and remove containers:

```bash
docker compose down
```

Add `--volumes` only when you deliberately want to erase local database data.

## Judge hooks — exact requests

The API is exposed on port `3001` on the host.

Fetch the seat map for seeded showtime `1`:

```bash
curl -fsS http://localhost:3001/showtimes/1/seats
```

Hold seeded seat `50` for showtime `1`:

```bash
curl -fsS -X POST http://localhost:3001/holds \
  -H 'Content-Type: application/json' \
  -d '{"showtime_id":1,"seat_id":50}'
```

Expected hold response:

```json
{"ok":true,"hold_id":"<uuid>","expires_in":300}
```

A simultaneous or repeated request for the same unexpired seat returns `409`.
To observe quick expiry, start Compose with a short environment override:

```bash
HOLD_TTL_SECONDS=5 docker compose up --build
```

The liveness hook does not query PostgreSQL or the gateway and stays available
when the gateway is stopped:

```bash
curl -fsS http://localhost:3001/health
```

## End-to-end demo

1. Open the frontend, choose a movie, showtime, and available seat.
2. Enter a user reference and phone number, then create the hold and booking.
3. Click **Send OTP**. With the clean-clone defaults, the latest code appears
   after gateway delivery; verify it.
4. Click **Pay**. The API returns immediately with `PENDING`.
5. The signed gateway callback confirms the booking and the UI redirects to the
   confirmation page.

The same flow can be exercised from the terminal:

```bash
bash scripts/full-flow.sh
```

## API reference

| Method | Path | Purpose | Main responses |
|---|---|---|---|
| `GET` | `/health` | Dependency-free liveness | `200` |
| `GET` | `/movies` | List seeded movies | `200` |
| `GET` | `/showtimes?movie_id=1` | List a movie's showtimes | `200`, `400` |
| `GET` | `/showtimes/:id/seats` | Live seat map; expired holds appear available | `200`, `400` |
| `POST` | `/holds` | Atomically hold one seat | `201`, `404`, `409` |
| `POST` | `/bookings` | Turn a valid hold into a pending booking | `201`, `404`, `409` |
| `GET` | `/bookings/:id` | Poll booking, OTP, payment, and seats | `200`, `404` |
| `POST` | `/bookings/:id/otp/send` | Request or resend an OTP | `202`, `400`, `502` |
| `POST` | `/bookings/:id/otp/verify` | Verify the supplied OTP | `200`, `400`, `429`, `502` |
| `POST` | `/bookings/:id/pay` | Start an idempotent async charge | `202`, `404`, `502` |
| `POST` | `/webhooks/payment` | Signed payment callback | `200`, `401` |
| `POST` | `/webhooks/otp` | Signed OTP callback | `200`, `401` |
| `GET` | `/dev/otp-latest/:ref` | Local gateway-debug helper | `200`, `404`, `503` |

`POST /bookings` accepts:

```json
{"hold_id":"<uuid>","user_ref":"demo-user","phone":"01700000000"}
```

## Gateway behavior and recovery

The project uses the required
`asifmahmoud414/mock-gateway:latest` image; it does not replace it with an
in-project mock. The API sends callback URLs using Compose DNS
(`http://api:3000/...`) and payment idempotency key `bk_<booking-id>`.

- Duplicate callbacks use `payment_events.event_id` as a primary key and are
  acknowledged without applying the state transition twice.
- A callback can arrive before `/charge` responds because the local payment row
  is committed before the outbound request.
- A timeout or network failure is retried once with the same idempotency key.
  If the outcome remains uncertain, the payment stays `PENDING` for a possible
  late callback.
- Invalid webhook signatures are rejected. Accepted duplicate or malformed
  deliveries are acknowledged to avoid a retry storm.

For the gateway's real failure rates, create `.env` from `.env.example` and set:

```dotenv
OTP_MOCK_MODE=
GATEWAY_MOCK_MODE=
ENABLE_DEV_OTP=false
```

## Configuration

Compose reads optional values from a root `.env` file.

| Variable | Default | Meaning |
|---|---|---|
| `HOLD_TTL_SECONDS` | `300` | Hold lifetime in seconds |
| `DATABASE_URL` | Compose PostgreSQL URL | API database connection |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | local demo values | Database initialization |
| `GATEWAY_URL` | `http://gateway:9000` | Internal gateway base URL |
| `GATEWAY_SECRET` | event demo secret | HMAC signing secret |
| `GATEWAY_TIMEOUT_MS` | `6000` | Outbound gateway timeout in milliseconds |
| `PG_POOL_MAX` | `30` | PostgreSQL connection-pool ceiling |
| `GATEWAY_MOCK_MODE` | `deterministic` | Repeatable payment behavior when set |
| `OTP_MOCK_MODE` | `deterministic` | Repeatable OTP delivery when set |
| `ENABLE_DEV_OTP` | `true` | Expose the local OTP debug helper |

Never commit a real `.env`, private key, or cloud credential.

## Tests and evidence

The CI suite uses a real PostgreSQL 16 service, not an in-memory substitute.

```bash
cd api
npm ci
DATABASE_URL=postgres://postgres:postgres@localhost:5432/cinemaseat \
  GATEWAY_SECRET=z2p-2026-secret npm test
```

Current automated coverage includes:

- 100 concurrent buyers on one seat: exactly 1 success and 99 conflicts.
- Expired hold becomes available and a second buyer succeeds.
- Invalid webhook signature rejection.
- Duplicate callback deduplication and callback-before-response race.
- Failed payment releases only the affected booking's seat.
- Timeout retry with a stable idempotency key.
- Gateway-down isolation for health and catalog traffic.

Recorded reports: [`docs/scenarioA.md`](./docs/scenarioA.md) and
[`docs/scenarioB.md`](./docs/scenarioB.md). Scenario C is optional and was not
claimed as completed.

## Containers, CI, and deployment

The API and frontend use multi-stage builds, lockfile-backed `npm ci`, Alpine
runtime images, and the unprivileged `node` user. Measured on 8 August 2026:

- API image: **49.9 MB**
- Frontend image: **63.8 MB**
- Production dependency audits: **0 known vulnerabilities**

```mermaid
flowchart LR
    PR[Pull request] --> CI[Lint + audit + test + build]
    PUSH[Push to main] --> CI
    CI -->|required checks pass| MERGE[Protected main]
    CI -->|successful main push only| CD[SSH deployment]
    CD --> BUILD[docker compose up -d --build]
    BUILD --> HEALTH[Post-deploy API health check]
```

The active `main` ruleset requires both CI jobs, pull requests, and blocks
deletion and force-pushes. The deploy workflow expects an SSH host with the
repository at `~/cinemaseat` and these GitHub Actions secrets:

- `PORIDHI_HOST`
- `PORIDHI_USER`
- `PORIDHI_SSH_KEY`

One-time server preparation (Ubuntu 24.04):

```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2 git
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
git clone https://github.com/YeaishTurj/CinemaSeat---When-Everyone-Wants-the-Same-Seat.git ~/cinemaseat
```

Reconnect after adding the Docker group. Every successful `main` push then
fast-forwards the checkout, rebuilds Compose, and verifies API health.

## Known limitations and deliberate cuts

- This is an event demo, not a hardened public ticketing service: there is no
  authentication, authorization, admin portal, rate limiting, TLS terminator,
  or payment-provider reconciliation worker.
- The public demo deliberately uses deterministic gateway mode and exposes the
  OTP debug helper. Both must be disabled for a real deployment.
- Hold expiry is lazy: reads display expired holds as available and the next
  contender atomically reclaims them. There is no background cleanup worker.
- A hold request currently covers one seat. The schema can associate several
  seats with one hold, but the public route does not yet offer group selection.
- `REFUNDED` events update payment state, but there is no refund UI or endpoint.
- Scenario C breakpoint/load testing, metrics, tracing, Nginx, and horizontal
  scaling are bonus work and were not claimed.
- PostgreSQL and gateway ports are published for judging/debugging convenience;
  a production network should expose only the reverse proxy.

## Acknowledgements

- The required payment/OTP image is
  [`asifmahmoud414/mock-gateway`](https://hub.docker.com/r/asifmahmoud414/mock-gateway).
- Runtime and tooling: Next.js, React, Tailwind CSS, Express, Axios,
  node-postgres, PostgreSQL, Jest, Supertest, ESLint, Docker, Docker Compose,
  GitHub Actions, and `appleboy/ssh-action`.
- The seeded Spider-Man poster URL points to Wikimedia Commons; the application
  remains functional if that external image is unavailable.
- Development and documentation were AI-assisted; all architecture and code
  remain the team's responsibility to understand and defend.

## Repository map

```text
frontend/               Next.js App Router UI
api/src/modules/        Catalog, seats, bookings, OTP, payments, health
api/src/shared/         Database, errors, gateway client, HMAC, logging
api/tests/              Concurrency, expiry, webhook, retry, isolation tests
db/init/                Clean-clone schema and seed initialization
scripts/                Full-flow and concurrent-hold reproductions
docs/                   Required scenario evidence
.github/workflows/      CI and gated SSH deployment
```
