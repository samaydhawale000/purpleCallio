/**
 * Public developer API calls come from customer-controlled frontends. Reflect
 * the requesting origin (cors middleware's `true` behavior) rather than
 * maintaining a global domain list. Cross-origin cookies are disabled at the
 * HTTP app; protected operations use bearer/API credentials and their guards.
 */
export function corsOriginCallback(
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
): void {
  // No Origin header (server-to-server calls, curl, mobile clients) — allow.
  // `true` reflects a browser origin instead of emitting `*`.
  void origin;
  callback(null, true);
}

/**
 * Socket.IO is a public developer transport: customer web origins are not
 * known to PurpleCallio in advance. Origin is a browser signal, never auth.
 * Socket authentication still requires a scoped participant token, and this
 * transport deliberately does not use cookie credentials.
 */
export function socketOriginCallback(
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
): void {
  void origin;
  callback(null, true);
}
