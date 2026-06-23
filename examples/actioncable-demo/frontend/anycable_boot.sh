#!/usr/bin/env bash
# Boots the full AnyCable stack for the e2e harnesses: the Ruby RPC server
# (channel logic), anycable-go (the Go WebSocket gateway), and Rails/Puma (pages
# + /content + broadcasting). The browser talks to anycable-go on $WS_PORT;
# channel logic runs in a separate process from the page server, so documents
# come from the durable store rather than process memory — the AnyCable analogue
# of the multi-process ActionCable runs. Needs Redis (the broadcast adapter) and
# anycable-go on PATH.
#
#   HTTP_PORT=3797 WS_PORT=8080 REDIS_URL=redis://localhost:6379/15 ./anycable_boot.sh
#
# Writes every pid to $ANYCABLE_PIDFILE (one per line) so the caller can tear the
# whole stack down with: kill $(cat "$ANYCABLE_PIDFILE")
set -euo pipefail

HTTP_PORT="${HTTP_PORT:-3797}"
WS_PORT="${WS_PORT:-8080}"
RPC_PORT="${RPC_PORT:-50051}"
REDIS_URL="${REDIS_URL:-redis://localhost:6379/15}"
PIDFILE="${ANYCABLE_PIDFILE:-/tmp/anycable-stack.pid}"
LOGDIR="${ANYCABLE_LOGDIR:-/tmp}"

cd "$(dirname "$0")/.." # examples/actioncable-demo
: > "$PIDFILE"

# 1) RPC server (channel logic in Ruby), gRPC on $RPC_PORT.
CABLE_ADAPTER=any_cable ANYCABLE_RPC_HOST="127.0.0.1:$RPC_PORT" \
  bundle exec anycable > "$LOGDIR/anycable-rpc.log" 2>&1 &
echo $! >> "$PIDFILE"

# 2) anycable-go (WebSocket gateway) — terminates sockets, calls the RPC server.
anycable-go --host=127.0.0.1 --port="$WS_PORT" --rpc_host="127.0.0.1:$RPC_PORT" \
  --broadcast_adapter=redis --redis_url="$REDIS_URL" > "$LOGDIR/anycable-go.log" 2>&1 &
echo $! >> "$PIDFILE"

# 3) Rails/Puma (pages + /content + broadcasting via AnyCable).
CABLE_ADAPTER=any_cable bin/rails s -p "$HTTP_PORT" -P "tmp/pids/anycable-http.pid" \
  > "$LOGDIR/anycable-http.log" 2>&1 &
echo $! >> "$PIDFILE"

# Healthy = pages serve AND the go gateway answers /health.
rails="" gateway=""
for _ in $(seq 1 60); do
  rails=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$HTTP_PORT/docs/demo" || true)
  gateway=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$WS_PORT/health" || true)
  if [ "$rails" = "200" ] && [ "$gateway" = "200" ]; then
    echo "anycable_boot.sh: stack healthy (rails :$HTTP_PORT, go :$WS_PORT, rpc :$RPC_PORT)"
    exit 0
  fi
  sleep 1
done

echo "anycable_boot.sh: stack did not become healthy (rails=$rails go=$gateway)" >&2
for l in anycable-rpc anycable-go anycable-http; do
  echo "--- $l.log ---" >&2; tail -20 "$LOGDIR/$l.log" >&2 || true
done
exit 1
