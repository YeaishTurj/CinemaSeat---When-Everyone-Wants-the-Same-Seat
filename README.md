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
