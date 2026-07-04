# Pre-launch checklist

Run against the target instance before shipping.

## Onboarding (< 5 min)

Sign up → mint token → push a card → `GET /v1/feed/next` → `POST /v1/feed/seen`, end to end.
Starter lanes deliver a card with zero producer setup.

## Recipes

`cd mcp && npm test` — all ten `docs/EXAMPLES.md` recipes reproduce against a clean instance.

## Abuse / limits

| check | expected |
|-------|----------|
| > 60 pushes/min on one token | `429` |
| payload > 256 KB | `413` |
| push to a lane owned by someone else | `404` (refs resolve within your own namespace) |
| push to your own lane | `200` |

## Endpoints

- `/health` → `200`
- `/v1/metrics` → requires the ops token in hosted mode (`401` otherwise)
- `/v1/feed/next` → requires a valid bearer in hosted mode (`401` otherwise)
- `/v1/lanes/:id/feed.xml` → valid Atom for a public lane; bearer with `read:feed` for private/unlisted

## Tests

```sh
cd server && npm test && npm run test:sqlite   # 44 + 44
cd mcp && npm test                             # 25
```
