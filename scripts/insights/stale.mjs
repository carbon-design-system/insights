import {
  parsePositiveInteger,
  parseRepository,
  readFlagValue,
} from "./args.mjs";
import { CliError, usageError } from "./errors.mjs";

const pageSize = 100;
const searchResultLimit = 1_000;

export const staleCommand = {
  id: "pr-stale",
  group: "pr",
  name: "stale",
  label: "Stale PR review requests",
  description:
    "Find inactive, ready pull requests that still request your review.",
  parse(args, config) {
    const options = {
      days: config.stale.days,
      help: false,
      ignoredAuthors: [...config.stale.ignoredAuthors],
      repository: config.github.repository,
    };
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (arg === "--write" || arg === "--dry") {
        throw usageError(`Insights is read-only; ${arg} is not supported`, {
          action: "Run `yarn insights pr stale --help` for usage",
        });
      } else if (arg === "--help" || arg === "-h") {
        options.help = true;
      } else if (arg === "--days") {
        options.days = parsePositiveInteger(readFlagValue(args, index, arg), arg);
        index += 1;
      } else if (arg.startsWith("--days=")) {
        options.days = parsePositiveInteger(arg.slice("--days=".length), "--days");
      } else if (arg === "--repo" || arg === "-R") {
        options.repository = parseRepository(readFlagValue(args, index, arg), arg);
        index += 1;
      } else if (arg.startsWith("--repo=")) {
        options.repository = parseRepository(arg.slice("--repo=".length));
      } else {
        throw usageError(`Unknown option: ${arg}`, {
          action: "Run `yarn insights pr stale --help` for usage",
        });
      }
    }
    return options;
  },
  help(output, config) {
    output.intro("Stale PR review requests");
    output.detail();
    output.info("Usage: yarn insights pr stale [options]");
    output.detail(`--days <days>       Inactivity threshold (default: ${config.stale.days})`);
    output.detail(`--repo, -R <repo>  Repository (default: ${config.github.repository})`);
    output.detail("--no-color         Disable styled output");
    output.detail("--help, -h         Show help");
    output.detail();
    output.outro("Read-only: this command never changes pull requests");
  },
  async execute({ github, now }, options) {
    const cutoff = staleCutoff(now, options.days);
    const searchQuery = buildStaleSearchQuery(options.repository, cutoff);
    const ignored = new Set(
      options.ignoredAuthors.map((login) => login.toLowerCase()),
    );
    const candidates = [];
    let cursor = null;
    let issueCount;

    do {
      // `@me` in the search query is resolved by GitHub from the active `gh`
      // account; no viewer username is hardcoded in this command.
      const data = await github.query(
        `query StalePullRequests($searchQuery: String!, $cursor: String) {
          search(query: $searchQuery, type: ISSUE, first: ${pageSize}, after: $cursor) {
            issueCount
            pageInfo { hasNextPage endCursor }
            nodes {
              ... on PullRequest {
                author { login }
                number
                title
                updatedAt
                url
              }
            }
          }
        }`,
        { searchQuery, cursor },
      );
      if (
        !data.search ||
        !Number.isInteger(data.search.issueCount) ||
        data.search.issueCount < 0 ||
        !Array.isArray(data.search.nodes)
      ) {
        throw new CliError("GitHub response omitted stale pull request data");
      }
      const nextCursor = nextPageCursor(data.search.pageInfo);
      issueCount ??= data.search.issueCount;
      if (issueCount >= searchResultLimit) {
        throw new CliError(
          `GitHub search matched at least ${searchResultLimit} pull requests`,
          {
            details: ["The stale report would be incomplete."],
            action: "Increase `--days` to narrow the result set",
          },
        );
      }

      candidates.push(
        ...data.search.nodes.filter(
          (pullRequest) =>
            pullRequest &&
            !ignored.has(pullRequest.author?.login?.toLowerCase()),
        ),
      );
      cursor = nextCursor;
    } while (cursor);

    candidates.sort(
      (left, right) => Date.parse(left.updatedAt) - Date.parse(right.updatedAt),
    );
    return {
      candidates,
      cutoff,
      days: options.days,
      repository: options.repository,
      requestCount: github.requestCount,
    };
  },
  render(output, result) {
    output.intro("Stale PR review requests");
    output.detail(`Repository: ${result.repository}`);
    output.detail(
      `Ready PRs awaiting your review and inactive before ${formatDate(result.cutoff)} UTC`,
    );
    output.blank();

    if (result.candidates.length === 0) {
      output.success("No stale pull requests found");
    } else {
      for (const pullRequest of result.candidates) {
        output.info(`#${pullRequest.number} ${pullRequest.title}`);
        output.detail(`Updated: ${formatDate(new Date(pullRequest.updatedAt))} UTC`);
        output.detail(pullRequest.url);
        output.blank();
      }
    }

    output.outro(
      `${formatCount(result.candidates.length, "stale pull request")} · ${formatCount(result.requestCount, "GitHub API request")}`,
    );
  },
};

export function staleCutoff(now, days) {
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  cutoff.setUTCHours(0, 0, 0, 0);
  return cutoff;
}

export function buildStaleSearchQuery(repository, cutoff) {
  return [
    `repo:${repository}`,
    "is:pr",
    "is:open",
    "draft:false",
    "review-requested:@me",
    `updated:<${formatDate(cutoff)}`,
  ].join(" ");
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function formatCount(count, label) {
  return `${count} ${label}${count === 1 ? "" : "s"}`;
}

function nextPageCursor(pageInfo) {
  if (!pageInfo || typeof pageInfo.hasNextPage !== "boolean") {
    throw new CliError("GitHub response omitted stale search pagination data");
  }
  if (
    pageInfo.hasNextPage &&
    (typeof pageInfo.endCursor !== "string" || !pageInfo.endCursor)
  ) {
    throw new CliError("GitHub response omitted the next stale search cursor");
  }
  return pageInfo.hasNextPage ? pageInfo.endCursor : null;
}
