# Playground security operations

The public Playground creates database records explicitly marked `PLAYGROUND`. Customer calls keep `source = CUSTOMER` (the database default), have no Playground expiry, retain the existing TURN lifetime, and continue through normal usage billing.

## Controls and defaults

| Setting | Default | Purpose |
| --- | ---: | --- |
| `PLAYGROUND_ENABLED` | `true` | Set `false` to reject new Playground calls and end active Playground call sessions |
| `PLAYGROUND_CALL_DURATION_SECONDS` | `60` | Hard call lifetime from creation |
| `PLAYGROUND_IDLE_TIMEOUT_SECONDS` | `30` | End a call that has no participant join event |
| `PLAYGROUND_MAX_PARTICIPANTS` | `2` | Socket room participant ceiling |
| `PLAYGROUND_MAX_ACTIVE_CALLS_PER_IP` | `1` | Simultaneous calls per hashed client IP |
| `PLAYGROUND_MAX_ACTIVE_CALLS_PER_IDENTITY` | `1` | Simultaneous calls per account |
| `PLAYGROUND_CALL_RATE_LIMIT_MAX` | `5` | Creations per IP rolling window |
| `PLAYGROUND_CALL_RATE_LIMIT_WINDOW_SECONDS` | `600` | Rolling creation window |
| `PLAYGROUND_DAILY_CALL_LIMIT` | `20` | Creations per IP in a rolling day |
| `PLAYGROUND_MAX_ACTIVE_CALLS_GLOBAL` | `5` | Conservative initial global active-call circuit breaker pending staging capacity measurements |
| `PLAYGROUND_PARTICIPANT_TOKEN_TTL_SECONDS` | `180` | Upper bound for Playground session token lifetime (call expiry can shorten it) |
| `PLAYGROUND_TURN_CREDENTIAL_TTL_SECONDS` | `60` | TURN long-term credential lifetime |
| `PLAYGROUND_TURN_CALLS_PER_MINUTE` | `3` | TURN credential requests per call and IP/minute |
| `SOCKET_AUTH_ATTEMPTS_PER_MINUTE` | `20` | New Socket.IO connections per IP/minute/process |
| `SOCKET_MAX_UNAUTHENTICATED_CONNECTIONS` | `100` | Global unauthenticated Socket.IO connection ceiling per API process |
| `PLAYGROUND_SOCKET_EVENTS_PER_MINUTE` | `120` | Playground signaling/media events per authenticated socket/minute |

Set these in the deployment environment consumed by `infra/docker-compose.yml`. For an incident, set `PLAYGROUND_ENABLED=false` and recreate the API container (`docker compose -f infra/docker-compose.yml up -d --force-recreate server`). The worker ends active Playground sessions within one second and request/socket authorization denies them immediately; customer calls remain available.

## Enforcement

The creation route requires the existing authenticated account JWT. PostgreSQL advisory transaction locks serialize identity/IP/global checks across API workers. IP values are HMACed with `JWT_ACCESS_SECRET`; raw addresses are not persisted in Playground attempt rows. Creation attempts are retained for 24 hours and then deleted. An active Playground call has a persisted `expiresAt`, `maxParticipants`, creator identity, and `source`; every session-authenticated HTTP request and every socket signal checks the call token/call binding and expiry. A one-second database sweep ends expired and idle calls and removes their session rows; the expiry timestamp check is immediate and does not depend on sweep timing. Calls ending through the Playground path do not create customer usage/billing records.

TURN credential issuance is session-authenticated, limited to 10 requests/minute by NestJS and 3 requests/minute per Playground call/IP using database state, with a maximum 60-second HMAC credential lifetime for Playground sessions. Nginx has distinct request zones for general API traffic, auth routes and Playground creation, plus TLS security headers and a camera/microphone-compatible Permissions-Policy. HTTP API and Socket.IO CORS reflect dynamic customer origins; both disable cross-origin cookie credentials. Protected actions use scoped bearer credentials and server-side authorization.

