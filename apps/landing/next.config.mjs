import { createMDX } from 'fumadocs-mdx/next';

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // The provider dashboard is its own app (apps/arc-dashboard), served here at /dashboard.
  async rewrites() {
    const dashboard = 'https://chainpe-dashboard-one.vercel.app/dashboard'
    return [
      { source: '/dashboard', destination: dashboard },
      { source: '/dashboard/:path*', destination: `${dashboard}/:path*` },
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
