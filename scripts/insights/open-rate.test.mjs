import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildOpenRateSearchQuery,
  countOpenedPullRequests,
  createFileCache,
  createMemoryCache,
  createOpenRatePeriods,
  describeMultiplier,
  openRateCommand,
  splitOpenRateRange,
} from "./open-rate.mjs";
import { createCliOutput } from "./output.mjs";
import { CaptureStream, testConfig } from "./test-helpers.mjs";

function fakeGitHub(responses) {
  let requestCount = 0;
  return {
    get requestCount() {
      return requestCount;
    },
    async query(document, variables) {
      requestCount += 1;
      return typeof responses === "function"
        ? responses(document, variables, requestCount)
        : responses.shift();
    },
  };
}

test("open-rate options support repository override and refresh", () => {
  assert.deepEqual(
    openRateCommand.parse(["-R", "example/project", "--refresh"], testConfig()),
    {
      help: false,
      refresh: true,
      repository: "example/project",
    },
  );
  assert.throws(
    () => openRateCommand.parse(["--repo", "invalid"], testConfig()),
    { exitCode: 2 },
  );
  assert.throws(() => openRateCommand.parse(["--dry"], testConfig()), {
    exitCode: 2,
  });
});

test("open-rate periods use rolling UTC windows and calendar-year comparisons", () => {
  const periods = createOpenRatePeriods(new Date("2024-02-29T18:30:00.000Z"));

  assert.deepEqual(
    periods.map(({ label, weeks }) => [label, weeks]),
    [
      ["2 weeks", 2],
      ["4 weeks", 4],
      ["12 weeks", 12],
      ["1 year", 52],
      ["2 years", 104],
    ],
  );
  assert.equal(periods[0].current.start.toISOString(), "2024-02-16T00:00:00.000Z");
  assert.equal(periods[0].current.end.toISOString(), "2024-02-29T00:00:00.000Z");
  assert.equal(periods[0].yearAgo.start.toISOString(), "2023-02-15T00:00:00.000Z");
  assert.equal(periods[0].yearAgo.end.toISOString(), "2023-02-28T00:00:00.000Z");
  assert.equal(
    buildOpenRateSearchQuery("example/project", periods[0].current),
    "repo:example/project is:pr created:2024-02-16..2024-02-29",
  );
});

test("open-rate splitting preserves every inclusive date exactly once", () => {
  const range = {
    start: new Date("2026-07-01T00:00:00.000Z"),
    end: new Date("2026-07-04T00:00:00.000Z"),
  };

  assert.deepEqual(
    splitOpenRateRange(range).map(({ start, end }) => [
      start.toISOString().slice(0, 10),
      end.toISOString().slice(0, 10),
    ]),
    [
      ["2026-07-01", "2026-07-02"],
      ["2026-07-03", "2026-07-04"],
    ],
  );
  assert.equal(splitOpenRateRange({ start: range.start, end: range.start }), null);
});

test("open-rate batches all report ranges and recursively splits capped searches", async () => {
  const periods = createOpenRatePeriods(new Date("2026-07-16T12:00:00.000Z"));
  const calls = [];
  const responses = [
    Object.fromEntries(
      Array.from({ length: 10 }, (_, index) => [
        `range${index}`,
        { issueCount: index === 0 ? 1_000 : index + 10 },
      ]),
    ),
    { range0: { issueCount: 600 }, range1: { issueCount: 350 } },
  ];
  const github = fakeGitHub((document, variables) => {
    calls.push({ document, variables });
    return responses.shift();
  });

  const { counts, cacheHitCount } = await countOpenedPullRequests(github, {
    periods,
    repository: "example/project",
  });

  assert.equal(counts.get("current0"), 950);
  assert.equal(counts.get("yearAgo0"), 11);
  assert.equal(github.requestCount, 2);
  assert.equal(cacheHitCount, 0);
  assert.match(calls[0].document, /range9: search/);
  assert.match(calls[0].variables.range0, /repo:example\/project is:pr created:/);
});

test("open-rate reuses cached query counts without GitHub requests", async () => {
  const periods = createOpenRatePeriods(
    new Date("2026-07-16T12:00:00.000Z"),
  ).slice(0, 1);
  const cache = createMemoryCache();
  const firstGitHub = fakeGitHub([
    { range0: { issueCount: 34 }, range1: { issueCount: 10 } },
  ]);
  await countOpenedPullRequests(firstGitHub, {
    cache,
    periods,
    repository: "example/project",
  });

  const cachedGitHub = fakeGitHub(() => {
    throw new Error("GitHub should not be called");
  });
  const result = await countOpenedPullRequests(cachedGitHub, {
    cache,
    periods,
    repository: "example/project",
  });

  assert.equal(result.counts.get("current0"), 34);
  assert.equal(result.counts.get("yearAgo0"), 10);
  assert.equal(cachedGitHub.requestCount, 0);
  assert.equal(result.cacheHitCount, 2);
});

