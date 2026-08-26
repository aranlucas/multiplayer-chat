#!/bin/zsh

set -euo pipefail

readonly relay_repository="/Users/lucas/Projects/multiplayer-chat"
readonly relay_runner_token_service="relay-microsandbox-runner-token"
readonly relay_runner_origin="http://127.0.0.1:7777"
readonly relay_cloudflared="/opt/homebrew/bin/cloudflared"
readonly relay_node_bin="/Users/lucas/.nvm/versions/node/v24.13.0/bin"
readonly relay_pnpm="$relay_node_bin/pnpm"
readonly relay_log_directory="/Users/lucas/Library/Logs/Relay"

export PATH="$relay_node_bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

/bin/mkdir -p "$relay_log_directory"
relay_tunnel_log="$(/usr/bin/mktemp -t relay-cloudflared)"
relay_runner_pid=""
relay_tunnel_pid=""

cleanup() {
  [[ -n "$relay_tunnel_pid" ]] && /bin/kill "$relay_tunnel_pid" 2>/dev/null || true
  [[ -n "$relay_runner_pid" ]] && /bin/kill "$relay_runner_pid" 2>/dev/null || true
  [[ -n "$relay_tunnel_pid" ]] && wait "$relay_tunnel_pid" 2>/dev/null || true
  [[ -n "$relay_runner_pid" ]] && wait "$relay_runner_pid" 2>/dev/null || true
  /bin/rm -f "$relay_tunnel_log"
}
trap cleanup EXIT INT TERM

relay_runner_token="$(/usr/bin/security find-generic-password -s "$relay_runner_token_service" -w)"

cd "$relay_repository"
MICROSANDBOX_RUNNER_TOKEN="$relay_runner_token" \
  "$relay_pnpm" runner >>"$relay_log_directory/runner.log" 2>&1 &
relay_runner_pid=$!

for attempt in {1..60}; do
  if /usr/bin/curl -fsS "$relay_runner_origin/health" \
    -H "Authorization: Bearer $relay_runner_token" >/dev/null; then
    break
  fi
  if ! /bin/kill -0 "$relay_runner_pid" 2>/dev/null; then
    exit 1
  fi
  /bin/sleep 1
done

if ! /usr/bin/curl -fsS "$relay_runner_origin/health" \
  -H "Authorization: Bearer $relay_runner_token" >/dev/null; then
  exit 1
fi

"$relay_cloudflared" tunnel --no-autoupdate --url "$relay_runner_origin" \
  >"$relay_tunnel_log" 2>&1 &
relay_tunnel_pid=$!

relay_public_url=""
for attempt in {1..60}; do
  relay_public_url="$(/usr/bin/sed -nE 's#.*(https://[a-z-]+\.trycloudflare\.com).*#\1#p' "$relay_tunnel_log" | /usr/bin/tail -1)"
  [[ -n "$relay_public_url" ]] && break
  if ! /bin/kill -0 "$relay_tunnel_pid" 2>/dev/null; then
    exit 1
  fi
  /bin/sleep 1
done
[[ -n "$relay_public_url" ]] || exit 1

printf '%s' "$relay_public_url" | WRANGLER_SEND_METRICS=false \
  "$relay_pnpm" exec wrangler secret put MICROSANDBOX_RUNNER_URL \
    --config "$relay_repository/wrangler.jsonc" \
    >>"$relay_log_directory/tunnel-registration.log" 2>&1

while /bin/kill -0 "$relay_runner_pid" 2>/dev/null && \
  /bin/kill -0 "$relay_tunnel_pid" 2>/dev/null; do
  /bin/sleep 5
done

exit 1
