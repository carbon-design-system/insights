import {
  deduplicateLogins,
  parseLogin,
  parseOrganization,
  readFlagValue,
} from "./args.mjs";
import { CliError, usageError } from "./errors.mjs";

const numberOfWeeks = 5;
const pageSize = 100;
const searchResultLimit = 1_000;

export const reviewsCommand = {
  id: "pr-reviews",
  group: "pr",
  name: "reviews",
  label: "PR review report",
  description:
    "Compare submitted review activity across the current UTC week and four previous weeks.",
  parse(args, config) {
    const options = {
      help: false,
      organization: config.github.organization,
      users: [...config.reviews.users],
    };
    const suppliedUsers = [];

    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (arg === "--help" || arg === "-h") {
        options.help = true;
      } else if (arg === "--org") {
        options.organization = parseOrganization(readFlagValue(args, index, arg), arg);
        index += 1;
      } else if (arg.startsWith("--org=")) {
        options.organization = parseOrganization(arg.slice("--org=".length));
      } else if (arg === "--user") {
        suppliedUsers.push(parseLogin(readFlagValue(args, index, arg), arg));
        index += 1;
      } else if (arg.startsWith("--user=")) {
        suppliedUsers.push(parseLogin(arg.slice("--user=".length)));
      } else {
        throw usageError(`Unknown option: ${arg}`, {
          action: "Run `yarn insights pr reviews --help` for usage",
        });
      }
    }

    if (suppliedUsers.length > 0) {
      options.users = deduplicateLogins(suppliedUsers);
    }
    return options;
  },
  help(output, config) {
    output.intro("PR review report");
    output.detail();
    output.info("Usage: yarn insights pr reviews [options]");
    output.detail(`--org <org>      Organization (default: ${config.github.organization})`);
    output.detail("--user <login>  Replace the configured roster; repeatable");
    output.detail("--no-color      Disable styled output");
    output.detail("--help, -h      Show help");
    output.detail();
    output.outro("Report the current UTC week and four preceding weeks");
  },
  async execute({ github, now }, options) {
    // Weeks are current-first because that is how the table is rendered. The
    // current week ends at `now`; the other four are complete UTC weeks.
    const weeks = createReviewWeeks(now);
    const reportStart = weeks.at(-1).start;
    const reportEnd = weeks[0].end;
    const counts = new Map(
      options.users.map((username) => [
        username.toLowerCase(),
        Array(numberOfWeeks).fill(0),
      ]),
    );
    const displayNames = new Map(
      options.users.map((username) => [username.toLowerCase(), username]),
    );
    const countedReviewIds = new Set();
    const scannedPullRequestIds = new Set();

    await countSearchRange(formatSearchDate(reportStart), formatSearchDate(reportEnd));

    return {
      organization: options.organization,
      weeks,
      rows: [...counts.entries()].map(([username, weeklyCounts]) => [
        displayNames.get(username),
        ...weeklyCounts.map(String),
      ]),
      requestCount: github.requestCount,
      scannedPullRequests: scannedPullRequestIds.size,
      countedReviews: countedReviewIds.size,
    };

    async function countSearchRange(start, end) {
      const searchQuery = buildReviewSearchQuery(options.organization, start, end);
      const firstPage = await fetchPullRequestReviewPage(searchQuery);

      if (firstPage.search.issueCount >= searchResultLimit) {
        // GitHub search exposes at most 1,000 results. Split by date until every
        // query is below the cap rather than silently reporting partial data.
        const split = splitSearchRange(start, end);
        if (!split) {
          throw new CliError(
            `GitHub search matched at least ${searchResultLimit} pull requests on ${start}`,
            {
              details: ["The review report would be incomplete."],
              action: "Try again later or narrow the configured organization",
            },
          );
        }
        await countSearchRange(split[0].start, split[0].end);
        await countSearchRange(split[1].start, split[1].end);
        return;
      }

      await countSearchResults(searchQuery, firstPage);
    }

    async function countSearchResults(searchQuery, firstPage) {
      let pageData = firstPage;
      let cursor = null;

      do {
        pageData ??= await fetchPullRequestReviewPage(searchQuery, cursor);
        const page = pageData.search;
        for (const pullRequest of page.nodes) {
          if (!pullRequest?.id) {
            continue;
          }
          scannedPullRequestIds.add(pullRequest.id);
          await countReviews(pullRequest);
        }
        cursor = nextPageCursor(page.pageInfo, "review search");
        pageData = null;
      } while (cursor);
    }

    async function countReviews(pullRequest) {
      let timelineItems = validateTimelineItems(pullRequest.timelineItems);
      countReviewNodes(timelineItems.nodes);
      let cursor = nextPageCursor(timelineItems.pageInfo, "review timeline");

      while (cursor) {
        const data = await github.query(
          `query MorePullRequestReviews($pullRequestId: ID!, $cursor: String!, $start: DateTime!) {
            node(id: $pullRequestId) {
              ... on PullRequest {
                timelineItems(first: ${pageSize}, after: $cursor, since: $start, itemTypes: [PULL_REQUEST_REVIEW]) {
                  pageInfo { hasNextPage endCursor }
                  nodes {
                    ... on PullRequestReview { id author { login } submittedAt }
                  }
                }
              }
            }
          }`,
          {
            pullRequestId: pullRequest.id,
            cursor,
            start: reportStart.toISOString(),
          },
        );
        timelineItems = validateTimelineItems(data.node?.timelineItems);
        countReviewNodes(timelineItems.nodes);
        cursor = nextPageCursor(timelineItems.pageInfo, "review timeline");
      }
    }

    function countReviewNodes(reviews) {
      for (const review of reviews) {
        if (!review?.id) {
          continue;
        }
        const username = review.author?.login?.toLowerCase();
        const submittedAt = review.submittedAt ? new Date(review.submittedAt) : null;
        const weekIndex = submittedAt ? findReviewWeekIndex(submittedAt, weeks) : -1;
        if (
          username &&
          counts.has(username) &&
          weekIndex !== -1 &&
          !countedReviewIds.has(review.id)
        ) {
          // A review can appear again while paging or splitting search ranges.
          // Its GraphQL ID is stable, so it is the safest deduplication key.
          countedReviewIds.add(review.id);
          counts.get(username)[weekIndex] += 1;
        }
      }
    }

    async function fetchPullRequestReviewPage(searchQuery, cursor = null) {
      const data = await github.query(
        `query PullRequestReviews($searchQuery: String!, $cursor: String, $start: DateTime!) {
          search(query: $searchQuery, type: ISSUE, first: ${pageSize}, after: $cursor) {
            issueCount
            pageInfo { hasNextPage endCursor }
            nodes {
              ... on PullRequest {
                id
                timelineItems(first: ${pageSize}, since: $start, itemTypes: [PULL_REQUEST_REVIEW]) {
                  pageInfo { hasNextPage endCursor }
                  nodes {
                    ... on PullRequestReview { id author { login } submittedAt }
                  }
                }
              }
            }
          }
        }`,
        { searchQuery, cursor, start: reportStart.toISOString() },
      );
      if (
        !data.search ||
        !Number.isInteger(data.search.issueCount) ||
        data.search.issueCount < 0 ||
        !Array.isArray(data.search.nodes)
      ) {
        throw new CliError("GitHub response omitted review search data");
      }
      nextPageCursor(data.search.pageInfo, "review search");
      return data;
    }
  },
  render(output, result) {
    output.intro("PR review report");
    output.detail(`Organization: ${result.organization}`);
    output.detail("Weeks: Sunday–Saturday in UTC; the current week is partial");
    output.blank();
    output.table(
      ["Person", ...result.weeks.map(formatWeekLabel)],
      result.rows,
      { rightAlign: [1, 2, 3, 4, 5] },
    );
    output.blank();
    output.outro(
      `${formatCount(result.requestCount, "GraphQL request")} · ${formatCount(result.scannedPullRequests, "PR")} scanned · ${formatCount(result.countedReviews, "matching review")}`,
    );
  },
};

