import * as http from 'http';
import { AddressInfo } from 'net';

import {
  isBlockedAddress,
  SafeHttpClient,
  SafeHttpError,
  SafeHttpRequest,
} from './safe-http-client';

const httpsModule = require('https');

function request(url: string, overrides: Partial<SafeHttpRequest> = {}) {
  return {
    url,
    method: 'POST' as const,
    body: JSON.stringify({ tool: 'getCustomerName', arguments: {} }),
    headers: { 'X-PurpleCallio-Signature': 'sha256=abc' },
    timeoutMs: 1000,
    maxResponseBytes: 1024,
    ...overrides,
  };
}

async function errorOf(promise: Promise<unknown>): Promise<SafeHttpError> {
  try {
    await promise;
  } catch (e) {
    return e as SafeHttpError;
  }
  throw new Error('expected a rejection');
}

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '172.16.5.4',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fe80::1',
    'fd00::1',
    '::ffff:127.0.0.1',
    '::ffff:a9fe:a9fe',
    '64:ff9b::a00:1',
    'not-an-ip',
  ])('blocks %s', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700::1111'])(
    'allows %s',
    (address) => {
      expect(isBlockedAddress(address)).toBe(false);
    },
  );
});

describe('SafeHttpClient', () => {
  const savedFlag = process.env.AI_TOOLS_ALLOW_INSECURE_LOCALHOST;
  let client: SafeHttpClient;
  let resolver: jest.Mock;

  beforeEach(() => {
    delete process.env.AI_TOOLS_ALLOW_INSECURE_LOCALHOST;
    client = new SafeHttpClient();
    resolver = jest.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
    client.resolver = resolver;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (savedFlag === undefined) {
      delete process.env.AI_TOOLS_ALLOW_INSECURE_LOCALHOST;
    } else {
      process.env.AI_TOOLS_ALLOW_INSECURE_LOCALHOST = savedFlag;
    }
  });

  describe('URL and address checks', () => {
    it.each([
      ['http://api.acme.com/tool', 'BLOCKED_URL'],
      ['http://localhost:3000/tool', 'BLOCKED_URL'],
      ['ftp://api.acme.com/tool', 'BLOCKED_URL'],
      ['https://user:pass@api.acme.com/tool', 'BLOCKED_URL'],
      ['not a url', 'INVALID_URL'],
      ['https://10.0.0.1/tool', 'BLOCKED_ADDRESS'],
      ['https://169.254.169.254/latest/meta-data', 'BLOCKED_ADDRESS'],
      ['https://127.0.0.1/tool', 'BLOCKED_ADDRESS'],
      ['https://[::1]/tool', 'BLOCKED_ADDRESS'],
      ['https://[::ffff:127.0.0.1]/tool', 'BLOCKED_ADDRESS'],
    ])('refuses %s (%s)', async (url, code) => {
      const err = await errorOf(client.request(request(url)));
      expect(err).toBeInstanceOf(SafeHttpError);
      expect(err.code).toBe(code);
    });

    it('refuses https://localhost by resolving it to loopback', async () => {
      resolver.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
      const err = await errorOf(
        client.request(request('https://localhost/tool')),
      );
      expect(err.code).toBe('BLOCKED_ADDRESS');
    });

    it('refuses a name when any of its addresses is private', async () => {
      resolver.mockResolvedValue([
        { address: '93.184.216.34', family: 4 },
        { address: '10.0.0.1', family: 4 },
      ]);
      const err = await errorOf(
        client.request(request('https://api.acme.com/tool')),
      );
      expect(err.code).toBe('BLOCKED_ADDRESS');
    });

    it('maps a DNS failure to DNS_FAILED without the resolver text', async () => {
      resolver.mockRejectedValue(new Error('getaddrinfo ENOTFOUND secret'));
      const err = await errorOf(
        client.request(request('https://nope.acme.com/tool')),
      );
      expect(err.code).toBe('DNS_FAILED');
      expect(err.message).toBe('DNS_FAILED');
    });

    it('pins the socket to the checked address (DNS rebinding)', async () => {
      // First answer is public; a rebinding server would answer loopback next.
      resolver
        .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
        .mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
      let options: any;
      jest.spyOn(httpsModule, 'request').mockImplementation((opts: any) => {
        options = opts;
        const req = new (require('events').EventEmitter)();
        req.write = jest.fn();
        req.end = jest.fn(() => req.emit('error', new Error('stop')));
        req.destroy = jest.fn();
        return req;
      });

      const err = await errorOf(
        client.request(request('https://rebind.acme.com/tool')),
      );
      expect(err.code).toBe('NETWORK_ERROR');
      expect(options.hostname).toBe('rebind.acme.com');
      expect(options.servername).toBe('rebind.acme.com');
      expect(options.agent).toBe(false);

      const single = jest.fn();
      options.lookup('rebind.acme.com', {}, single);
      expect(single).toHaveBeenCalledWith(null, '93.184.216.34', 4);
      const all = jest.fn();
      options.lookup('rebind.acme.com', { all: true }, all);
      expect(all).toHaveBeenCalledWith(null, [
        { address: '93.184.216.34', family: 4 },
      ]);
      // The connection never asks DNS again.
      expect(resolver).toHaveBeenCalledTimes(1);
    });
  });

  describe('against a local server (AI_TOOLS_ALLOW_INSECURE_LOCALHOST)', () => {
    let server: http.Server;
    let base: string;
    let handler: (req: http.IncomingMessage, res: http.ServerResponse) => void;
    let received: { method?: string; url?: string; headers: any; body: string };

    beforeAll(async () => {
      server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          received = {
            method: req.method,
            url: req.url,
            headers: req.headers,
            body,
          };
          handler(req, res);
        });
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      base = `http://localhost:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
      server.closeAllConnections?.();
      await new Promise((r) => server.close(r));
    });

    beforeEach(() => {
      process.env.AI_TOOLS_ALLOW_INSECURE_LOCALHOST = 'true';
      client.resolver = async () => [{ address: '127.0.0.1', family: 4 }];
      handler = (_req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ name: 'Sam' }));
      };
    });

    it('posts the body with the given headers and parses JSON', async () => {
      const res = await client.request(request(`${base}/tool`));
      expect(res).toEqual({
        status: 200,
        json: { name: 'Sam' },
        raw: '{"name":"Sam"}',
      });
      expect(received.method).toBe('POST');
      expect(received.headers['x-purplecallio-signature']).toBe('sha256=abc');
      expect(received.headers['content-type']).toBe('application/json');
      expect(JSON.parse(received.body).tool).toBe('getCustomerName');
    });

    it('sends GET payloads as the payload query parameter', async () => {
      const body = JSON.stringify({ tool: 't', arguments: { id: 1 } });
      await client.request(
        request(`${base}/tool?x=1`, { method: 'GET', body }),
      );
      const url = new URL(received.url!, base);
      expect(received.method).toBe('GET');
      expect(url.searchParams.get('x')).toBe('1');
      expect(url.searchParams.get('payload')).toBe(body);
    });

    it('refuses redirects', async () => {
      handler = (_req, res) => {
        res.writeHead(302, { Location: 'http://169.254.169.254/' });
        res.end();
      };
      const err = await errorOf(client.request(request(`${base}/tool`)));
      expect(err.code).toBe('REDIRECT_REFUSED');
      expect(err.httpStatus).toBe(302);
    });

    it('times out', async () => {
      handler = () => undefined; // never answers
      const err = await errorOf(
        client.request(request(`${base}/tool`, { timeoutMs: 50 })),
      );
      expect(err.code).toBe('TIMEOUT');
    });

    it('caps an oversized response by Content-Length', async () => {
      handler = (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ blob: 'x'.repeat(5000) }));
      };
      const err = await errorOf(client.request(request(`${base}/tool`)));
      expect(err.code).toBe('RESPONSE_TOO_LARGE');
    });

    it('caps an oversized streamed response', async () => {
      handler = (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.write(`{"blob":"${'x'.repeat(800)}`);
        setTimeout(() => res.end(`${'x'.repeat(800)}"}`), 10);
      };
      const err = await errorOf(client.request(request(`${base}/tool`)));
      expect(err.code).toBe('RESPONSE_TOO_LARGE');
    });

    it('requires a JSON response', async () => {
      handler = (_req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end('<h1>hi</h1>');
      };
      const err = await errorOf(client.request(request(`${base}/tool`)));
      expect(err.code).toBe('NOT_JSON');
      expect(err.raw).toBe('<h1>hi</h1>');
    });

    it('reports HTTP errors with the status and body', async () => {
      handler = (_req, res) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end('{"error":"boom"}');
      };
      const err = await errorOf(client.request(request(`${base}/tool`)));
      expect(err.code).toBe('HTTP_ERROR');
      expect(err.httpStatus).toBe(500);
      expect(err.raw).toBe('{"error":"boom"}');
    });

    it('still refuses localhost when the flag is off', async () => {
      delete process.env.AI_TOOLS_ALLOW_INSECURE_LOCALHOST;
      const err = await errorOf(client.request(request(`${base}/tool`)));
      expect(err.code).toBe('BLOCKED_URL');
    });

    it('refuses a localhost name that resolves off-box', async () => {
      client.resolver = async () => [{ address: '93.184.216.34', family: 4 }];
      const err = await errorOf(client.request(request(`${base}/tool`)));
      expect(err.code).toBe('BLOCKED_ADDRESS');
    });
  });
});
