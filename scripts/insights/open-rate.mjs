import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { parseRepository, readFlagValue } from "./args.mjs";
import { CliError, usageError } from "./errors.mjs";

export const defaultOpenRateCachePath = fileURLToPath(
  new URL("../../.cache/open-rate.json", import.meta.url),
);

const cacheVersion = 1;
const currentRangeCacheTtl = 15 * 60 * 1_000;
const historicalRangeCacheTtl = 30 * 24 * 60 * 60 * 1_000;
const searchResultLimit = 1_000;
const periodDefinitions = [
  { label: "2 weeks", weeks: 2 },
  { label: "4 weeks", weeks: 4 },
  { label: "12 weeks", weeks: 12 },
  { label: "1 year", weeks: 52 },
  { label: "2 years", weeks: 104 },
];

export const openRateCommand = {
  id: "pr-open-rate",
  group: "pr",
  name: "open-rate",
  label: "PR open rate",
  description:
    "Compare rolling pull request creation volume with equivalent periods one year earlier.",
  parse(args, config) {
    const options = {
      help: false,
      refresh: false,
      repository: config.github.repository,
    };
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (arg === "--help" || arg === "-h") {
        options.help = true;
      } else if (arg === "--refresh") {
        options.refresh = true;
      } else if (arg === "--repo" || arg === "-R") {
        options.repository = parseRepository(readFlagValue(args, index, arg), arg);
        index += 1;
      } else if (arg.startsWith("--repo=")) {
        options.repository = parseRepository(arg.slice("--repo=".length));
      } else {
        throw usageError(`Unknown option: ${arg}`, {
          action: "Run `yarn insights pr open-rate --help` for usage",
        });
      }
    }
    return options;
  },
  help(output, config) {
    output.intro("PR open rate");
    output.detail();
    output.info("Usage: yarn insights pr open-rate [options]");
    output.detail(`--repo, -R <repo>  Repository (default: ${config.github.repository})`);
    output.detail("--refresh          Ignore cached counts");
    output.detail("--no-color         Disable styled output");
    output.detail("--help, -h         Show help");
    output.detail();
    output.outro("Compare rolling PR volume with the same periods one year ago");
  },
  async execute({ github, now, cachePath = defaultOpenRateCachePath }, options) {
    const periods = createOpenRatePeriods(now);
    const cache = await createFileCache({
      cachePath,
      now,
      refresh: options.refresh,
    });
    const { counts, cacheHitCount } = await countOpenedPullRequests(github, {
      cache,
      periods,
      repository: options.repository,
    });
    let cacheWarning;
    try {
      await cache.save();
    } catch (error) {
      cacheWarning = error.message;
    }

    return {
      repository: options.repository,
      periods: periods.map((period, index) => ({
        ...period,
        currentCount: counts.get(`current${index}`),
        yearAgoCount: counts.get(`yearAgo${index}`),
      })),
      requestCount: github.requestCount,
      cacheHitCount,
      cacheWarning,
    };
  },
  render(output, result) {
    output.intro("PR open rate");
    output.detail(`Repository: ${result.repository}`);
    output.detail(
      `Rolling windows through ${formatDisplayDate(result.periods[0].current.end)} UTC`,
    );
    output.blank();
    output.table(
      ["Period", "Current", "1 year ago", "Change"],
      result.periods.map((period) => [
        period.label,
        formatVolume(period.currentCount, period.weeks),
        formatVolume(period.yearAgoCount, period.weeks),
        describeMultiplier(period.currentCount, period.yearAgoCount),
      ]),
      { rightAlign: [1, 2] },
    );
    output.blank();
    output.success(formatTakeaway(result.periods[0]));
    if (result.cacheWarning) {
      output.warning("Could not write the open-rate cache", [result.cacheWarning]);
    }
    output.blank();
    output.outro(
      `${formatCount(result.requestCount, "GitHub API request")} · ${formatCount(result.cacheHitCount, "cache hit")} · ${result.periods.length * 2} report ranges`,
    );
  },
};

