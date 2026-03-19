import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required for the Docker production image (copies only the minimal server into .next/standalone)
  output: "standalone",
};

export default nextConfig;
