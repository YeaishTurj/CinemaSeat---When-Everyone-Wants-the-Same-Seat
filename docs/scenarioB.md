# Scenario B — The abandoned hold

## Method

- Date: 8 August 2026
- Target: seeded showtime `1`, seat `50`
- `HOLD_TTL_SECONDS=1` for the automated proof
- First buyer holds the seat and does not create a booking or pay.
- After expiry, the seat map is fetched and a different buyer holds and books
  the same seat.

## Observed timeline

| Relative time | Observation |
|---:|---|
| `t+0.0s` | First buyer received `201` with a new `hold_id` and `expires_in: 1`. |
| `t+1.1s` | `GET /showtimes/1/seats` reported seat `50` as `AVAILABLE` with no active expiry. |
| `t+1.1s` | Second buyer received `201` with a different `hold_id`. |
| immediately after | `POST /bookings` for the second hold returned `201` and recorded the second buyer. |

## Result

The abandoned hold became available without a process restart or manual
database cleanup, and a different buyer successfully booked it. Expiry is
implemented lazily: the seat map normalizes an expired hold to `AVAILABLE`, and
the next hold request atomically reclaims the locked row and clears the stale
booking association.

This scenario is a regression test in
`api/tests/holds.concurrency.test.js` and runs against PostgreSQL in CI.
