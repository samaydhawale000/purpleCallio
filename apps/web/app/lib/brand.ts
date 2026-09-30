export const PURPLECALLIO_NAME = "PurpleCallio";
/**
 * Public origin of this deployment: canonical URLs, sitemap, robots, JSON-LD
 * and legal pages. Set at build time by NEXT_PUBLIC_SITE_URL (Compose derives
 * it from PUBLIC_HOST); the fallback is only for local builds.
 */
export const PURPLECALLIO_URL = (
   process.env.NEXT_PUBLIC_SITE_URL || "https://purplecallio.com"
).replace(/\/$/, "");
/** PURPLECALLIO_URL without the scheme, for prose ("see <host>/docs"). */
export const PURPLECALLIO_HOST = new URL(PURPLECALLIO_URL).host;
export const PURPLECALLIO_DESCRIPTION =
   "PurpleCallio is a developer-focused real-time communication infrastructure platform for adding audio, video, and screen sharing to web applications.";
export const PURPLECALLIO_CATEGORY =
   "Developer-focused real-time communication infrastructure";
export const PURPLECALLIO_LOGO = "/opengraph-image";
export const PURPLECALLIO_GITHUB = undefined;
export const PURPLECALLIO_LINKEDIN = undefined;
export const PURPLECALLIO_NPM = "https://www.npmjs.com/org/purplecallio";

/**
 * Public REST API base shown in docs and code samples: the API of the
 * deployment serving these pages (NEXT_PUBLIC_API_URL, e.g.
 * https://<PUBLIC_HOST>/api). Derived rather than
 * hard-coded so a domain move needs no docs edits.
 */
export const PURPLECALLIO_API_URL = (
   process.env.NEXT_PUBLIC_API_URL || "http://localhost:3005"
).replace(/\/$/, "");

/** Socket.IO origin: the same host, without /api (Nginx serves /socket.io/). */
export const PURPLECALLIO_SIGNAL_URL = PURPLECALLIO_API_URL.replace(/\/api$/, "");
