import type { NextConfig } from 'next';
import { securityHeaders } from './lib/security-headers';

const nextConfig: NextConfig = {
  output: 'standalone',
  // The deployed vinext matcher requires an explicit root: /:path* only matches non-root paths.
  headers: async () => ['/', '/:path*'].map((source) => ({ source, headers: securityHeaders(process.env.NODE_ENV !== 'production') })),
};

export default nextConfig;
