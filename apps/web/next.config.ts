import type { NextConfig } from 'next';

/**
 * Headers that do not depend on the request. The Content-Security-Policy is
 * NOT here: it carries a per-request nonce and is set in `src/middleware.ts`.
 */
const securityHeaders = [
  // Browsers must not sniff a JSON response into something executable.
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  /*
   * SAMEORIGIN, not DENY. The threat this header exists for is clickjacking —
   * somebody else's page framing ours to trick a click — and SAMEORIGIN blocks
   * that just as completely. DENY additionally blocked the app from framing
   * itself, which is what the inline PDF viewer needs.
   */
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Nothing here needs a camera, a microphone or a location.
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Self-contained server bundle for the Docker image (deploy/docker) — a
  // fraction of the size of shipping the full node_modules tree. Has no
  // effect on `next start` from the plain build the native systemd deploy
  // (deploy/setup-vm.sh) uses.
  output: 'standalone',

  // The server sends JSON envelopes, not a framework fingerprint.
  poweredByHeader: false,

  // @dtrace/shared ships compiled ESM, so Next can consume it as-is.
  serverExternalPackages: [],

  typedRoutes: true,

  experimental: {
    // Only these may be read by a server action's client boundary.
    serverActions: { bodySizeLimit: '1mb' },
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
      {
        // API responses are per-user; keep them out of every cache.
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0' }],
      },
    ];
  },
};

export default nextConfig;
