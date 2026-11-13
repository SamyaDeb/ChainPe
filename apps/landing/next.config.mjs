import { createMDX } from 'fumadocs-mdx/next';

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
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
