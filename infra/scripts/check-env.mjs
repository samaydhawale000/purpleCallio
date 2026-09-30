#!/usr/bin/env node
// Validates a PurpleCallio production env file (infra/.env) for internal
// consistency before `docker compose up`. Prints key names only, never values.
//
//   node infra/scripts/check-env.mjs infra/.env
//   node infra/scripts/check-env.mjs infra/.env.example --allow-placeholders
//
// Exit code 1 when any error is found; warnings do not fail.
import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { fileURLToPath } from 'node:url';

export function parseEnv(text) {
  const vars = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    let value = line.slice(eq + 1).trim();
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    vars[line.slice(0, eq).trim()] = value;
  }
  return vars;
}

const REQUIRED = [
  'PUBLIC_HOST',
  'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB',
  'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET',
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET',
  'TURN_SECRET',
  'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET',
];

const SECRETS = [
  'POSTGRES_PASSWORD', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET',
  'GOOGLE_CLIENT_SECRET', 'TURN_SECRET', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET',
];

const isPlaceholder = (v) => /^<.*>$/.test(v) || /<[^>]+>/.test(v);

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/**
 * Applies the same defaults as infra/docker-compose.yml: every host-specific
 * value derives from PUBLIC_HOST unless it is set explicitly.
 */
export function resolveEnv(vars) {
  const host = (vars.PUBLIC_HOST ?? '').trim();
  const out = { ...vars };
  const fill = (key, value) => { if (!(out[key] ?? '').trim() && host) out[key] = value; };
  fill('FRONTEND_URL', `https://${host}`);
  fill('APP_URL', `https://${host}`);
  fill('NEXT_PUBLIC_API_URL', `https://${host}/api`);
  fill('NEXT_PUBLIC_SITE_URL', `https://${host}`);
  fill('TURN_HOST', host);
  return out;
}

