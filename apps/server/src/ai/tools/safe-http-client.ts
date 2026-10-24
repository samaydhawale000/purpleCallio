import { Injectable } from '@nestjs/common';
import { promises as dns } from 'dns';
import * as http from 'http';
import * as https from 'https';
import { BlockList, isIP, LookupFunction } from 'net';

import { aiToolsAllowInsecureLocalhost } from '../ai.config';

/**
 * Stable failure codes. Remote error text (DNS, TLS, socket) is never kept,
 * so nothing from the customer's server or the network leaks to clients.
 */
export type SafeHttpErrorCode =
  | 'INVALID_URL'
  | 'BLOCKED_URL'
  | 'DNS_FAILED'
  | 'BLOCKED_ADDRESS'
  | 'TIMEOUT'
  | 'REDIRECT_REFUSED'
  | 'HTTP_ERROR'
  | 'RESPONSE_TOO_LARGE'
  | 'NOT_JSON'
  | 'NETWORK_ERROR';

export class SafeHttpError extends Error {
  constructor(
    public readonly code: SafeHttpErrorCode,
    /** Set for HTTP_ERROR / NOT_JSON when a response arrived. */
    public readonly httpStatus?: number,
    /** Raw response text (already size-capped), for the dashboard test only. */
    public readonly raw?: string,
  ) {
    super(code);
    this.name = 'SafeHttpError';
  }
}

export interface SafeHttpRequest {
  url: string;
  method: 'GET' | 'POST';
  /** JSON text. POST sends it as the body; GET as the `payload` query param. */
  body: string;
  headers: Record<string, string>;
  timeoutMs: number;
  maxResponseBytes: number;
}

export interface SafeHttpResponse {
  status: number;
  json: unknown;
  raw: string;
}

export interface ResolvedAddress {
  address: string;
  family: number;
}

export type HostResolver = (hostname: string) => Promise<ResolvedAddress[]>;

interface Target {
  url: URL;
  host: string;
  pinned: ResolvedAddress;
  insecure: boolean;
}

const LOCALHOST_NAMES = new Set(['localhost', '127.0.0.1', '::1']);
const JSON_CONTENT_TYPE = /^application\/([a-z0-9.+-]*\+)?json\s*(;|$)/i;

/** Addresses a tool endpoint may never resolve to. */
const BLOCKED = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, incl. 169.254.169.254 metadata
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
] as const) {
  BLOCKED.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 96], // unspecified, loopback, IPv4-compatible
  ['64:ff9b::', 96], // NAT64
  ['64:ff9b:1::', 48],
  ['100::', 64], // discard
  ['2001::', 32], // Teredo
  ['2001:db8::', 32],
  ['2002::', 16], // 6to4
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['fec0::', 10],
  ['ff00::', 8], // multicast
] as const) {
  BLOCKED.addSubnet(net, prefix, 'ipv6');
}
// IPv4-mapped IPv6 (::ffff:10.0.0.1) is matched by the IPv4 rules above.

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  return BLOCKED.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

function isLoopback(address: string): boolean {
  return address === '::1' || /^(::ffff:)?127\./i.test(address);
}

/**
 * Outbound HTTP for customer tool endpoints, hardened against SSRF:
 * HTTPS only, DNS resolved up front and every address checked, the socket
 * pinned to the checked address (so a second DNS answer can't rebind it),
 * no redirects, a hard timeout, a response size cap and JSON only.
 */
@Injectable()
export class SafeHttpClient {
  /** Replaceable in specs. */
  resolver: HostResolver = (hostname) =>
    dns.lookup(hostname, { all: true, verbatim: true });

  async request(req: SafeHttpRequest): Promise<SafeHttpResponse> {
    const target = await this.resolveTarget(req.url);
    return this.send(target, req);
  }

