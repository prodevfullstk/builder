import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Required for esbuild-wasm SharedArrayBuffer support (worker: false mode)
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
        ],
      },
    ];
  },
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
    // Prevent esbuild-wasm from being bundled server-side
    if (isServer) {
      config.externals = [...(config.externals || []), 'esbuild-wasm'];
    }
    return config;
  },
};

export default nextConfig;
