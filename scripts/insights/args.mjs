import { usageError } from "./errors.mjs";

const repositoryPattern = /^[^/\s]+\/[^/\s]+$/;
const loginPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

// These parsers throw usage errors (exit 2), which keeps invalid invocation
// separate from configuration or GitHub failures (exit 1).
export function readFlagValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    throw usageError(`${flag} requires a value`);
  }
  return value;
}

export function parseRepository(value, flag = "--repo") {
  if (!repositoryPattern.test(value)) {
    throw usageError(`${flag} must use owner/name format`);
  }
  return value;
}

export function parseOrganization(value, flag = "--org") {
  if (!loginPattern.test(value)) {
    throw usageError(`${flag} must be a GitHub organization name`);
  }
  return value;
}

export function parseLogin(value, flag = "--user") {
  if (!loginPattern.test(value)) {
    throw usageError(`${flag} must be a GitHub login`);
  }
  return value;
}

export function parsePositiveInteger(value, flag) {
  if (!/^[1-9]\d*$/.test(value)) {
    throw usageError(`${flag} must be a positive integer`);
  }
  return Number(value);
}

export function deduplicateLogins(logins) {
  // GitHub logins are case-insensitive, but retain the first spelling so output
  // matches what the user supplied.
  const seen = new Set();
  return logins.filter((login) => {
    const normalized = login.toLowerCase();
    if (seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
}

export function extractGlobalOptions(args) {
  // Remove global flags before command routing so --no-color works before or
  // after a group, subcommand, or leaf-command option.
  const remaining = [];
  let noColor = false;

  for (const arg of args) {
    if (arg === "--no-color") {
      noColor = true;
    } else {
      remaining.push(arg);
    }
  }

  return { args: remaining, noColor };
}