export function createOpenRatePeriods(now) {
  const end = startOfUtcDay(now);
  const yearAgoEnd = shiftCalendarYear(end, -1);
  return periodDefinitions.map(({ label, weeks }) => ({
    label,
    weeks,
    current: createRange(end, weeks),
    yearAgo: createRange(yearAgoEnd, weeks),
  }));
}

export function buildOpenRateSearchQuery(repository, range) {
  return `repo:${repository} is:pr created:${formatSearchDate(range.start)}..${formatSearchDate(range.end)}`;
}

export async function countOpenedPullRequests(
  github,
  { cache = createMemoryCache(), periods, repository },
) {
  // Each period has a current and year-ago range. They start in one queue so
  // uncached counts can be batched into as few GraphQL requests as possible.
  const counts = new Map();
  let cacheHitCount = 0;
  let pending = periods.flatMap((period, index) => [
    { key: `current${index}`, range: period.current },
    { key: `yearAgo${index}`, range: period.yearAgo },
  ]);

  for (const { key } of pending) {
    counts.set(key, 0);
  }

  while (pending.length > 0) {
    const tasks = pending;
    pending = [];
    const uncached = [];

    for (const task of tasks) {
      const query = buildOpenRateSearchQuery(repository, task.range);
      const cachedCount = cache.get(query);
      if (cachedCount === undefined) {
        uncached.push(task);
      } else {
        cacheHitCount += 1;
        recordCount(task, cachedCount);
      }
    }

    if (uncached.length > 0) {
      const { document, variables } = buildCountQuery(repository, uncached);
      const data = await github.query(document, variables);
      uncached.forEach((task, index) => {
        const count = data[`range${index}`]?.issueCount;
        cache.set(buildOpenRateSearchQuery(repository, task.range), count, task.range);
        recordCount(task, count);
      });
    }

    function recordCount(task, count) {
      if (!Number.isInteger(count) || count < 0) {
        throw new CliError(
          `GitHub did not return a valid count for ${formatSearchDate(task.range.start)}..${formatSearchDate(task.range.end)}`,
        );
      }
      if (count >= searchResultLimit) {
        // Search counts at the 1,000-result cap are not exact. Queue two smaller
        // inclusive ranges and add their exact counts to the same report key.
        const split = splitOpenRateRange(task.range);
        if (!split) {
          throw new CliError(
            `GitHub search matched at least ${searchResultLimit} pull requests on ${formatSearchDate(task.range.start)}`,
            { details: ["The open-rate report would be incomplete."] },
          );
        }
        pending.push(
          { key: task.key, range: split[0] },
          { key: task.key, range: split[1] },
        );
      } else {
        counts.set(task.key, counts.get(task.key) + count);
      }
    }
  }

  return { counts, cacheHitCount };
}

export async function createFileCache({
  cachePath = defaultOpenRateCachePath,
  now = new Date(),
  refresh = false,
} = {}) {
  // Current data changes quickly, while historical counts are effectively
  // stable. The two TTLs avoid stale current results and unnecessary API work.
  let entries = await readCacheEntries(cachePath);
  let dirty = false;
  const nowTime = now.getTime();

  return {
    get(query) {
      if (refresh) {
        return undefined;
      }
      const entry = entries[query];
      if (!isValidCacheEntry(entry) || Date.parse(entry.expiresAt) <= nowTime) {
        if (entry) {
          delete entries[query];
          dirty = true;
        }
        return undefined;
      }
      return entry.count;
    },
    set(query, count, range) {
      if (!Number.isInteger(count) || count < 0) {
        return;
      }
      const current = formatSearchDate(range.end) === formatSearchDate(now);
      entries[query] = {
        count,
        cachedAt: now.toISOString(),
        expiresAt: new Date(
          nowTime + (current ? currentRangeCacheTtl : historicalRangeCacheTtl),
        ).toISOString(),
      };
      dirty = true;
    },
    async save() {
      if (!dirty) {
        return;
      }
      entries = { ...(await readCacheEntries(cachePath)), ...entries };
      pruneExpiredEntries(entries, nowTime);
      const temporaryPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
      const payload = `${JSON.stringify({ version: cacheVersion, entries }, null, 2)}\n`;
      await mkdir(dirname(cachePath), { recursive: true });
      try {
        // Rename a complete temporary file so interruption cannot leave a
        // partially written JSON cache behind.
        await writeFile(temporaryPath, payload, "utf8");
        await rename(temporaryPath, cachePath);
      } finally {
        await unlink(temporaryPath).catch(() => {});
      }
      dirty = false;
    },
  };
}

