# Smart Home Companion

A consumer-grade app on top of an existing Home Assistant (HA) install. HA stays the engine; this app is the front door: passkey sign-in, roles, rooms, capability-aware controls, scenes, routines, a guided automation builder, household modes, alerts and insights, energy, voice opt-in, encrypted backups, signed updates, health, and a supervised support path. HA is never exposed to the internet.

Stack: Bun + Elysia, SQLite, SvelteKit (static) + Tailwind + shadcn-svelte, Docker.

## Try it
```
bun install && bun run build:web
bun run dev:mock-ha                    # a stand-in Home Assistant on :8123 (terminal 1)
cd apps/server && DB_PATH=/tmp/alice/app.db HA_URL=http://127.0.0.1:8123 HA_TOKEN=dev-token \
  ORIGIN=http://localhost:3000 COOKIE_SECURE=false WEB_DIR=../web/build bun src/index.ts   # terminal 2
```
Open `http://localhost:3000/setup` and use the setup code the server prints. Use `localhost` (not `127.0.0.1`): passkeys need it.

With a Home Assistant that runs elsewhere: `./alice.sh install http://ha.local:8123` then `./alice.sh start` (see `docs/INSTALL.md` section 13).

For the real thing, use a real Home Assistant container instead of the mock (see `docs/CAVEATS.md` for the one-time configuration it needs).

## Tests
| What | Command |
|---|---|
| Server (141+ tests, fakes) | `bun run test` |
| Against a real Home Assistant | `HA_REAL_URL=… HA_REAL_TOKEN=… [HA_REAL_DOCKER=<container>] bun test apps/server/src/real-ha.test.ts` |
| Updater on real containers and a real registry | `deploy/updater/test.sh` |
| Egress isolation on a real network | `deploy/egress/test.sh` |
| Full topology next to a real HA | `deploy/test-topology.sh <ha-container> <token-file>` |
| Type-check everything (server, web, simulator, mock hub) | `bun run typecheck` |

## Documents
| | |
|---|---|
| `docs/INSTALL.md` | Install and set up, from an empty box to a working household |
| `docs/PLAN.md` | Architecture and decisions |
| `docs/SECURITY.md` | How each security property is achieved, per feature |
| `docs/THREAT-MODEL.md` | Threats, mitigations, residual risk |
| `docs/OFFLINE.md` | What works when the internet, the hub or the app is down |
| `docs/RUNBOOKS.md` | Recovery and operations procedures |
| `docs/UPDATES.md` | Signed updates, approval, emergency path |
| `docs/ACCEPTANCE.md` | Requirements against evidence |
| `docs/CAVEATS.md` | Every known limitation and its status |

## Layout
`apps/server` API, rules, backups, updater events · `apps/web` the app · `apps/mock-ha` development stand-in for HA · `deploy/` compose, Caddy, egress proxy, host updater, release tooling.
