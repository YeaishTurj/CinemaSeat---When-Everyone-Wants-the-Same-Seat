# Scenario A — One seat, many buyers

## Method

- Date: 8 August 2026
- Target: seeded showtime `1`, seat `50`
- Load: 100 concurrent `POST /holds` requests in one burst
- Generator: host machine, separate from the API container
- Command: `bash scripts/concurrent-holds.sh`

Every request used the exact same payload:

```json
{"showtime_id":1,"seat_id":50}
```

## Observed result

```text
requests sent     : 100
successful holds  : 1
conflicts         : 99
other responses   : 0
oversell count    : 0
final seat state  : HELD, with one hold_id
```

This matches the required result: exactly one buyer received `201`; all other
buyers received clean `409` conflicts. The final database query showed one
`show_seats` row and one winning `hold_id`.

## Why it stayed correct

Each request locked the same `(showtime_id, seat_id)` row with
`SELECT ... FOR UPDATE`. The first transaction changed it to `HELD`; waiting
transactions then observed the committed unexpired hold and rejected the
request. The unique database constraint on `(showtime_id, seat_id)` provides a
second structural guard against duplicate seat-state rows.

The same assertion runs in CI in
`api/tests/holds.concurrency.test.js` against a real PostgreSQL service.
