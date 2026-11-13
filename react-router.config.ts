import type { Config } from "@react-router/dev/config";

// Read at build time and baked into the server build. Comma-separated hosts,
// for example "resume.example.com". build-and-push.sh supplies it.
const allowedActionOrigins = (process.env.ALLOWED_ACTION_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export default {
  // Config options...
  // Server-side render by default, to enable SPA mode set this to `false`
  ssr: true,
  // The app runs behind a reverse proxy that terminates HTTPS, so the URL the
  // server sees (http://<container>:3000) never matches the browser's `origin`
  // header. React Router compares those two on every action and rejects the
  // request with a 400 when they differ, which breaks all mutations. Listing
  // the public domain in ALLOWED_ACTION_ORIGINS tells it the mismatch is expected.
  ...(allowedActionOrigins.length > 0 ? { allowedActionOrigins } : {}),
} satisfies Config;
