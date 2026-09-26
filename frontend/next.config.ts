import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "192.168.0.107",
    "10.118.213.30",
    "localhost",
    "local-frontend.justfahad.me",
  ],
  images: {
    remotePatterns: [
      ...(process.env.NEXT_PUBLIC_MEDIA_DOMAIN
        ? [
            {
              protocol: "https" as const,
              hostname: process.env.NEXT_PUBLIC_MEDIA_DOMAIN,
              pathname: "/media/**",
            },
          ]
        : []),
    ],
  },
};
export default nextConfig;
