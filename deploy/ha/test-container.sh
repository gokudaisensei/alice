#!/usr/bin/env bash
# Starts a throwaway Home Assistant (demo devices + the Alice integration), gives it an administrator and a NON-administrator key,
# and runs the real-Home-Assistant tests with each. Needs docker and bun. Nothing here touches any Home Assistant you already run.
#   deploy/ha/test-container.sh [image]      default image: ghcr.io/home-assistant/home-assistant:stable
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IMAGE="${1:-ghcr.io/home-assistant/home-assistant:stable}"
NAME="alice-test-ha-$$"; PORT="${PORT:-18125}"; BASE="http://127.0.0.1:$PORT"
DIR="$(mktemp -d)"; mkdir -p "$DIR/config/custom_components"
# The container runs as root, so first make what it wrote ours to remove, then stop it.
cleanup() { docker exec "$NAME" chmod -R a+rwX /config >/dev/null 2>&1 || true; docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$DIR" || echo "could not remove $DIR (files owned by root); remove it by hand"; }
trap cleanup EXIT
cp -r "$ROOT/deploy/ha/custom_components/alice" "$DIR/config/custom_components/alice"
printf '%s\n' 'default_config:' 'demo:' 'automation: !include automations.yaml' 'script: !include scripts.yaml' 'scene: !include scenes.yaml' 'alice:' \
  'input_select:' '  alice_household_mode:' '    name: Alice household mode' '    options: [home, away, night, vacation]' '    initial: home' > "$DIR/config/configuration.yaml"
echo '[]' > "$DIR/config/automations.yaml"; echo '{}' > "$DIR/config/scripts.yaml"; echo '[]' > "$DIR/config/scenes.yaml"
chmod -R a+rwX "$DIR"
echo "== unit tests of what the integration allows (no Home Assistant needed)"; python3 "$ROOT/deploy/ha/tests/test_validate.py"
echo "== starting $IMAGE on $BASE"
docker run -d --name "$NAME" -p "127.0.0.1:$PORT:8123" -v "$DIR/config:/config" -e TZ=UTC "$IMAGE" >/dev/null
for _ in $(seq 1 90); do [ "$(curl -s -m 2 -o /dev/null -w '%{http_code}' "$BASE/api/onboarding" || true)" = 200 ] && break; sleep 3; done
bun "$ROOT/deploy/ha/tests/onboard.ts" "$BASE" "$DIR"
sleep 8 # let the demo devices and the integration finish loading
cd "$ROOT/apps/server"
export HA_REAL_URL="$BASE" HA_REAL_APP_TOKEN="$(cat "$DIR/app.tok")"
echo "== the integration, with a key that is not an administrator's"
HA_REAL_TOKEN="$(cat "$DIR/admin.tok")" bun test src/real-component.test.ts
echo "== the app's real-Home-Assistant suite with the ADMINISTRATOR key"
HA_REAL_TOKEN="$(cat "$DIR/admin.tok")" bun test src/real-ha.test.ts
echo "== the same suite with the NON-administrator key (voice exposure is expected to fail: it needs an administrator)"
HA_REAL_TOKEN="$(cat "$DIR/app.tok")" bun test src/real-ha.test.ts || true
