# WebRTC connectivity tests (real browsers)

Two Chromium peers, real ICE, a real Coturn relay. These tests check the
P2P-first / TURN-fallback / recovery behaviour of `@purplecallio/sdk` and of
the hosted `/call` page.

```sh
brew install coturn                 # or any `turnserver` on PATH (TURNSERVER_BIN)
npx playwright install chromium     # once
PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core/index.mjs \
  node scripts/webrtc-e2e/run.mjs            # SDK scenarios (~2.5 min)
  node scripts/webrtc-e2e/run.mjs --hosted   # + hosted page via its own `next dev` (~5 min)
ONLY=S1,H3 node scripts/webrtc-e2e/run.mjs --hosted   # a subset
```

`stack.mjs` provides:
- a stand-in gateway that mirrors `CallGateway`'s event contract, including
  the rule that signaling from sockets outside the call room is dropped;
- the REST endpoints the clients call;
- Coturn, which the tests can stop and restart mid-call.

The stand-in has no auth, billing or database. The NestJS server's own tests
cover those.

| # | Scenario | How it is simulated |
|---|----------|---------------------|
| S1 / H1 | Direct P2P works | Default config (STUN + TURN, policy `all`). Expect host/srflx pairs on both sides and TURN unused. |
| S2 / H2 | Direct impossible, TURN works | One peer is relay-only, as if a firewall blocked every direct path. Expect the relay to be selected automatically. |
| S3 / H3 | Path lost mid-call, then back | Media is relayed and Coturn is killed for ~4 s, then restarted. Expect an ICE restart on the same RTCPeerConnection and media resuming. |
| S3b / H3b | Signaling socket drops | The server closes the transport. Expect the client to reconnect and re-join the room, with no ICE restart and no interruption to media. |
| S4 / H4 | Neither direct nor TURN possible | A relay-only peer plus TURN rejecting its credentials. Expect a clear failure within setup (15 s) + recovery (35 s). |
| S5 | Audio-only call | No video sender. |

## What this does not prove

Everything runs on one machine, so "direct" means host candidates on the LAN
interface. These tests validate the application's ICE configuration,
signaling, TURN fallback and recovery logic. They do **not** validate NAT
traversal on real networks. Validate the following manually, using the admin
health screen (P2P %, TURN %, setup p50/p95, failure reasons) or
`chrome://webrtc-internals` (selected candidate pair):

1. Same LAN: expect P2P (host).
2. Different networks, typical home NAT: expect P2P (srflx).
3. Home Wi-Fi to mobile data (CGNAT): often P2P, sometimes TURN.
4. Symmetric NAT or a restrictive corporate network: expect TURN.
5. UDP blocked: expect TURN over TLS on 5349. If only 443 is open, this
   fails today; it needs `turns:` on 443 on a separate IP or SNI-routed
   (see the deployment notes).
6. IPv6-only peers: direct over IPv6 is possible. The relay is IPv4-only
   (`--external-ip` is IPv4).
7. A network switch mid-call (Wi-Fi to LTE): expect an ICE restart, then a
   reconnect.
8. TURN down: direct calls are unaffected. Calls that need the relay fail
   with "Unable to connect".
