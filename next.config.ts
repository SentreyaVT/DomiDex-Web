import type { NextConfig } from 'next';
import { securityHeaders } from './lib/security-headers';

const nextConfig: NextConfig = {
  output: 'standalone',
  headers: async () => [{ source: '/:path*', headers: securityHeaders(process.env.NODE_ENV !== 'production') }],
};

export default nextConfig;
