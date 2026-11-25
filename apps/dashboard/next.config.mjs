/**
 * Built with webpack (`--webpack`) because @mcpify/contracts is TypeScript source that imports
 * "./schemas.js"; webpack's extensionAlias maps those specifiers to the .ts files.
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  transpilePackages: ["@mcpify/contracts"],
  webpack(config) {
    config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"], ".mjs": [".mts", ".mjs"] };
    return config;
  },
};
export default nextConfig;
