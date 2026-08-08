#!/usr/bin/env bash
# scripts/concurrent-holds.sh — manual Scenario A reproduction.
# 100 concurrent POST /holds on the same (showtime, seat) → exactly 1 success.
# Run from the HOST against the dockerised api at $URL.

set -euo pipefail

URL="${URL:-http://localhost:3001}"
SHOWTIME_ID="${SHOWTIME_ID:-1}"   # Spider-Man premiere (seed)
SEAT_ID="${SEAT_ID:-50}"          # any seat in Hall A
N="${N:-100}"
TMP="${TMPDIR:-/tmp}"

echo "Firing $N concurrent POST /holds at $URL/holds (showtime=$SHOWTIME_ID, seat=$SEAT_ID)"

# Reset the seat to AVAILABLE so reruns are deterministic.
docker compose exec -T postgres psql -U postgres -d cinemaseat \
  -c "UPDATE show_seats SET status='AVAILABLE', hold_id=NULL, hold_expires_at=NULL, booking_id=NULL WHERE showtime_id=$SHOWTIME_ID AND seat_id=$SEAT_ID;" \
  > /dev/null

# Fire N requests in parallel, capture both status code and body.
for i in $(seq 1 "$N"); do
  curl -s -o "$TMP/hold_$i.json" -w "%{http_code}\n" \
    -X POST "$URL/holds" \
    -H "Content-Type: application/json" \
    -d "{\"showtime_id\":$SHOWTIME_ID,\"seat_id\":$SEAT_ID}" \
    > "$TMP/hold_$i.code" &
done
wait

SUCCESS=$(grep -l '^201$' "$TMP"/hold_*.code 2>/dev/null | wc -l | tr -d ' ')
CONFLICT=$(grep -l '^409$' "$TMP"/hold_*.code 2>/dev/null | wc -l | tr -d ' ')
OTHER=$(( N - SUCCESS - CONFLICT ))

echo "successful_holds : $SUCCESS"
echo "conflicts        : $CONFLICT"
echo "other            : $OTHER"

echo "DB state for that seat:"
docker compose exec -T postgres psql -U postgres -d cinemaseat \
  -c "SELECT status, hold_id, hold_expires_at FROM show_seats WHERE showtime_id=$SHOWTIME_ID AND seat_id=$SEAT_ID;"

rm -f "$TMP"/hold_*.code "$TMP"/hold_*.json

# Exit non-zero if the contract was violated.
if [[ "$SUCCESS" != "1" || "$CONFLICT" != "$((N-1))" ]]; then
  echo "FAIL: expected 1 success / $((N-1)) conflicts, got $SUCCESS / $CONFLICT"
  exit 1
fi
echo "OK: 1 success / $((N-1)) conflicts, no oversell."