/** Returns { errors: string[], warnings: string[] }. Messages never contain values. */
export function checkEnv(input, { allowPlaceholders = false } = {}) {
  const errors = [];
  const warnings = [];
  const vars = resolveEnv(input);
  const get = (k) => (vars[k] ?? '').trim();

  // The one place the domain lives. Nginx renders server_name and the
  // certificate path from it, so it must be a bare DNS name.
  const publicHost = get('PUBLIC_HOST');
  if (publicHost && !isPlaceholder(publicHost)) {
    if (/[/:@\s]/.test(publicHost)) errors.push('PUBLIC_HOST must be a bare hostname (no scheme, port or path)');
    else if (isIP(publicHost) !== 0) errors.push('PUBLIC_HOST is an IP address; use the DNS name on the TLS certificate');
  }

  for (const key of REQUIRED) {
    if (!get(key)) errors.push(`${key} is missing or empty`);
    else if (!allowPlaceholders && isPlaceholder(get(key))) errors.push(`${key} still has a <placeholder> value`);
  }

  // One HTTPS origin for the web app, and the API under /api on it.
  const frontend = parseUrl(get('FRONTEND_URL'));
  const app = parseUrl(get('APP_URL'));
  const api = parseUrl(get('NEXT_PUBLIC_API_URL'));
  for (const [key, url] of [['FRONTEND_URL', frontend], ['APP_URL', app], ['NEXT_PUBLIC_API_URL', api]]) {
    if (!get(key)) continue;
    if (!url) { errors.push(`${key} is not a valid URL`); continue; }
    if (url.protocol !== 'https:') errors.push(`${key} must use https:// (browsers require it for camera/microphone and secure WebSockets)`);
    if (isIP(url.hostname.replace(/^\[|\]$/g, '')) !== 0) errors.push(`${key} uses a raw IP address; use the DNS hostname on the TLS certificate`);
  }
  if (frontend && frontend.pathname !== '/') errors.push('FRONTEND_URL must be an origin without a path');
  if (frontend && app && frontend.origin !== app.origin) errors.push('APP_URL and FRONTEND_URL must be the same origin');
  if (frontend && publicHost && frontend.hostname !== publicHost) {
    errors.push('FRONTEND_URL is not on PUBLIC_HOST: Nginx only serves PUBLIC_HOST (remove the override to derive it)');
  }
  const site = parseUrl(get('NEXT_PUBLIC_SITE_URL'));
  if (get('NEXT_PUBLIC_SITE_URL') && !site) errors.push('NEXT_PUBLIC_SITE_URL is not a valid URL');
  else if (site && frontend && site.origin !== frontend.origin) {
    warnings.push('NEXT_PUBLIC_SITE_URL differs from FRONTEND_URL: canonical URLs and the sitemap will point at another host');
  }
  if (frontend && api) {
    if (api.origin !== frontend.origin) errors.push('NEXT_PUBLIC_API_URL must be on the same origin as FRONTEND_URL (Nginx routes /api/ there)');
    if (api.pathname.replace(/\/$/, '') !== '/api') errors.push('NEXT_PUBLIC_API_URL must end in /api (Nginx routes /api/ to the server; Socket.IO is at /socket.io/)');
  }

  // Only URL/host settings: secrets and database names may legitimately
  // contain the old brand, and must not be inspected or hinted at.
  const HOST_KEYS = /(_URL|_HOST|^TURN_SERVER|^ALLOWED_ORIGINS)$/;
  for (const [key, value] of Object.entries(vars)) {
    if (HOST_KEYS.test(key) && /bluecallio\.serveminecraft/i.test(value)) errors.push(`${key} still references the old bluecallio host`);
  }

  // TURN: a hostname for clients/TLS, an IP for Coturn's relay address.
  const turnHost = get('TURN_HOST') || get('TURN_SERVER');
  if (!turnHost) {
    errors.push('TURN_HOST is missing (TURN_SERVER is the legacy name)');
  } else if (isIP(turnHost) !== 0) {
    errors.push('TURN_HOST/TURN_SERVER is an IP address: turns:5349 needs the DNS hostname covered by the TURN TLS certificate');
  } else if (frontend && turnHost !== frontend.hostname) {
    warnings.push('TURN_HOST differs from the FRONTEND_URL host: make sure a TLS certificate for it exists under /etc/letsencrypt/live/<TURN_HOST>/');
  }
  if (get('TURN_HOST') && get('TURN_SERVER') && get('TURN_SERVER') !== get('TURN_HOST') && isIP(get('TURN_SERVER')) === 0) {
    warnings.push('TURN_SERVER and TURN_HOST differ; the server uses TURN_HOST');
  }
  const externalIp = get('TURN_EXTERNAL_IP') || (isIP(get('TURN_SERVER')) ? get('TURN_SERVER') : '');
  if (!externalIp) {
    errors.push('TURN_EXTERNAL_IP is missing (Coturn needs the public IP it advertises in relay candidates)');
  } else if (!(allowPlaceholders && isPlaceholder(externalIp)) && isIP(externalIp) !== 4) {
    errors.push('TURN_EXTERNAL_IP must be a public IPv4 address');
  }
  for (const key of ['TURN_TLS_CERT_FILE', 'TURN_TLS_KEY_FILE']) {
    if (get(key) && turnHost && !get(key).includes(`/${turnHost}/`)) {
      warnings.push(`${key} does not point at /etc/letsencrypt/live/<TURN_HOST>/: the certificate must cover TURN_HOST`);
    }
  }
  const ttl = Number(get('TURN_CREDENTIAL_TTL_SECONDS') || 86400);
  if (!Number.isFinite(ttl) || ttl <= 0) errors.push('TURN_CREDENTIAL_TTL_SECONDS must be a positive number');
  else if (ttl < 4 * 3600) warnings.push('TURN_CREDENTIAL_TTL_SECONDS is under 4h: relayed calls longer than this lose media when Coturn refreshes the allocation');

  // Public identifiers baked into the web bundle (compose defaults them).
  if (!get('NEXT_PUBLIC_GOOGLE_CLIENT_ID') && !get('GOOGLE_CLIENT_ID')) errors.push('NEXT_PUBLIC_GOOGLE_CLIENT_ID (or GOOGLE_CLIENT_ID) is required for Google sign-in');
  if (!get('NEXT_PUBLIC_RAZORPAY_KEY_ID') && !get('RAZORPAY_KEY_ID')) errors.push('NEXT_PUBLIC_RAZORPAY_KEY_ID (or RAZORPAY_KEY_ID) is required for checkout');
  if (get('NEXT_PUBLIC_RAZORPAY_KEY_ID') && get('RAZORPAY_KEY_SECRET') && get('NEXT_PUBLIC_RAZORPAY_KEY_ID') === get('RAZORPAY_KEY_SECRET')) {
    errors.push('NEXT_PUBLIC_RAZORPAY_KEY_ID equals RAZORPAY_KEY_SECRET: the secret would be shipped to browsers');
  }
  for (const key of Object.keys(vars)) {
    if (key.startsWith('NEXT_PUBLIC_') && /SECRET|PASSWORD|PRIVATE/i.test(key)) errors.push(`${key}: NEXT_PUBLIC_* values are public; never put a secret in one`);
  }

  if (!allowPlaceholders) {
    for (const key of SECRETS) {
      if (get(key) && get(key).length < 16) warnings.push(`${key} is shorter than 16 characters`);
    }
    if (get('JWT_ACCESS_SECRET') && get('JWT_ACCESS_SECRET') === get('JWT_REFRESH_SECRET')) errors.push('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ');
  }
  if ((get('PLAYGROUND_ENABLED') || 'true').toLowerCase() === 'true' && Number(get('PLAYGROUND_CALL_DURATION_SECONDS') || 60) > 60) {
    warnings.push('PLAYGROUND_CALL_DURATION_SECONDS is above 60');
  }
  if (get('ALLOWED_ORIGINS')) warnings.push('ALLOWED_ORIGINS is no longer read by the server (CORS reflects origins; participant tokens authorize) and can be removed');

  return { errors, warnings };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node infra/scripts/check-env.mjs <env-file> [--allow-placeholders]');
    process.exit(2);
  }
  const { errors, warnings } = checkEnv(parseEnv(readFileSync(file, 'utf8')), {
    allowPlaceholders: process.argv.includes('--allow-placeholders'),
  });
  for (const w of warnings) console.log(`warning: ${w}`);
  for (const e of errors) console.log(`error:   ${e}`);
  console.log(errors.length ? `\n${errors.length} error(s), ${warnings.length} warning(s)` : `OK (${warnings.length} warning(s))`);
  process.exit(errors.length ? 1 : 0);
}
