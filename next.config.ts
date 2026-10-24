import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  outputFileTracingIncludes: {
    "/api/task/*": ["./data/policy.v1.md", "./data/cases.frozen.json", "./data/prepared-review.config.json", "./data/assignment.json", "./data/decisions_v1.json", "./data/PREREGISTRATION.md"],
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
