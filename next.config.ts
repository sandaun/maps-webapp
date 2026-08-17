import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // MVP is self-hosted on Node (LAN access, persistent sockets in later
  // iterations). Never deploy to Edge/serverless runtimes.
};

export default nextConfig;