  /** Validates the URL and resolves it to one allowed, pinned address. */
  async resolveTarget(rawUrl: string): Promise<Target> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new SafeHttpError('INVALID_URL');
    }
    if (url.username || url.password) throw new SafeHttpError('BLOCKED_URL');

    const host = url.hostname.replace(/^\[(.*)\]$/, '$1').toLowerCase();
    // Dev only: http(s)://localhost, pinned to loopback, no cert checks.
    const insecure =
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      aiToolsAllowInsecureLocalhost() &&
      LOCALHOST_NAMES.has(host);
    if (url.protocol !== 'https:' && !insecure) {
      throw new SafeHttpError('BLOCKED_URL');
    }

    let addresses: ResolvedAddress[];
    if (isIP(host)) {
      addresses = [{ address: host, family: isIP(host) }];
    } else {
      try {
        addresses = await this.resolver(host);
      } catch {
        throw new SafeHttpError('DNS_FAILED');
      }
    }
    if (!addresses.length) throw new SafeHttpError('DNS_FAILED');

    // Every answer must pass, not just the one we pick.
    const allowed = insecure
      ? addresses.every((a) => isLoopback(a.address))
      : addresses.every((a) => !isBlockedAddress(a.address));
    if (!allowed) throw new SafeHttpError('BLOCKED_ADDRESS');

    return { url, host, pinned: addresses[0], insecure };
  }

  private send(target: Target, req: SafeHttpRequest) {
    const { url, host, pinned, insecure } = target;
    const path = new URL(url.toString());
    const headers: Record<string, string> = {
      ...req.headers,
      Accept: 'application/json',
      'User-Agent': 'PurpleCallio-Tools/1.0',
    };
    if (req.method === 'GET') {
      path.searchParams.set('payload', req.body);
    } else {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(req.body));
    }

    // The socket only ever connects to the address we already checked.
    const lookup: LookupFunction = (_hostname, options, callback) => {
      if ((options as { all?: boolean })?.all) {
        (callback as (err: null, addresses: ResolvedAddress[]) => void)(null, [
          pinned,
        ]);
      } else {
        callback(null, pinned.address, pinned.family);
      }
    };

    const options: https.RequestOptions = {
      method: req.method,
      hostname: host,
      port: url.port || undefined,
      path: `${path.pathname}${path.search}`,
      headers,
      lookup,
      agent: false,
      // SNI and certificate checks use the hostname, not the pinned IP.
      servername: isIP(host) ? undefined : host,
      rejectUnauthorized: !insecure,
    };

    return new Promise<SafeHttpResponse>((resolve, reject) => {
      let settled = false;
      const done = (err: SafeHttpError | null, res?: SafeHttpResponse) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) {
          request.destroy();
          reject(err);
        } else {
          resolve(res!);
        }
      };

      const transport = url.protocol === 'http:' ? http : https;
      const request = transport.request(options, (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          return done(new SafeHttpError('REDIRECT_REFUSED', status));
        }
        const declared = Number(res.headers['content-length']);
        if (Number.isFinite(declared) && declared > req.maxResponseBytes) {
          res.resume();
          return done(new SafeHttpError('RESPONSE_TOO_LARGE', status));
        }

        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > req.maxResponseBytes) {
            return done(new SafeHttpError('RESPONSE_TOO_LARGE', status));
          }
          chunks.push(chunk);
        });
        res.on('error', () => done(new SafeHttpError('NETWORK_ERROR')));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          if (status < 200 || status >= 300) {
            return done(new SafeHttpError('HTTP_ERROR', status, raw));
          }
          if (status === 204) return done(null, { status, json: null, raw });
          const type = String(res.headers['content-type'] ?? '');
          if (!JSON_CONTENT_TYPE.test(type)) {
            return done(new SafeHttpError('NOT_JSON', status, raw));
          }
          try {
            done(null, { status, json: JSON.parse(raw), raw });
          } catch {
            done(new SafeHttpError('NOT_JSON', status, raw));
          }
        });
      });

      const timer = setTimeout(
        () => done(new SafeHttpError('TIMEOUT')),
        req.timeoutMs,
      );
      timer.unref?.();

      request.on('error', () => done(new SafeHttpError('NETWORK_ERROR')));
      if (req.method === 'POST') request.write(req.body);
      request.end();
    });
  }
}
