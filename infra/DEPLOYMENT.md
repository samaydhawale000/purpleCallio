# PurpleCallio production deployment

The domain is configured in **one place**: `PUBLIC_HOST` in `infra/.env`.
Today that's the temporary host `purplecallio.serveminecraft.net` (DNS A
record → the OCI instance); the final domain will be `purplecallio.com` (see
[Final domain migration](#final-domain-migration)). Everything else derives
from `PUBLIC_HOST`:

| Derived value | From |
|---|---|
| Nginx `server_name` and TLS certificate paths | `infra/nginx/templates/api.conf.template`, rendered at container start |
| `FRONTEND_URL`, `APP_URL` | `https://$PUBLIC_HOST` |
| `NEXT_PUBLIC_API_URL` | `https://$PUBLIC_HOST/api` (baked into the web build) |
| `NEXT_PUBLIC_SITE_URL` | `https://$PUBLIC_HOST`: canonical URLs, sitemap, robots, JSON-LD, legal pages, docs samples |
| `TURN_HOST` and the Coturn certificate path | `$PUBLIC_HOST` |

Each derived value can still be set explicitly as an override.
`docker compose` refuses to start if `PUBLIC_HOST` is unset. The temporary
host still appears in the repo only as the value in `.env.example` and as
test data.

## Topology and routes

One HTTPS host, Nginx in front (`infra/nginx/templates/api.conf.template`):

| Path | Goes to | Notes |
|---|---|---|
| `/` | `web:5173` (Next.js) | hosted UI, dashboard, docs |
| `/api/` | `server:3005/` | REST; `/api/turn/credentials` → `GET /turn/credentials` |
| `/api/auth/`, `/api/playground/` | `server:3005` | stricter Nginx `limit_req` zones |
| `/socket.io/` | `server:3005` | WebSocket upgrade preserved (`Upgrade`/`Connection`), 24 h read timeout |
| `:80` | 301 → HTTPS | |
| Coturn | host network: `3478` UDP/TCP, `5349` TLS, `49152–65535` UDP relay | |

Clients use **one base URL**, `https://<host>/api`, for REST. Socket.IO
connects to the same host **without** `/api`. The hosted web app, the JS SDK
(`apiUrl` + `signalUrl`) and the native SDKs all follow this rule.

## Environment

`infra/.env` is gitignored and excluded from Docker build contexts (root
`.dockerignore`). Start from `infra/.env.example` and validate before every
deploy. The checker prints key names only, never values:

```sh
node infra/scripts/check-env.mjs infra/.env
docker compose -f infra/docker-compose.yml --env-file infra/.env config --quiet
```

The checker verifies:
- `PUBLIC_HOST` is set and is a bare DNS name (no scheme, port or IP).
- All URLs (after applying the same defaults as Compose) are HTTPS on `PUBLIC_HOST`.
- `NEXT_PUBLIC_API_URL` = origin + `/api`.
- No leftover `bluecallio` host and no raw-IP URLs.
- `TURN_HOST` is a DNS name and `TURN_EXTERNAL_IP` is IPv4.
- The certificate path matches `TURN_HOST`.
- The public client IDs resolve, secrets aren't placeholders, and no secret is routed into a `NEXT_PUBLIC_*` variable.

`NEXT_PUBLIC_GOOGLE_CLIENT_ID` and `NEXT_PUBLIC_RAZORPAY_KEY_ID` default to
`GOOGLE_CLIENT_ID` / `RAZORPAY_KEY_ID`. Both are public identifiers designed
to be sent to browsers, and both integrations are live: the server refuses
to start in production without Razorpay keys, and the web app has Google
sign-in. Secrets (`*_SECRET`) are never mapped into `NEXT_PUBLIC_*`.

## TURN

### Hostname vs IP

| Variable | Used for |
|---|---|
| `TURN_HOST` | The name clients dial in `turn:<host>:3478` and `turns:<host>:5349`. Defaults to `PUBLIC_HOST`, so it shares the certificate Nginx uses. **Must be covered by Coturn's TLS certificate** (`/etc/letsencrypt/live/<TURN_HOST>/`). |
| `TURN_EXTERNAL_IP` | Coturn `--external-ip`, the public IPv4 address in relay candidates. |
| `TURN_SERVER` | Legacy. The server uses it if `TURN_HOST` is unset, and Coturn uses it if `TURN_EXTERNAL_IP` is unset. |

If the TURN host is an IP literal, the server **does not advertise
`turns:`**, because a certificate issued for a hostname can't validate it.
It logs a warning, and plain `turn:3478` still works.

### Credential endpoint (`GET /api/turn/credentials`)

Every request passes `CallSessionGuard`:

| Request | Result |
|---|---|
| No bearer token | 401 |
| Unknown token | 401 |
| Token for another call | 401 |
| Expired participant token | 401 |
| Terminal customer call | 410 `CALL_ENDED` |
| Expired, terminal or kill-switched Playground call | 410 `PLAYGROUND_CALL_EXPIRED` |

A token is scoped to a single call, so it can't be used to obtain
credentials for a different call.

Rate limits:
- Global Nest throttler: 100 requests/min.
- 10/min on this route.
- Nginx `api` zone: 100 r/min.
- Playground only: `PLAYGROUND_TURN_CALLS_PER_MINUTE` (default 3) per call + IP, enforced in the database. Over the limit returns 429 `TURN_RATE_LIMITED`.

Credentials are Coturn REST (`use-auth-secret`) HMAC credentials:
- **Customer:** TTL `TURN_CREDENTIAL_TTL_SECONDS`, default 24 h. Coturn rechecks the credential on allocation refresh, and browsers can't swap credentials on a live allocation, so a TTL shorter than a call would cut relayed media mid-call. The long TTL is deliberate.
- **Playground:** `PLAYGROUND_TURN_CREDENTIAL_TTL_SECONDS` (default 60 s), and never later than the call's `expiresAt`.

The shared secret never leaves the server. Tests cover this.

### Limits and isolation (what exists and what doesn't)

Coturn limits are **global**, shared by customer and Playground traffic:
- `--total-quota` (`TURN_TOTAL_QUOTA`, default 64 allocations).
- `--max-bps` per session (`TURN_MAX_BPS`, default 4 Mbps).
- `--bps-capacity` total (`TURN_BPS_CAPACITY`, default 8 Mbps).

8 Mbps total covers only a few relayed HD calls, so tune it after measuring
the OCI network.

Application-level Playground protection, all enforced server-side:
- A kill switch.
- The 60 s cap.
- An idle timeout.
- 2 participants per call.
- 1 active call per IP and per identity.
- Creation rate limit, daily limit, and global active-call limit.
- A 180 s participant-token TTL, capped at the call's expiry.
- The TURN credential rate limit and TTL above.
- A cleanup sweep every second.

**Not possible with the current architecture:** Coturn has one realm and one
shared secret, so it can't tell a Playground allocation from a customer one.
It therefore can't reserve capacity for customers or cap Playground's share
of `total-quota`/`bps-capacity`. The application limits bound how much
Playground can consume: 5 concurrent calls by default, 3 credential fetches
per call per minute, and short-lived credentials. They don't *isolate* it.
True isolation needs one of these:
- A separate Coturn instance (or port set) for Playground, with its own secret and quotas.
- Coturn with a database-backed configuration and a separate realm and secret per tier, each with its own quotas.

The server would then issue Playground credentials for that pool.

## Playground at 60 seconds

Within about 1 s of `expiresAt` (the sweep runs every second):
1. The call becomes `ENDED` and a `CALL_EXPIRED` event is recorded.
2. The call's participant session (both tokens) is deleted, so reusing a token returns 401 everywhere.
3. `call.expired` is broadcast to the room, and every participant socket is force-disconnected.
4. After that, everything is rejected: new sockets and re-authentication, room joins (including a `join-call` racing with the expiry, because it re-checks the database after joining), REST operations, and new or refreshed TURN credentials.
5. Any TURN credentials already issued expire by `expiresAt`, and Coturn refuses allocations and refreshes after that.

**Limitation (architectural, not a bug):** once two browsers have an
established **direct P2P** WebRTC connection, media flows between them
without touching PurpleCallio. The server can't cut it. A browser that
ignores `call.expired` (a modified client) can keep a direct media stream
going after 60 s. Relayed media stops when its TURN allocation can no longer
be refreshed. So the 60 s limit is enforced on everything the server controls:
signaling, tokens, rooms, TURN credentials and billing state. It is **not** a
guaranteed network-level media cutoff. Enforcing that would need an SFU or
media server, which is out of scope by design.

## Docker

- The root `.dockerignore` keeps every `.env*` (except `.env.example`), `.git`, `node_modules`, build output, `mobile/` and `infra/` out of the build context.
- **Health checks** are on `server` (`GET /`) and `web` (`GET /robots.txt`). They are observability only: Compose's `restart: unless-stopped` doesn't restart unhealthy containers.
  - **Not health-checked:** `nginx`, because port 80 only redirects to the public HTTPS host. Check it from outside with `curl -I https://<host>/`.
  - **Not health-checked:** `coturn`, which uses host networking and has no HTTP endpoint. Check it with `turnutils_uclient`, below.
- **Resource limits** are deliberately not set. No production load measurements exist yet, and a memory cap that is too low would OOM-kill the signaling server mid-call. After load testing, set `deploy.resources.limits` from observed peaks plus headroom, starting with `web` (Next.js SSR) and `server`.
- **Image tags:**
  - Coturn is pinned (`4.18.0-r0`, overridable with `COTURN_IMAGE`).
  - `postgres:16-alpine` and the `node:20-*` base images are pinned to a major version.
  - `nginx:alpine` floats. Pin it (for example `nginx:1.27-alpine`) only after confirming which version production currently runs, so the pin isn't a surprise downgrade.

## Manual validation (not verifiable from the repository)

Run these against the live host:
1. `node infra/scripts/check-env.mjs infra/.env` on the OCI host passes.
2. `curl -I https://$PUBLIC_HOST/` returns 200 with HSTS, and `curl https://$PUBLIC_HOST/api/turn/credentials` returns 401.
3. TLS on `5349` presents a certificate for `TURN_HOST`: `openssl s_client -connect $PUBLIC_HOST:5349 -servername $PUBLIC_HOST`.
4. TURN relay works with a real credential. Fetch it with a participant token, then run `turnutils_uclient -u <username> -w <credential> -p 3478 $PUBLIC_HOST`, and repeat over TLS/5349.
5. The OCI security list and host firewall allow 3478/UDP+TCP, 5349/TCP (and UDP if used), and 49152–65535/UDP.
6. Browser A ↔ Browser B on **different networks**: in `chrome://webrtc-internals`, confirm a `relay` candidate pair gets selected when direct connectivity is blocked. Test microphone, camera, speaker, autoplay, mute, camera toggle, screen share and hang-up.
7. Playground: a call ends at 60 s on both sides, a reused token gets 401, and a TURN credential request after expiry gets 410.
8. Google sign-in and Razorpay checkout work on the production build.

## Final domain migration

Moving to `https://purplecallio.com`:

1. **DNS:** `A` (and `AAAA` if used) for `purplecallio.com` → the OCI IP.
2. **TLS:** `certbot certonly --standalone -d purplecallio.com` (stop Nginx first, or use the webroot plugin). Nginx and Coturn both read `/etc/letsencrypt/live/purplecallio.com/`.
3. **`infra/.env`:** `PUBLIC_HOST=purplecallio.com`. That's the only edit, unless you'd set overrides; `check-env.mjs` flags any override left on the old host.
4. **Validate:** `node infra/scripts/check-env.mjs infra/.env` and `docker compose ... config --quiet`.
5. **Deploy:** `docker compose up -d --build`. The `web` rebuild matters because `NEXT_PUBLIC_*` values are baked in at build time.
6. **Outside the repo:**
   - Google OAuth: add `https://purplecallio.com` to Authorized JavaScript origins and redirect URIs.
   - Razorpay: update the webhook URL (`https://purplecallio.com/api/...`) and allowed domains.
   - Customers: tell integrators their `apiUrl`/`baseUrl` becomes `https://purplecallio.com/api`. No SDK has a built-in default host.
7. **Old host:** keep `purplecallio.serveminecraft.net` redirecting to the new domain (a second Nginx server block with its own certificate) until clients have moved.

Nothing in the code needs editing. The remaining `purplecallio.com` strings in the repo are fixed brand metadata that already point at the final domain: package `homepage` fields, the Maven POM, `pubspec.yaml`, README brand links, Coturn's `realm` label, and the web app's local-build fallback for `NEXT_PUBLIC_SITE_URL`.
