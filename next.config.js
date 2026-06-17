/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output: bundles a self-contained Node server at .next/standalone/server.js
  // This is required for Tauri integration since /api/trpc/[trpc] is a dynamic route
  // incompatible with output: 'export'. The Tauri app spawns server.js as a sidecar.
  output: 'standalone',
  images: {
    unoptimized: true,
  },
};

module.exports = nextConfig;
