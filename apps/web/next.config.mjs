import path from 'path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',

  // Lets scripts/webrtc-e2e run its own `next dev` (own build dir and dev
  // lock) next to a developer's running one. Unset in every real build.
  ...(process.env.NEXT_E2E_DIST_DIR ? { distDir: process.env.NEXT_E2E_DIST_DIR } : {}),

  turbopack: {
    root: path.resolve(process.cwd(), '../..'),
  },

  async redirects() {
    return [
      {
        source: '/what-is-bluecallio',
        destination: '/what-is-purplecallio',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