API keys are SHA-256 hashed at rest and shown only when created. Key creation, per-project key listing, update, and revocation require the authenticated user to own the project or key; API call lookup is scoped to the project resolved from the presented key. Revocation deactivates/deletes the matching stored key, so subsequent API authentication fails.

## Deployment and architecture assumptions

- This repository has PostgreSQL but no Redis. Call quota, global capacity, and TTL state use PostgreSQL. Socket connection-attempt counters and Socket.IO room membership are process-local. The repository has no distributed Socket.IO adapter; do not deploy multiple API replicas for calls without shared room/session transport, distributed rate limits, and coordinated call expiry/cleanup.
- Existing NestJS throttler counters are also process-local. Playground creation and TURN quotas added here are database-backed; general HTTP throttling is not distributed.
- `PLAYGROUND_ENABLED` is an environment kill switch and requires API container recreation; there is no runtime admin setting.
- Coturn uses `use-auth-secret`, a Docker-injected shared secret, `stale-nonce=600`, `no-loopback-peers`, `no-multicast-peers`, relay ports 49152–65535, a global allocation quota, and configurable per-allocation/aggregate bandwidth ceilings. Compose pins `coturn/coturn:4.18.0-r0` and mounts the matching production TLS certificate/key. The daemon was not accessible during this audit, so the configured image, certificate readability, and effective runtime limits remain unverified. Credentials expiring stops new authenticated allocations but does not immediately revoke an allocation already established; Coturn's default maximum allocation lifetime is 3600 seconds. TURN UDP/TCP/TLS media paths are not protected by HTTP/Nginx limits.
- The existing WebRTC path permits peer-to-peer media. Server-side expiry closes signaling and asks the UI to close its peer connection, but a hostile modified browser can keep a previously established direct peer-to-peer media connection alive. A strict server-enforced media cutoff needs server-mediated media (SFU/relay control) and TURN allocation termination designed for Playground; this repository has no such media control plane.
- No WAF, edge DDoS service, OCI host monitoring, TURN allocation metrics, or alert provider is configured here. Those need operational setup. Nginx HTTP limits do not cover UDP TURN media.
- The CSP is intentionally not newly restricted: Google auth, Next.js assets, Socket.IO and WebRTC need a validated policy. HSTS is enabled at the production HTTPS virtual host. Nginx now names `<PUBLIC_HOST>`; its DNS and Let's Encrypt certificate files must exist on the deployment host before reloading Nginx.
- Participant session token storage remains plaintext in the existing `CallSession` schema. Tokens are 32-byte random values and Playground validity is bounded by call expiry, but a stolen token can replace that participant's live socket before expiry. Reconnect support means authorization is call-scoped rather than one-time.

## Monitoring and response

Nest logs Playground creation, disabled/capacity/rate-limit rejection, and expiration with call/account identifiers and only a truncated keyed IP digest. Admin monitoring now includes active Playground calls, all/Playground calls created in the last minute, Playground expirations today, socket client/in-call/room counts, and process-local socket auth failures. It does not provide persistent HTTP 429/401/5xx metrics, TURN allocations, or alerting. Monitor application logs, Nginx 429/5xx logs, host CPU/RAM/network, PostgreSQL connections, and Coturn allocation/bandwidth metrics externally.

After changing the migration, deploy it using the normal migration job (`npx prisma migrate deploy` from `apps/server`) before restarting the API. Do not use `prisma db push` in production.

## Security audit summary

