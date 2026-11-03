#!/usr/bin/env bash
# Install and run the app on one machine, with Home Assistant on another (for example a Raspberry Pi).
#
#   ./alice.sh install http://ha.local:8123     one-time setup: checks, token, build
#   ./alice.sh start [--tunnel | --origin URL]  start in the background (--tunnel: quick https address;
#                                               --origin: the https address your own reverse proxy serves)
#   ./alice.sh stop | status | logs
#   ./alice.sh cli <command>                    server admin commands, e.g. setup-code, list-admins, recovery-code <id>
#
# Everything this script creates lives in ./.alice (git-ignored): config, the HA token (mode 600), database, logs.
# The compose stack in deploy/ is for running next to HA on one box; this script is for the other case.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE="$ROOT/.alice"
ENVF="$STATE/env"
PORT="${PORT:-3000}"

say()  { printf '\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
die()  { printf '\033[31mError:\033[0m %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1; }

load_env() {
  [ -f "$ENVF" ] || die "Not installed yet. Run: ./alice.sh install http://<your-home-assistant>:8123"
  set -a; . "$ENVF"; set +a
}

install_bun() {
  if need bun; then return; fi
  say "Bun is not installed."
  read -r -p "  Install it now from https://bun.sh (the official installer)? [y/N] " a
  [[ "$a" =~ ^[Yy]$ ]] || die "Install Bun (https://bun.sh) and run this again."
  need curl || die "curl is needed to install Bun."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
  need bun || die "Bun installed but is not on PATH. Open a new terminal and run this again."
}

cmd_install() {
  local url="${1:-${HA_URL:-}}"
  [ -n "$url" ] || die "Give the address of Home Assistant, e.g. ./alice.sh install http://ha.local:8123"
  [[ "$url" =~ ^https?:// ]] || url="http://$url"
  url="${url%/}"
  need curl || die "curl is needed."

  say "1/5  Tools"
  install_bun
  ok "bun $(bun --version)"

  say "2/5  Home Assistant at $url"
  local code
  code="$(curl -s -o /dev/null -m 8 -w '%{http_code}' "$url/api/" || true)"
  case "$code" in
    401|200) ok "reachable" ;;
    000)     die "Cannot reach $url from this machine. Check the address, that HA is running, and that this machine is on the same network." ;;
    *)       die "$url answered HTTP $code. That does not look like Home Assistant's address (expected something like http://ha.local:8123)." ;;
  esac

  say "3/5  Access token"
  mkdir -p "$STATE"; chmod 700 "$STATE"
  local token="${HA_TOKEN:-}"
  if [ -z "$token" ] && [ -f "$STATE/ha_token" ]; then
    read -r -p "  A token is already saved. Keep it? [Y/n] " a
    [[ "$a" =~ ^[Nn]$ ]] || token="$(cat "$STATE/ha_token")"
  fi
  if [ -z "$token" ]; then
    echo "  In Home Assistant: your profile (bottom-left) → Security → Long-lived access tokens → Create token."
    echo "  Use an administrator account; the app creates a helper and writes scenes and automations."
    read -r -s -p "  Paste the token (it will not be shown): " token; echo
  fi
  token="$(printf '%s' "$token" | tr -d '[:space:]')"
  [ -n "$token" ] || die "No token given."
  local cfg
  cfg="$(curl -s -m 8 -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $token" "$url/api/config" || true)"
  [ "$cfg" = "200" ] || die "Home Assistant rejected the token (HTTP $cfg). Create a new long-lived token and try again."
  ( umask 077; printf '%s' "$token" > "$STATE/ha_token" )
  ok "token accepted and saved to .alice/ha_token (mode 600)"
  local need_cfg
  need_cfg="$(curl -s -m 8 -H "Authorization: Bearer $token" "$url/api/config" | grep -o '"components":\[[^]]*\]' | grep -c '"automation"' || true)"
  [ "$need_cfg" = "0" ] && echo "  note: HA reports no automation component. See docs/INSTALL.md section 3.4 (the three !include lines)."

  say "4/5  Dependencies and web app"
  ( cd "$ROOT" && bun install --frozen-lockfile >/dev/null && bun run build:web >/dev/null )
  ok "built apps/web/build"

  say "5/5  Config"
  cat > "$ENVF" <<EOF
HA_URL=$url
HA_TOKEN_FILE=$STATE/ha_token
DB_PATH=$STATE/app.db
WEB_DIR=$ROOT/apps/web/build
PORT=$PORT
VAPID_SUBJECT=mailto:admin@localhost.invalid
EOF
  ok "wrote .alice/env"
  echo
  say "Done. Start it with:"
  echo "  ./alice.sh start             # on this machine only, http://localhost:$PORT"
  echo "  ./alice.sh start --tunnel    # reachable from your phone over https (needed for passkeys on a phone)"
}

