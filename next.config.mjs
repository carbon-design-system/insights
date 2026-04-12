import { existsSync } from "node:fs";

const repositorySlug = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "";
const hasCustomDomain = existsSync(new URL("./public/CNAME", import.meta.url));
const inferredBasePath = hasCustomDomain
  ? ""
  : repositorySlug && !repositorySlug.endsWith(".github.io")
    ? `/${repositorySlug}`
    : "";
const basePath = (process.env.PAGES_BASE_PATH ?? inferredBasePath).replace(/\/$/, "");

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  basePath,
};

export default nextConfig;
