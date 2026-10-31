# What works when something is down

| | Internet down | Hub (HA) down | App down or updating | One device offline | Power cut and restart |
|---|---|---|---|---|---|
| Control devices from the app (on the home network) | ✅ | ❌ shown as "Home hub unreachable"; last known state, commands refused | ❌ | ✅ other devices; that one says "Offline" | ✅ after both start |
| Control the app from outside the home | ❌ | ❌ | ❌ | ✅ | ✅ after start |
| Sign in with a passkey | ✅ (local) | ✅ | ❌ | ✅ | ✅ |
| Automations and routines run | ✅ (HA runs them) | ❌ (HA is the engine) | ✅ (HA is up) | ✅ the others | ✅ after HA starts |
| Scenes, modes | ✅ | ❌ | ✅ (via HA) | ✅ | ✅ |
| Alerts in the app | ✅ (existing ones) | ✅ + "hub unreachable" after 2 min | ❌ | ✅ + "offline" after 5 min | ✅ |
| Push notifications | ❌ | ✅ | ❌ | ✅ | ✅ |
| Voice (Alexa, Google) | ❌ | ❌ | ✅ (runs in HA) | ✅ | ✅ |
| Backups | ✅ to local, USB and NAS | ✅ (the app's own data) | ❌ | ✅ | resumes (catches up if >23 h) |
| Update check | ❌ (retries hourly) | ✅ | ❌ | ✅ | ✅ |
| Offline bundle update (USB) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Energy and insights | ✅ (sampling continues) | pauses (gaps stay gaps) | pauses | that device has gaps | pauses |
| Support access | ❌ | ❌ | ❌ | ✅ | ✅ |

Notes
- **HTTPS certificate:** Caddy renews its certificate over the internet. A long outage (months) can let it expire; browsers will warn until the internet returns.
- **After an app restart:** sessions persist (database). Rate-limit counters and "has the problem lasted long enough" timers restart.
- **After a hub restart:** the app reconnects by itself (backoff 1 to 30 s), reloads all states, clears the banner and says "Home hub is back" if it had raised the alert. Verified against a real HA restart (`real-ha.test.ts`).
- **A wrong access key** is reported as such ("the hub refused the app's access key"), not as an outage.
