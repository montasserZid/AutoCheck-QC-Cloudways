import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  outputFileTracingIncludes: {
    "/api/listing-extraction": [
      "./node_modules/@sparticuz/chromium/bin/**/*",
    ],
  },
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  reactStrictMode: true
};

export default nextConfig;
