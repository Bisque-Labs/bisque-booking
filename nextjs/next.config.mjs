/** @type {import('next').NextConfig} */
const nextConfig = {
  // Produce a self-contained server bundle in .next/standalone.
  // Required for the multi-stage Docker build.
  output: "standalone",
};

export default nextConfig;
