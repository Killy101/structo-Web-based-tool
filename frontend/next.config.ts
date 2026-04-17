import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required for the Docker production image (copies only the minimal server into .next/standalone)
  output: "standalone",
  webpack: (config, { dev }) => {
    if (dev) {
      // Use inline source maps to avoid Chrome DevTools trying to mount
      // Docker container paths (/app/...) as a local workspace, which
      // causes "Unable to add filesystem: <illegal path>" in the console.
      config.devtool = "eval-source-map";
    }
    return config;
  },
};

export default nextConfig;