export function createReviewWeeks(now) {
  const currentWeekStart = startOfUtcDay(now);
  currentWeekStart.setUTCDate(
    currentWeekStart.getUTCDate() - currentWeekStart.getUTCDay(),
  );

  return Array.from({ length: numberOfWeeks }, (_, index) => {
    const start = addUtcDays(currentWeekStart, -index * 7);
    if (index === 0) {
      return { start, end: new Date(now), current: true };
    }
    const end = addUtcDays(start, 6);
    end.setUTCHours(23, 59, 59, 999);
    return { start, end, current: false };
  });
}

export function findReviewWeekIndex(date, weeks) {
  return weeks.findIndex(({ start, end }) => date >= start && date <= end);
}

export function buildReviewSearchQuery(organization, start, end) {
  return `org:${organization} type:pr updated:${start}..${end}`;
}

export function splitSearchRange(start, end) {
  if (start === end) {
    return null;
  }
  const startDate = new Date(`${start}T00:00:00.000Z`);
  const endDate = new Date(`${end}T00:00:00.000Z`);
  const spanInDays = Math.floor((endDate - startDate) / 86_400_000);
  const leftEnd = addUtcDays(startDate, Math.floor(spanInDays / 2));
  const rightStart = addUtcDays(leftEnd, 1);
  return [
    { start, end: formatSearchDate(leftEnd) },
    { start: formatSearchDate(rightStart), end },
  ];
}

function formatWeekLabel({ start, end, current }) {
  const startLabel = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(start);
  const endLabel = new Intl.DateTimeFormat("en-US", {
    month: start.getUTCMonth() === end.getUTCMonth() ? undefined : "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(end);
  return `${startLabel}–${endLabel}${current ? " (current)" : ""}`;
}

function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function formatSearchDate(date) {
  return date.toISOString().slice(0, 10);
}

function formatCount(count, label) {
  return `${count} ${label}${count === 1 ? "" : "s"}`;
}

function validateTimelineItems(timelineItems) {
  if (!timelineItems || !Array.isArray(timelineItems.nodes)) {
    throw new CliError("GitHub response omitted review timeline data");
  }
  nextPageCursor(timelineItems.pageInfo, "review timeline");
  return timelineItems;
}

function nextPageCursor(pageInfo, label) {
  if (!pageInfo || typeof pageInfo.hasNextPage !== "boolean") {
    throw new CliError(`GitHub response omitted ${label} pagination data`);
  }
  if (
    pageInfo.hasNextPage &&
    (typeof pageInfo.endCursor !== "string" || !pageInfo.endCursor)
  ) {
    throw new CliError(`GitHub response omitted the next ${label} cursor`);
  }
  return pageInfo.hasNextPage ? pageInfo.endCursor : null;
}
