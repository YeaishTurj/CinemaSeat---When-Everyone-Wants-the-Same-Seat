# CinemaSeat — When Everyone Wants the Same Seat

> Zero to Production · Phase 2 · IEEECS CUET

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full design and [`plan.md`](./plan.md) for the build-day timeline.

## Quick start

```bash
docker compose up --build
```

The committed Compose defaults are sufficient for a clean clone. Copy
`.env.example` to `.env` only when you want to override them.

- Frontend: <http://localhost:3000>
- API: <http://localhost:3001>
- Gateway (provided, do not mock): <http://localhost:9000>

## Judging requests

Fetch the seat map for showtime `1`:

```bash
curl -fsS http://localhost:3001/showtimes/1/seats
```

Hold seat `50` for showtime `1`:

```bash
curl -fsS -X POST http://localhost:3001/holds \
  -H 'Content-Type: application/json' \
  -d '{"showtime_id":1,"seat_id":50}'
```

`HOLD_TTL_SECONDS` controls hold expiry and defaults to 300 seconds.

## Production containers

Both application images use multi-stage builds, deterministic `npm ci`
installs, health checks, and the unprivileged `node` user. The frontend uses
Next.js standalone output rather than shipping build tooling or its complete
dependency tree.

```bash
docker compose build
docker compose up -d
docker compose ps
```

Measured locally on 8 August 2026:

- API image: 49.9 MB
- Frontend image: 63.8 MB
- Frontend: Next.js 16.3.0 and React 19.2.0
- Production dependency audit: zero known vulnerabilities

Local Compose enables deterministic OTP and payment behavior for a repeatable
demo. Set `OTP_MOCK_MODE=` and `GATEWAY_MOCK_MODE=` in production to restore
the gateway's documented failure behavior, and set `ENABLE_DEV_OTP=false` to
disable the OTP debug helper.

## CI/CD

`.github/workflows/ci.yml` runs on pull requests and pushes to `main`:

1. API dependency install, ESLint, and all Jest/Supertest tests against a real
   PostgreSQL 16 service container.
2. Frontend dependency install, ESLint, and production build.
3. Independent production Docker builds for both application images.

`.github/workflows/deploy.yml` runs only after a successful push-triggered CI
run on `main`, then updates the Poridhi VM over SSH and performs an API health
check. Configure these repository secrets before deployment:

- `PORIDHI_HOST`
- `PORIDHI_USER`
- `PORIDHI_SSH_KEY`

The VM checkout is expected at `~/cinemaseat`. GitHub branch protection for
`main` must require both CI jobs before merging.

## Main dependencies

Next.js, React, Express, node-postgres, PostgreSQL, and the provided
`asifmahmoud414/mock-gateway` container. See `package-lock.json` in each
application directory for exact dependency versions.
