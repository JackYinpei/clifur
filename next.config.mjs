/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  ...(process.env.DEPLOYMENT_VERSION
    ? { deploymentId: process.env.DEPLOYMENT_VERSION }
    : {}),
};

export default nextConfig;