running() { [ -f "$STATE/server.pid" ] && kill -0 "$(cat "$STATE/server.pid")" 2>/dev/null; }

cmd_start() {
  load_env
  local tunnel=0 public=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --tunnel) tunnel=1 ;;
      --origin) shift; public="${1:-}"; [[ "$public" =~ ^https:// ]] || die "--origin needs the public https address, e.g. --origin https://home.example.com" ;;
      *) die "Unknown option $1" ;;
    esac; shift
  done
  [ "$tunnel" = 1 ] && [ -n "$public" ] && die "Use either --tunnel or --origin, not both."
  running && die "Already running. Use ./alice.sh stop first (or ./alice.sh status)."

  local origin="http://localhost:$PORT" secure=false
  if [ -n "$public" ]; then origin="${public%/}"; secure=true; fi
  if [ "$tunnel" = 1 ]; then
    need cloudflared || die "--tunnel needs cloudflared (https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)."
    : > "$STATE/tunnel.log"
    setsid nohup cloudflared tunnel --no-autoupdate --protocol http2 --url "http://localhost:$PORT" >"$STATE/tunnel.log" 2>&1 </dev/null &
    echo $! > "$STATE/tunnel.pid"
    say "Opening tunnel…"
    local i url=""
    for i in $(seq 1 40); do
      url="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$STATE/tunnel.log" | head -1 || true)"
      [ -n "$url" ] && break; sleep 1
    done
    [ -n "$url" ] || { kill "$(cat "$STATE/tunnel.pid")" 2>/dev/null || true; die "The tunnel did not come up. See .alice/tunnel.log"; }
    origin="$url"; secure=true
    echo "$url" > "$STATE/tunnel.url"
  fi

  cd "$ROOT/apps/server"
  ORIGIN="$origin" COOKIE_SECURE="$secure" setsid nohup bun src/index.ts >"$STATE/server.log" 2>&1 </dev/null &
  echo $! > "$STATE/server.pid"
  local i
  for i in $(seq 1 30); do
    curl -fs -m 2 "http://localhost:$PORT/healthz" >/dev/null 2>&1 && break
    running || { tail -n 20 "$STATE/server.log"; die "The server stopped. See .alice/server.log"; }
    sleep 1
  done
  curl -fs -m 2 "http://localhost:$PORT/healthz" >/dev/null 2>&1 || die "The server did not answer. See .alice/server.log"

  say "Running"
  echo "  Open: $origin"
  local sc; sc="$(grep -o 'setup code [A-Za-z0-9-]*' "$STATE/server.log" | tail -1 || true)"
  if [ -n "$sc" ]; then echo "  First time: open $origin/setup and use the ${sc} (valid 1 hour)"
  else
    echo "  No account yet?  ./alice.sh cli setup-code     (then open $origin/setup)"
    echo "  Account exists but this address is new (passkeys belong to the address)?  ./alice.sh cli list-admins, then ./alice.sh cli recovery-code <id>"
  fi
  [ "$tunnel" = 1 ] && echo "  This tunnel address changes every time you start with --tunnel; for a permanent address see docs/INSTALL.md section 11."
}

cmd_stop() {
  local f p
  for f in server tunnel; do
    if [ -f "$STATE/$f.pid" ]; then p="$(cat "$STATE/$f.pid")"; kill "$p" 2>/dev/null && ok "stopped $f" || true; rm -f "$STATE/$f.pid"; fi
  done
}

cmd_status() {
  load_env
  if running; then ok "server running (pid $(cat "$STATE/server.pid"))"; curl -s -m 3 "http://localhost:$PORT/healthz" || true; echo
  else echo "  server not running"; fi
  [ -f "$STATE/tunnel.url" ] && echo "  last tunnel: $(cat "$STATE/tunnel.url")"
  echo "  Home Assistant: $HA_URL"
}

cmd_cli() { load_env; cd "$ROOT/apps/server" && bun src/cli.ts "$@"; }
cmd_logs() { tail -n "${1:-60}" -f "$STATE/server.log"; }

case "${1:-help}" in
  install) shift; cmd_install "$@" ;;
  start)   shift; cmd_start "$@" ;;
  stop)    cmd_stop ;;
  status)  cmd_status ;;
  logs)    shift; cmd_logs "$@" ;;
  cli)     shift; cmd_cli "$@" ;;
  *) sed -n 2,11p "$0" | sed 's/^# \{0,1\}//' ;;
esac
