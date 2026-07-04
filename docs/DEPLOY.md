# Deploy — whileaway (hosted)

Production runs on Fly.io at **https://whileaway.honestapp.org** (app `whileaway`, region `iad`).
Config lives in `server/fly.toml` + `server/Dockerfile`.

## Architecture

- Single always-on machine (`min_machines_running = 1`, `auto_stop_machines = "off"`) — the feed must answer instantly.
- Persistent volume `whileaway_data` at `/data` holds both SQLite databases:
  - `WHILEAWAY_STATE=/data/whileaway.db` — the store (owners, lanes, cards, delivery, metrics).
  - `WHILEAWAY_AUTH_DB=/data/whileaway-auth.db` — Better Auth (users, sessions).
- `AUTH_MODE=hosted`: bearer-token identity for producers/consumers; magic-link sessions for the dashboard.
- Better Auth migrates at container start (the Docker `CMD` runs `auth:migrate` before boot, since Fly release VMs don't mount the volume). The migration is idempotent.
- `[deploy] strategy = "immediate"`: one volume can't attach to two machines, so deploys replace in place.

## Secrets

Fly secrets are write-only. Set with `fly secrets set NAME=value --app whileaway` (auto-restarts the machine).

| secret | purpose |
|--------|---------|
| `WHILEAWAY_AUTH_SECRET` | signs Better Auth sessions — required in hosted mode |
| `WHILEAWAY_KEY` | boot publisher key used by the reference pushers |
| `WHILEAWAY_METRICS_TOKEN` | bearer required for `GET /v1/metrics` |
| `WHILEAWAY_RESEND_KEY` | Resend API key for magic-link email |
| `WHILEAWAY_EMAIL_FROM` | sender, e.g. `whileaway <hello@whileaway.honestapp.org>` (domain must be Resend-verified) |
| `WHILEAWAY_GOOGLE_CLIENT_ID` / `WHILEAWAY_GOOGLE_CLIENT_SECRET` | optional — enables Google sign-in |

## Setup

```sh
cd server
fly apps create whileaway --org personal
fly volumes create whileaway_data --size 1 --region iad --app whileaway -y
fly secrets set \
  WHILEAWAY_AUTH_SECRET=$(openssl rand -hex 32) \
  WHILEAWAY_KEY=$(openssl rand -hex 18) \
  WHILEAWAY_METRICS_TOKEN=$(openssl rand -hex 24) \
  --app whileaway
```

Custom domain: `fly certs add <domain> --app whileaway`, add the printed A/AAAA records (DNS-only if the domain is behind Cloudflare), then set `WHILEAWAY_URL` (`fly.toml`) and the extension's prod base (`extension/src/config.js`) to match.

## Deploy

```sh
cd server && fly deploy --app whileaway --ha=false
```

The image installs `python3 make g++` (better-sqlite3 compiles from source), migrates the auth schema, then boots.

## Email

Magic links send via Resend when `WHILEAWAY_RESEND_KEY` is set, from `WHILEAWAY_EMAIL_FROM` (its domain must be verified in Resend). Success logs `emailed magic link … via Resend (id …)`. Without the key, links print to `fly logs` — the fallback path, and the default for self-host.

## Metrics

`GET /v1/metrics` — ops token required in hosted mode, open in self-host. Headline `seenRate = seenCards / deliveredCards`, counted per distinct `(user, card)`. Also reports `signups`, `tokensMinted`, `pushes`, `deliveries`, `activatedUsers`, `seenUsers`, and gauges `owners` / `liveTokens` / `lanes` / `cards`.

## Verify

```sh
curl -s https://whileaway.honestapp.org/health                          # {"ok":true}
curl -s -H "Authorization: Bearer $WHILEAWAY_METRICS_TOKEN" \
     https://whileaway.honestapp.org/v1/metrics                         # seen-rate + funnel
```

## Self-host

`AUTH_MODE=none` (default): header identity (`X-Whileaway-User`), a boot publisher key printed to the console, JSON-file storage (`WHILEAWAY_STORE=json`). Run `npm start` in `server/`.