| Attempt | Result |
| --- | --- |
| Create unlimited Playground calls | Blocked by account/IP active limits, PostgreSQL serialized 5-call global capacity, rolling IP quotas, Nest throttling, and Nginx limits. Rotating IPs can evade per-IP daily quotas, but account active limit and global cap remain. |
| Signal after 60 seconds / rejoin / use TURN endpoint | Blocked by persisted expiry checks in HTTP/socket authorization and TURN issuance; sweeper ends the record and removes session state. |
| Keep established peer-to-peer media alive | **Risk remains:** no server media plane can forcibly close a modified browser's already negotiated P2P connection. A Playground-specific server media path is needed for a true media cutoff. |
| Join as participant three | Blocked by the room manager's synchronous slot check and maxParticipants persisted on the call. The call-session table only issues two participant tokens. |
| Replay token / reuse token on another call | Cross-call use is rejected; expired tokens are rejected; same-token multi-tab connection replaces the earlier socket. A stolen valid token can take over its participant slot until call expiry. |
| Flood TURN credentials | Session guard, 10/minute Nest per-IP limit, and 3/minute/call/IP PostgreSQL quota; credentials expire no later than call expiry. Existing TURN allocations are not instantly revoked. |
| Create unauthenticated or arbitrary-room sockets | Dynamic origin acceptance plus token authentication, 20 new connections/minute/IP and 10-second auth timeout, 100 unauthenticated socket ceiling per process; room joins require matching authenticated call token. Distributed/rotating-IP floods still need edge protection. |
| Reconnect indefinitely / keep empty calls | Session expiry and active-state checks deny rejoin; last participant disconnect ends the Playground call, with a 30-second idle sweep as fallback. |
| Bypass frontend controls with direct API calls | Backend JWT/session authorization, call ownership checks, explicit source and database quotas enforce the same restrictions. |
| Disable Playground as attacker | No public control endpoint exists; only deployment environment config disables creation. |
| Create/list API keys for another project | Blocked by ownership checks against the authenticated user on create/list/update/revoke; API-key call reads remain project-scoped. |
| Affect paying calls / billing | Playground status, quotas, expiry and end handling are source-specific; Playground does not write customer usage. Shared API/DB/host and Coturn remain shared infrastructure, so DDoS/resource exhaustion is not fully isolated. |
| Exhaust DB/memory or TURN bandwidth | Bounded active Playground count, creation quotas, attempt cleanup and socket limits reduce load. **Risk remains:** distributed HTTP floods, shared PostgreSQL connection pressure, process-local socket controls and uncapped Coturn bandwidth require WAF/network/host limits and staging capacity measurements. |

Automated tests cover expiry cleanup, idle cleanup query, token expiry/call binding, 2-slot room admission, creation quota/global capacity/kill switch, and TURN TTL/quota. Staging load and live WebRTC/TURN validation remain deployment checks; no production load test was run.

## Deployment verification checklist

The audit environment had no accessible Docker daemon and could not resolve the production hostname. On the OCI host, before rollout:

1. Confirm DNS points `PUBLIC_HOST` (from `infra/.env`) to the intended VM and install the matching certificate/key at `/etc/letsencrypt/live/<PUBLIC_HOST>/{fullchain.pem,privkey.pem}`.
2. `TURN_HOST` defaults to `PUBLIC_HOST`; override it only with another DNS name covered by a certificate. Set `COTURN_IMAGE` only if pinning a different exact tested release; do not use `latest`.
3. Allow inbound TCP/UDP 3478, TCP 5349, and UDP 49152–65535 in OCI security lists/NSGs and the host firewall. Coturn is host-networked; Nginx and HTTP WAF limits do not protect those ports.
4. Run `docker compose -f infra/docker-compose.yml config --quiet`, `docker compose -f infra/docker-compose.yml up -d coturn nginx`, `docker compose -f infra/docker-compose.yml exec coturn turnserver --version`, `docker compose -f infra/docker-compose.yml exec coturn sh -c 'test -r /etc/letsencrypt/live/<PUBLIC_HOST>/fullchain.pem && test -r /etc/letsencrypt/live/<PUBLIC_HOST>/privkey.pem'`, and `docker compose -f infra/docker-compose.yml exec nginx nginx -t`.
5. Check `curl -sS -o /dev/null -w '%{http_code} %{ssl_verify_result} %{redirect_url}\n' https://<PUBLIC_HOST>/`. For API/Socket.IO, use an authorized staging client and avoid including tokens in command-line arguments or logs.
6. Validate TURN allocation from two devices on separate networks and inspect browser WebRTC internals for a selected `relay` candidate pair with media flowing. A successful credentials response alone is not TURN validation.
