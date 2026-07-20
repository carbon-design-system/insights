import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { CliError } from "./errors.mjs";

const execFileAsync = promisify(execFile);

// This is the only child-process boundary in the CLI. It deliberately invokes
// the user's installed `gh` executable without a shell.
export async function runGh(args) {
  const { stdout } = await execFileAsync("gh", args, {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

export function createGitHubClient({ executeGh = runGh } = {}) {
  let requestCount = 0;

  return {
    get requestCount() {
      return requestCount;
    },

    async query(document, variables = {}) {
      // Command modules receive no generic REST method, and this guard blocks a
      // GraphQL write operation even if one is passed accidentally later.
      if (!/^\s*query\b/.test(document)) {
        throw new CliError("Insights only permits read-only GraphQL queries");
      }

      const args = ["api", "graphql", "-f", `query=${document}`];
      // `gh api graphql -f` maps each key to a GraphQL variable while allowing
      // `gh` to continue using the active local account for authentication.
      for (const [key, value] of Object.entries(variables)) {
        if (value !== null && value !== undefined) {
          args.push("-f", `${key}=${value}`);
        }
      }

      requestCount += 1;
      let raw;
      try {
        const response = await executeGh(args);
        raw = typeof response === "string" ? response : response.stdout;
      } catch (error) {
        throw githubError(error);
      }

      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        throw new CliError("GitHub returned malformed JSON", {
          details: [String(raw || "The response was empty.").trim()],
          action: "Run `gh auth status` and try again",
        });
      }

      if (payload.errors?.length) {
        throw new CliError("GitHub GraphQL query failed", {
          details: payload.errors.map(({ message }) => message),
          action: "Check the errors above and try again",
        });
      }
      if (!payload.data || typeof payload.data !== "object") {
        throw new CliError("GitHub response did not include data", {
          action: "Run `gh auth status` and try again",
        });
      }

      return payload.data;
    },
  };
}

export function githubError(error) {
  if (error?.code === "ENOENT") {
    return new CliError("GitHub CLI is required", {
      details: ["Insights queries GitHub with your local `gh` credentials."],
      action: "Install `gh` from https://cli.github.com/ and run `gh auth login`",
      exitCode: 127,
    });
  }

  const detail = String(error?.stderr || error?.message || "Unknown GitHub CLI error")
    .trim()
    .split("\n")[0];
  const authenticationFailed = /auth|credential|HTTP 401|login/i.test(detail);
  return new CliError(
    authenticationFailed ? "GitHub authentication failed" : "GitHub query failed",
    {
      details: detail ? [detail] : [],
      action: authenticationFailed
        ? "Run `gh auth login` and try again"
        : "Check the error above and try again",
    },
  );
}
