import { createMDX } from 'fumadocs-mdx/next';

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // The provider dashboard (apps/avalanche-dashboard) is served by chainpe-cloud on Railway and proxied here at /dashboard.
  // DASHBOARD_ORIGIN overrides where it is hosted.
  async rewrites() {
    const origin = (process.env.DASHBOARD_ORIGIN || 'https://chainpe-cloud-production-1d71cb77.up.railway.app').replace(/\/+$/, '')
    return [
      { source: '/dashboard', destination: `${origin}/dashboard/` },
      { source: '/dashboard/:path*', destination: `${origin}/dashboard/:path*` },
    ]
  },
  async redirects() {
    return [
      {
        source: '/docs',
        destination: '/docs/introduction',
        permanent: false,
      },
    ]
  }
};

const withMDX = createMDX();

export default withMDX(nextConfig);
