#!/usr/bin/env bash
# Manual smoke test for the full async booking flow.
# Usage:  bash scripts/full-flow.sh
# Assumes: docker compose up -d --build has been run, services healthy.
set -euo pipefail

API="${API:-http://localhost:3001}"
GW_PORT="${GW_PORT:-3000}"

step() { printf "\n\033[1;34m== %s ==\033[0m\n" "$*"; }

step "0. health (api on :3001)"
curl -fsS http://localhost:3001/health; echo

step "1. pick a seat and clear state"
SEAT=$(docker compose exec -T postgres psql -U postgres -d cinemaseat -At -c \
  "SELECT s.id FROM seats s JOIN show_seats ss ON ss.seat_id=s.id
    WHERE ss.showtime_id=1 AND s.row_label='E' AND s.seat_number=3;")
echo "seat_id=$SEAT"
docker compose exec -T postgres psql -U postgres -d cinemaseat -At -c \
  "UPDATE show_seats SET status='AVAILABLE', hold_id=NULL, booking_id=NULL
    WHERE seat_id=$SEAT AND showtime_id=1;" >/dev/null
docker compose exec -T postgres psql -U postgres -d cinemaseat -At -c \
  "DELETE FROM payment_events; DELETE FROM payments; DELETE FROM bookings;
    DELETE FROM otp_sessions;" >/dev/null

step "2. hold"
HOLD=$(curl -fsS -X POST $API/holds -H 'Content-Type: application/json' \
  -d "{\"showtime_id\":1,\"seat_id\":$SEAT}" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['hold_id'])")
echo "hold_id=$HOLD"

step "3. booking (creates payment row + otp session, calls /charge)"
BK=$(curl -fsS -X POST $API/bookings -H 'Content-Type: application/json' \
  -d "{\"hold_id\":\"$HOLD\",\"user_ref\":\"demo-user\",\"phone\":\"+8801700000099\"}" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['booking']['id'])")
echo "booking_id=$BK"

step "4. otp send (retry up to 5x — gateway has a 'never delivered' chaos mode)"
CODE=""
for i in 1 2 3 4 5; do
  BEFORE=$(docker compose logs --no-color gateway 2>&1 | grep -c "OTP " || true)
  curl -fsS -X POST $API/bookings/$BK/otp/send -H 'Content-Type: application/json' \
    -d '{"phone":"+8801700000099"}' >/dev/null
  sleep 2
  AFTER=$(docker compose logs --no-color gateway 2>&1 | grep -c "OTP " || true)
  if [ "$AFTER" -gt "$BEFORE" ]; then
    CODE=$(docker compose logs --no-color gateway 2>&1 | grep -E "ref=bk_$BK " | tail -1 | grep -oE "code=[0-9]+" | cut -d= -f2)
    echo "delivered code=$CODE on attempt $i"
    break
  fi
done
[ -n "$CODE" ] || { echo "no OTP delivered after 5 attempts"; exit 1; }

step "5. otp verify"
curl -fsS -X POST $API/bookings/$BK/otp/verify -H 'Content-Type: application/json' \
  -d "{\"code\":\"$CODE\"}"; echo

step "6. pay"
curl -fsS -X POST $API/bookings/$BK/pay -H 'Content-Type: application/json' \
  -d '{"payment_token":"tok_demo"}'; echo

step "7. wait for the gateway webhook to flip the payment row"
for i in $(seq 1 15); do
  S=$(docker compose exec -T postgres psql -U postgres -d cinemaseat -At \
    -c "SELECT status FROM payments WHERE booking_id=$BK;" 2>/dev/null || echo "")
  echo "  t=${i}s payments.status=$S"
  [ "$S" = "SUCCEEDED" ] && break
  sleep 1
done

step "8. final DB state"
docker compose exec -T postgres psql -U postgres -d cinemaseat -At -c \
  "SELECT 'booking '||id||' '||status FROM bookings WHERE id=$BK;
   SELECT 'payment '||id||' bk='||booking_id||' '||status||' gw='||
          COALESCE(gateway_payment_id,'null') FROM payments WHERE booking_id=$BK;
   SELECT 'show_seat status='||ss.status||' booking_id='||
          COALESCE(ss.booking_id::text,'null')
     FROM show_seats ss WHERE ss.showtime_id=1 AND ss.seat_id=$SEAT;
   SELECT 'event '||event_id||' '||status FROM payment_events;"

step "9. UI"
echo "open http://localhost:3000/movies"