test("open-rate cache recovers from malformed data and applies both TTLs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "insights-open-rate-"));
  const cachePath = join(directory, "open-rate.json");
  const now = new Date("2026-07-16T12:00:00.000Z");
  const currentRange = {
    start: new Date("2026-07-03T00:00:00.000Z"),
    end: new Date("2026-07-16T00:00:00.000Z"),
  };
  const historicalRange = {
    start: new Date("2025-07-03T00:00:00.000Z"),
    end: new Date("2025-07-16T00:00:00.000Z"),
  };

  try {
    await writeFile(cachePath, "{malformed", "utf8");
    const cache = await createFileCache({ cachePath, now });
    cache.set("current", 34, currentRange);
    cache.set("historical", 10, historicalRange);
    await cache.save();

    const payload = JSON.parse(await readFile(cachePath, "utf8"));
    assert.equal(payload.version, 1);
    assert.equal(payload.entries.current.count, 34);
    assert.equal(payload.entries.historical.count, 10);

    const afterCurrentTtl = await createFileCache({
      cachePath,
      now: new Date("2026-07-16T12:16:00.000Z"),
    });
    assert.equal(afterCurrentTtl.get("current"), undefined);
    assert.equal(afterCurrentTtl.get("historical"), 10);

    const afterHistoricalTtl = await createFileCache({
      cachePath,
      now: new Date("2026-08-16T12:00:01.000Z"),
    });
    assert.equal(afterHistoricalTtl.get("historical"), undefined);

    const refresh = await createFileCache({ cachePath, now, refresh: true });
    assert.equal(refresh.get("historical"), undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("open-rate rejects malformed counts and a capped single day", async () => {
  const periods = createOpenRatePeriods(
    new Date("2026-07-16T12:00:00.000Z"),
  ).slice(0, 1);
  await assert.rejects(
    countOpenedPullRequests(fakeGitHub([{}]), {
      periods,
      repository: "example/project",
    }),
    /did not return a valid count/,
  );

  const singleDay = [
    {
      label: "day",
      weeks: 1,
      current: {
        start: new Date("2026-07-16T00:00:00.000Z"),
        end: new Date("2026-07-16T00:00:00.000Z"),
      },
      yearAgo: {
        start: new Date("2025-07-16T00:00:00.000Z"),
        end: new Date("2025-07-16T00:00:00.000Z"),
      },
    },
  ];
  await assert.rejects(
    countOpenedPullRequests(
      fakeGitHub([{ range0: { issueCount: 1_000 }, range1: { issueCount: 0 } }]),
      { periods: singleDay, repository: "example/project" },
    ),
    /at least 1000 pull requests on 2026-07-16/,
  );
});

test("open-rate describes year-over-year multipliers", () => {
  assert.equal(describeMultiplier(34, 10), "3.4x · increase");
  assert.equal(describeMultiplier(7, 10), "0.7x · decrease");
  assert.equal(describeMultiplier(10, 10), "1.0x · unchanged");
  assert.equal(describeMultiplier(0, 0), "1.0x · unchanged");
  assert.equal(describeMultiplier(3, 0), "new · up from 0");
});

test("open-rate rendering includes weekly rates, takeaway, and execution totals", () => {
  const periods = createOpenRatePeriods(
    new Date("2026-07-16T12:00:00.000Z"),
  ).map((period, index) => ({
    ...period,
    currentCount: [34, 60, 150, 600, 1_100][index],
    yearAgoCount: [10, 80, 150, 500, 1_000][index],
  }));
  const stdout = new CaptureStream();
  const output = createCliOutput({ stdout, stderr: new CaptureStream() });

  openRateCommand.render(output, {
    repository: "example/project",
    periods,
    requestCount: 1,
    cacheHitCount: 4,
  });

  assert.match(stdout.read(), /2 weeks\s+\|\s+34 \(17\.0\/wk\)/);
  assert.match(stdout.read(), /3\.4x · increase/);
  assert.match(stdout.read(), /Current 2-week volume is 3\.4x this time last year/);
  assert.match(stdout.read(), /1 GitHub API request · 4 cache hits · 10 report ranges/);
});

test("open-rate cache write failures are warnings rather than command failures", async () => {
  const directory = await mkdtemp(join(tmpdir(), "insights-open-rate-warning-"));
  const blockedParent = join(directory, "not-a-directory");
  try {
    await writeFile(blockedParent, "file", "utf8");
    const github = fakeGitHub([
      Object.fromEntries(
        Array.from({ length: 10 }, (_, index) => [
          `range${index}`,
          { issueCount: index },
        ]),
      ),
    ]);
    const result = await openRateCommand.execute(
      {
        github,
        now: new Date("2026-07-16T12:00:00.000Z"),
        cachePath: join(blockedParent, "open-rate.json"),
      },
      openRateCommand.parse([], testConfig()),
    );

    assert.match(result.cacheWarning, /EEXIST|ENOTDIR|not a directory/i);
    assert.equal(result.requestCount, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
