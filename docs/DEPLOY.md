# Deploy runbook — whileaway bus (hosted)

The hosted instance runs on Fly.io. Live: **https://whileaway-bus.fly.dev**
(app `whileaway-bus`, region `iad`). Config lives in `server/fly.toml` + `server/Dockerfile`.

## Architecture on Fly

- **One always-on machine** (`min_machines_running = 1`, `auto_stop_machines = "off"`).
  Cold starts would break the product — the feed must answer instantly.
- **Persistent volume** `whileaway_data` mounted at `/data`, holding BOTH sqlite DBs:
  - `WHILEAWAY_STATE=/data/whileaway.db` — the bus store (owners, lanes, cards, delivery, metrics).
  - `WHILEAWAY_AUTH_DB=/data/whileaway-auth.db` — Better Auth's own tables (users, sessions).
- **`AUTH_MODE=hosted`** — token-only identity for producers/consumers; magic-link sessions for the
  dashboard.
- **Migration at container start** (not a Fly `release_command`): the Docker `CMD` runs
  `npm run auth:migrate && node src/index.js`. Release VMs don't mount the app volume, so the auth
  DB must be migrated on the machine that actually has `/data`. `auth:migrate` is idempotent.
- **Deploy strategy `immediate`** (`[deploy]` in fly.toml): a single volume can't be mounted by a
  second machine during a rolling deploy, so we replace in place (brief downtime, fine at v0).

## One-time setup (already done for whileaway-bus)

```sh
cd server
fly apps create whileaway-bus --org personal
fly volumes create whileaway_data --size 1 --region iad --app whileaway-bus -y
fly secrets set WHILEAWAY_AUTH_SECRET="$(openssl rand -hex 32)" --app whileaway-bus
fly secrets set WHILEAWAY_KEY="$(openssl rand -hex 18)" --app whileaway-bus
fly secrets set WHILEAWAY_METRICS_TOKEN="$(openssl rand -hex 24)" --app whileaway-bus
```

Secrets (write-only — Fly can't read them back; record the metrics token where you can find it):
- `WHILEAWAY_AUTH_SECRET` — signs Better Auth sessions. **Required** in hosted mode (boot fails without it).
- `WHILEAWAY_KEY` — stable boot publisher key (used by the in-process reference pushers).
- `WHILEAWAY_METRICS_TOKEN` — bearer required to read `GET /v1/metrics` in hosted mode.
- `WHILEAWAY_GOOGLE_CLIENT_ID` / `WHILEAWAY_GOOGLE_CLIENT_SECRET` — optional; enable Google sign-in
  when set (see "Pending" below).

## Deploy

```sh
cd server
fly deploy --app whileaway-bus --ha=false
```

The build compiles `better-sqlite3` from source (the Dockerfile installs `python3 make g++` for
node-gyp), migrates the auth schema, then boots.

## Verify

```sh
curl -s https://whileaway-bus.fly.dev/health            # {"ok":true}
curl -s https://whileaway-bus.fly.dev/privacy -o /dev/null -w "%{http_code}\n"   # 200
curl -s -H "Authorization: Bearer $WHILEAWAY_METRICS_TOKEN" \
     https://whileaway-bus.fly.dev/v1/metrics            # seen-rate + funnel
fly logs --app whileaway-bus                             # boot + magic-link lines
```

Full signup→seen E2E: POST `/api/auth/sign-in/magic-link` with an email, read the verify URL from
`fly logs` (until an email transport is configured), GET it with a cookie jar to set the session,
then `POST /v1/tokens` → `POST /v1/lanes/personal/cards` → `GET /v1/feed/next` → `POST /v1/feed/seen`.

## Metrics (the launch number)

`GET /v1/metrics` (ops token in hosted; open in self-host). Headline is **`seenRate`** —
`seenCards / deliveredCards`, counted per distinct (user, card) so re-surfaced must_see/recurring
cards aren't double-counted. Also: `signups`, `tokensMinted`, `pushes`, `deliveries` (impressions),
`activatedUsers`, `seenUsers`, and current gauges (`owners`, `liveTokens`, `lanes`, `cards`).

## Pending (human-assisted)

- **Email transport for public signup.** Magic links currently only print to the server log
  (`sendMagicLink` in `server/src/auth.js`). Real users can't sign up until an email provider
  (e.g. Resend) is wired. Until then, signup works only by reading the link from `fly logs`.
- **Custom production domain.** Currently on `whileaway-bus.fly.dev`. To add one:
  `fly certs add <domain>`, point DNS, then update `WHILEAWAY_URL` + the extension's default base.
- **Google OAuth** (optional): set the two `WHILEAWAY_GOOGLE_*` secrets to enable the Google button.

## Self-host (no Fly, no accounts)

`AUTH_MODE` defaults to `none`: header identity (`X-Whileaway-User`), a boot publisher key printed
to the console, JSON-file storage (`WHILEAWAY_STORE=json`, the default). `npm start` in `server/`.
