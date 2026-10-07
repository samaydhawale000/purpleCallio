// node --test infra/scripts/check-env.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { checkEnv, parseEnv, resolveEnv } from './check-env.mjs';

const example = parseEnv(readFileSync(new URL('../.env.example', import.meta.url), 'utf8'));

/** A complete, consistent production env for the temporary host. */
const good = () => ({
  ...example,
  POSTGRES_USER: 'purplecallio',
  POSTGRES_PASSWORD: 'p'.repeat(24),
  POSTGRES_DB: 'purplecallio',
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  JWT_REFRESH_SECRET: 'r'.repeat(40),
  GOOGLE_CLIENT_ID: '123-abc.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'g'.repeat(24),
  TURN_EXTERNAL_IP: '130.210.24.136',
  TURN_SECRET: 't'.repeat(32),
  RAZORPAY_KEY_ID: 'rzp_live_abc',
  RAZORPAY_KEY_SECRET: 's'.repeat(24),
  RAZORPAY_WEBHOOK_SECRET: 'w'.repeat(24),
});

const errorsOf = (vars, opts) => checkEnv(vars, opts).errors.join('\n');

test('the committed .env.example is structurally valid', () => {
  assert.deepEqual(checkEnv(example, { allowPlaceholders: true }).errors, []);
});

test('the example names the domain once; everything else derives from it', () => {
  const host = example.PUBLIC_HOST;
  assert.ok(host && !host.includes('/'), 'PUBLIC_HOST is a bare hostname');
  for (const key of ['FRONTEND_URL', 'APP_URL', 'NEXT_PUBLIC_API_URL', 'NEXT_PUBLIC_SITE_URL', 'TURN_HOST', 'TURN_SERVER']) {
    assert.equal(example[key], undefined, `${key} should be derived, not set`);
  }
  const resolved = resolveEnv(example);
  assert.equal(resolved.FRONTEND_URL, `https://${host}`);
  assert.equal(resolved.APP_URL, `https://${host}`);
  assert.equal(resolved.NEXT_PUBLIC_API_URL, `https://${host}/api`);
  assert.equal(resolved.NEXT_PUBLIC_SITE_URL, `https://${host}`);
  assert.equal(resolved.TURN_HOST, host);
});

test('moving domain only needs PUBLIC_HOST', () => {
  const vars = { ...good(), PUBLIC_HOST: 'purplecallio.com' };
  assert.deepEqual(checkEnv(vars).errors, []);
  assert.equal(resolveEnv(vars).NEXT_PUBLIC_API_URL, 'https://purplecallio.com/api');
  assert.equal(resolveEnv(vars).TURN_HOST, 'purplecallio.com');
});

test('explicit overrides still win over PUBLIC_HOST', () => {
  const vars = { ...good(), TURN_HOST: 'turn.example.test' };
  assert.equal(resolveEnv(vars).TURN_HOST, 'turn.example.test');
  assert.deepEqual(checkEnv(vars).errors, []);
});

test('PUBLIC_HOST is required and must be a bare DNS name', () => {
  assert.match(errorsOf({ ...good(), PUBLIC_HOST: '' }), /PUBLIC_HOST is missing/);
  assert.match(errorsOf({ ...good(), PUBLIC_HOST: 'https://purplecallio.com' }), /bare hostname/);
  assert.match(errorsOf({ ...good(), PUBLIC_HOST: '130.210.24.136' }), /PUBLIC_HOST is an IP/);
});

test('a FRONTEND_URL override off PUBLIC_HOST is rejected (Nginx would not serve it)', () => {
  assert.match(errorsOf({ ...good(), FRONTEND_URL: 'https://other.example', APP_URL: 'https://other.example', NEXT_PUBLIC_API_URL: 'https://other.example/api' }), /not on PUBLIC_HOST/);
});

test('placeholders are rejected in a real env file', () => {
  assert.match(errorsOf(example), /still has a <placeholder>/);
});

test('a complete consistent env passes with no errors', () => {
  assert.deepEqual(checkEnv(good()).errors, []);
});

test('http:// and raw-IP URLs are rejected', () => {
  const vars = { ...good(), FRONTEND_URL: 'http://130.210.24.136', APP_URL: 'http://130.210.24.136', NEXT_PUBLIC_API_URL: 'http://130.210.24.136/api' };
  const errors = errorsOf(vars);
  assert.match(errors, /FRONTEND_URL must use https/);
  assert.match(errors, /raw IP address/);
});

test('the API must be /api on the web origin', () => {
  assert.match(errorsOf({ ...good(), NEXT_PUBLIC_API_URL: 'https://api.purplecallio.com' }), /same origin/);
  assert.match(errorsOf({ ...good(), NEXT_PUBLIC_API_URL: `https://${example.PUBLIC_HOST}` }), /must end in \/api/);
  assert.match(errorsOf({ ...good(), APP_URL: 'https://other.example' }), /APP_URL and FRONTEND_URL/);
});

test('leftover bluecallio hosts are rejected', () => {
  assert.match(errorsOf({ ...good(), ALLOWED_ORIGINS: 'https://bluecallio.serveminecraft.net' }), /bluecallio/);
});

test('a TURN IP literal is rejected: TLS needs the certificate hostname', () => {
  assert.match(errorsOf({ ...good(), TURN_HOST: '130.210.24.136' }), /turns:5349 needs the DNS hostname/);
});

test('the legacy IP-only TURN_SERVER still supplies the external IP', () => {
  const vars = { ...good(), TURN_EXTERNAL_IP: '', TURN_SERVER: '130.210.24.136' };
  assert.doesNotMatch(errorsOf(vars), /TURN_EXTERNAL_IP is missing/);
});

test('TURN_EXTERNAL_IP must be IPv4', () => {
  assert.match(errorsOf({ ...good(), TURN_EXTERNAL_IP: 'calls.example.com' }), /public IPv4/);
});

test('public client IDs must be present (directly or via the server values)', () => {
  const vars = { ...good(), RAZORPAY_KEY_ID: '', NEXT_PUBLIC_RAZORPAY_KEY_ID: '' };
  assert.match(errorsOf(vars), /NEXT_PUBLIC_RAZORPAY_KEY_ID/);
});

test('secrets can never be routed into NEXT_PUBLIC_*', () => {
  assert.match(errorsOf({ ...good(), NEXT_PUBLIC_RAZORPAY_KEY_ID: 's'.repeat(24) }), /shipped to browsers/);
  assert.match(errorsOf({ ...good(), NEXT_PUBLIC_TURN_SECRET: 'x' }), /never put a secret/);
});

test('a short customer TURN TTL is flagged', () => {
  assert.match(checkEnv({ ...good(), TURN_CREDENTIAL_TTL_SECONDS: '600' }).warnings.join('\n'), /under 4h/);
});

test('secret values are never inspected for old host names', () => {
  const { errors } = checkEnv({ ...good(), POSTGRES_DB: 'bluecallio', TURN_SECRET: 'bluecallio-'.repeat(4) });
  assert.doesNotMatch(errors.join('\n'), /POSTGRES_DB|TURN_SECRET/);
});

test('messages never contain secret values', () => {
  const vars = { ...good(), JWT_ACCESS_SECRET: 'SHORT', JWT_REFRESH_SECRET: 'SHORT', TURN_SECRET: 'SHORT' };
  const { errors, warnings } = checkEnv(vars);
  assert.doesNotMatch([...errors, ...warnings].join('\n'), /SHORT/);
});
