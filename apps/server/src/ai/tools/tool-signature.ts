import { createHmac } from 'crypto';

export const TOOL_SIGNATURE_HEADER = 'X-PurpleCallio-Signature';
export const TOOL_TIMESTAMP_HEADER = 'X-PurpleCallio-Timestamp';
export const TOOL_EVENT_HEADER = 'X-PurpleCallio-Event';

/**
 * Same format as webhooks (`sha256=<hex HMAC-SHA256>`), but the signed
 * string is `<timestamp>.<body>` so a captured request can't be replayed
 * with a fresh timestamp. For GET tools the body is the `payload` query
 * parameter. The timestamp is Unix seconds.
 */
export function signToolRequest(
  secret: string,
  timestamp: number,
  body: string,
): string {
  const sig = createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
  return `sha256=${sig}`;
}
