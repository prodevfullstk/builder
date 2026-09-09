import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
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
