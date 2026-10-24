/**
 * Local tool endpoint for the stage 7 live check. Serves `getCustomerName`
 * and verifies the X-PurpleCallio-Signature header.
 *
 *   npx ts-node scripts/ai-tool-stub.ts --secret bj_tool_… [--port 4010]
 *
 * Run the API with AI_TOOLS_ALLOW_INSECURE_LOCALHOST=true and point the tool
 * at http://localhost:4010/tools/customer-name. Logs only ids and status.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import * as http from 'http';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const secret = arg('secret');
const port = Number(arg('port') ?? 4010);
if (!secret) {
  console.error('Usage: ts-node scripts/ai-tool-stub.ts --secret bj_tool_… [--port 4010]');
  process.exit(1);
}

function verify(raw: string, headers: http.IncomingHttpHeaders): boolean {
  const timestamp = String(headers['x-purplecallio-timestamp'] ?? '');
  const signature = String(headers['x-purplecallio-signature'] ?? '');
  if (!timestamp || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
    return false;
  }
  const expected = `sha256=${createHmac('sha256', secret!).update(`${timestamp}.${raw}`).digest('hex')}`;
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const NAMES: Record<string, string> = { c_1: 'Priya Sharma', c_2: 'Sam Rivera' };

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const raw = req.method === 'GET' ? (url.searchParams.get('payload') ?? '') : body;
      const reply = (status: number, json: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(json));
      };
      if (!verify(raw, req.headers)) {
        console.log(`event=tool_stub_rejected path=${url.pathname}`);
        return reply(401, { error: 'bad signature' });
      }
      const payload = JSON.parse(raw);
      console.log(
        `event=tool_stub_call tool=${payload.tool} sessionId=${payload.sessionId} test=${payload.test === true}`,
      );
      const id = String(payload.arguments?.customerId ?? '');
      reply(200, { customerId: id, name: NAMES[id] ?? 'Alex Morgan' });
    });
  })
  .listen(port, () => console.log(`Tool stub on http://localhost:${port}/tools/customer-name`));
