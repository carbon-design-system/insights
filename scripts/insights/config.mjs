import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { CliError } from "./errors.mjs";

const loginPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

export const defaultConfigPath = fileURLToPath(
  new URL("../../config/insights.json", import.meta.url),
);

// Reading is injectable so tests can validate configuration behavior without
// changing the checked-in config file.
export async function loadConfig({
  configPath = defaultConfigPath,
  read = readFile,
} = {}) {
  let source;
  try {
    source = await read(configPath, "utf8");
  } catch (error) {
    throw configError("Unable to read Insights configuration", [error.message]);
  }

  let config;
  try {
    config = JSON.parse(source);
  } catch (error) {
    throw configError("Insights configuration is not valid JSON", [error.message]);
  }

  validateConfig(config);
  // Commands may derive invocation-specific options from this object. A clone
  // prevents one command from accidentally changing defaults for another run.
  return structuredClone(config);
}

export function validateConfig(config) {
  // Gather every problem in one pass so a maintainer can fix the whole file
  // instead of rerunning the CLI once per invalid field.
  const details = [];
  const repository = config?.github?.repository;
  const organization = config?.github?.organization;
  const users = config?.reviews?.users;
  const days = config?.stale?.days;
  const ignoredAuthors = config?.stale?.ignoredAuthors;

  if (typeof repository !== "string" || !/^[^/\s]+\/[^/\s]+$/.test(repository)) {
    details.push("github.repository must use owner/name format");
  }
  if (typeof organization !== "string" || !loginPattern.test(organization)) {
    details.push("github.organization must be a GitHub organization name");
  }
  if (!isUniqueLoginArray(users, { nonEmpty: true })) {
    details.push("reviews.users must contain unique GitHub logins");
  }
  if (!Number.isInteger(days) || days <= 0) {
    details.push("stale.days must be a positive integer");
  }
  if (!isUniqueLoginArray(ignoredAuthors)) {
    details.push("stale.ignoredAuthors must contain unique GitHub logins");
  }

  if (details.length > 0) {
    throw configError("Insights configuration is invalid", details);
  }

  return config;
}

function isUniqueLoginArray(values, { nonEmpty = false } = {}) {
  if (!Array.isArray(values) || (nonEmpty && values.length === 0)) {
    return false;
  }

  const normalized = values.map((value) =>
    typeof value === "string" ? value.trim().toLowerCase() : "",
  );
  return (
    normalized.every((value) => loginPattern.test(value)) &&
    new Set(normalized).size === normalized.length
  );
}

function configError(message, details) {
  return new CliError(message, {
    details,
    action: "Fix `config/insights.json` and try again",
  });
}
