import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Service Worker for Nodebox
  async headers() {
    return [
      {
        source: '/__nodebox__/sw.js',
        headers: [
          {
            key: 'Service-Worker-Allowed',
            value: '/',
          },
          {
            key: 'Content-Type',
            value: 'application/javascript; charset=utf-8',
          },
          {
            key: 'Cache-Control',
            value: 'no-cache, no-store, must-revalidate',
          },
        ],
      },
    ];
  },

  // Webpack config for Nodebox
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        crypto: false,
        path: false,
        stream: false,
        util: false,
        buffer: false,
      };
    }
    return config;
  },

  // Rewrites for service worker
  async rewrites() {
    return [
      {
        source: '/__nodebox__/sw.js',
        destination: '/api/service-worker',
      },
    ];
  },
};

export default nextConfig;
