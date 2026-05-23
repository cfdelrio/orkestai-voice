import type { NextConfig } from "next";
import path from "path";

const API_URL = process.env.API_BASE_URL ?? 'http://localhost:3000';

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname),
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${API_URL}/api/:path*`,
      },
      {
        source: '/internal/:path*',
        destination: `${API_URL}/internal/:path*`,
      },
    ];
  },
};

export default nextConfig;
