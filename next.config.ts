import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.resolve(__dirname),
  env: {
    NEXT_PUBLIC_SUPABASE_URL:
      process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://gmstovafjvsmsscfynqh.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdtc3RvdmFmanZzbXNzY2Z5bnFoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkyMDcwMzcsImV4cCI6MjEwNDc4MzAzN30.rPvAJ-4stmHY9s4pQxuNKvHIROXXbc1yg6yVR6hsxVI',
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
    return config;
  },
};

export default nextConfig;