export function createMemoryCache(initialEntries = new Map()) {
  const entries = new Map(initialEntries);
  return {
    get(query) {
      return entries.get(query);
    },
    set(query, count) {
      if (Number.isInteger(count) && count >= 0) {
        entries.set(query, count);
      }
    },
    async save() {},
  };
}

export function splitOpenRateRange(range) {
  const spanInDays = Math.round(
    (range.end.getTime() - range.start.getTime()) / 86_400_000,
  );
  if (spanInDays === 0) {
    return null;
  }
  const leftEnd = addUtcDays(range.start, Math.floor(spanInDays / 2));
  return [
    { start: new Date(range.start), end: leftEnd },
    { start: addUtcDays(leftEnd, 1), end: new Date(range.end) },
  ];
}

export function describeMultiplier(currentCount, yearAgoCount) {
  if (currentCount === 0 && yearAgoCount === 0) {
    return "1.0x · unchanged";
  }
  if (yearAgoCount === 0) {
    return "new · up from 0";
  }
  const multiplier = `${(currentCount / yearAgoCount).toFixed(1)}x`;
  if (currentCount > yearAgoCount) {
    return `${multiplier} · increase`;
  }
  if (currentCount < yearAgoCount) {
    return `${multiplier} · decrease`;
  }
  return `${multiplier} · unchanged`;
}

function buildCountQuery(repository, tasks) {
  const declarations = tasks.map((_, index) => `$range${index}: String!`);
  const fields = tasks.map(
    (_, index) =>
      `range${index}: search(query: $range${index}, type: ISSUE, first: 1) { issueCount }`,
  );
  return {
    document: `query OpenRate(${declarations.join(", ")}) { ${fields.join("\n")} }`,
    variables: Object.fromEntries(
      tasks.map((task, index) => [
        `range${index}`,
        buildOpenRateSearchQuery(repository, task.range),
      ]),
    ),
  };
}

async function readCacheEntries(cachePath) {
  try {
    const payload = JSON.parse(await readFile(cachePath, "utf8"));
    return payload.version === cacheVersion &&
      payload.entries &&
      typeof payload.entries === "object"
      ? payload.entries
      : {};
  } catch {
    return {};
  }
}

function isValidCacheEntry(entry) {
  return Boolean(
    entry &&
      Number.isInteger(entry.count) &&
      entry.count >= 0 &&
      typeof entry.expiresAt === "string" &&
      Number.isFinite(Date.parse(entry.expiresAt)),
  );
}

function pruneExpiredEntries(entries, nowTime) {
  for (const [query, entry] of Object.entries(entries)) {
    if (!isValidCacheEntry(entry) || Date.parse(entry.expiresAt) <= nowTime) {
      delete entries[query];
    }
  }
}

function formatTakeaway(period) {
  if (period.currentCount === 0 && period.yearAgoCount === 0) {
    return "Current 2-week volume is unchanged from this time last year";
  }
  if (period.yearAgoCount === 0) {
    return "Current 2-week volume is up from 0 this time last year";
  }
  return `Current 2-week volume is ${(period.currentCount / period.yearAgoCount).toFixed(1)}x this time last year`;
}

function formatVolume(count, weeks) {
  return `${count.toLocaleString("en-US")} (${(count / weeks).toFixed(1)}/wk)`;
}

function createRange(end, weeks) {
  return { start: addUtcDays(end, -(weeks * 7 - 1)), end: new Date(end) };
}

function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function shiftCalendarYear(date, years) {
  const year = date.getUTCFullYear() + years;
  const month = date.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(date.getUTCDate(), lastDay)));
}

function addUtcDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function formatSearchDate(date) {
  return date.toISOString().slice(0, 10);
}

function formatDisplayDate(date) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatCount(count, label) {
  return `${count} ${label}${count === 1 ? "" : "s"}`;
}
