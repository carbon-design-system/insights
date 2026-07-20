import assert from "node:assert/strict";
import test from "node:test";

import { createCliOutput } from "./output.mjs";
import {
  buildStaleSearchQuery,
  staleCommand,
  staleCutoff,
} from "./stale.mjs";
import { CaptureStream, testConfig } from "./test-helpers.mjs";

function fakeGitHub(responses) {
  let requestCount = 0;
  return {
    get requestCount() {
      return requestCount;
    },
    async query() {
      requestCount += 1;
      return responses.shift();
    },
  };
}

function pullRequest(number, author, updatedAt) {
  return {
    author: { login: author },
    number,
    title: `Pull request ${number}`,
    updatedAt,
    url: `https://github.com/example/project/pull/${number}`,
  };
}

function searchPage({ issueCount = 1, nodes = [], nextCursor = null } = {}) {
  return {
    search: {
      issueCount,
      nodes,
      pageInfo: {
        endCursor: nextCursor,
        hasNextPage: Boolean(nextCursor),
      },
    },
  };
}

test("stale options apply config defaults and invocation overrides", () => {
  assert.deepEqual(staleCommand.parse([], testConfig()), {
    days: 14,
    help: false,
    ignoredAuthors: ["dependabot", "renovate"],
    repository: "carbon-design-system/carbon",
  });
  assert.deepEqual(
    staleCommand.parse(["--days=21", "-R", "example/project"], testConfig()),
    {
      days: 21,
      help: false,
      ignoredAuthors: ["dependabot", "renovate"],
      repository: "example/project",
    },
  );
});

test("stale rejects invalid options and all mutation-oriented flags", () => {
  assert.throws(() => staleCommand.parse(["--days", "0"], testConfig()), {
    exitCode: 2,
  });
  assert.throws(() => staleCommand.parse(["--repo", "invalid"], testConfig()), {
    exitCode: 2,
  });
  assert.throws(() => staleCommand.parse(["--write"], testConfig()), {
    exitCode: 2,
    message: /read-only/,
  });
  assert.throws(() => staleCommand.parse(["--dry"], testConfig()), {
    exitCode: 2,
    message: /read-only/,
  });
});

test("stale cutoff starts at the UTC calendar day boundary", () => {
  const cutoff = staleCutoff(new Date("2026-07-13T18:30:00.000Z"), 14);

  assert.equal(cutoff.toISOString(), "2026-06-29T00:00:00.000Z");
  assert.equal(
    buildStaleSearchQuery("example/project", cutoff),
    "repo:example/project is:pr is:open draft:false review-requested:@me updated:<2026-06-29",
  );
});

test("stale discovery paginates, filters bots case-insensitively, and sorts oldest first", async () => {
  const github = fakeGitHub([
    searchPage({
      issueCount: 4,
      nextCursor: "page-2",
      nodes: [
        pullRequest(12, "human", "2026-06-20T00:00:00.000Z"),
        pullRequest(23, "Dependabot", "2026-05-01T00:00:00.000Z"),
      ],
    }),
    searchPage({
      issueCount: 4,
      nodes: [
        pullRequest(34, "another-human", "2026-06-01T00:00:00.000Z"),
        pullRequest(45, "RENOVATE", "2026-04-01T00:00:00.000Z"),
      ],
    }),
  ]);

  const result = await staleCommand.execute(
    { github, now: new Date("2026-07-13T18:30:00.000Z") },
    staleCommand.parse(["-R", "example/project"], testConfig()),
  );

  assert.deepEqual(result.candidates.map(({ number }) => number), [34, 12]);
  assert.equal(result.requestCount, 2);
  assert.equal(result.days, 14);
  assert.equal(result.cutoff.toISOString(), "2026-06-29T00:00:00.000Z");
});

test("stale discovery refuses GitHub's search cap", async () => {
  const github = fakeGitHub([searchPage({ issueCount: 1_000 })]);

  await assert.rejects(
    staleCommand.execute(
      { github, now: new Date("2026-07-13T18:30:00.000Z") },
      staleCommand.parse([], testConfig()),
    ),
    (error) =>
      error.message.includes("at least 1000") &&
      error.action.includes("Increase `--days`"),
  );
});

test("stale discovery refuses incomplete pagination metadata", async () => {
  const github = fakeGitHub([
    {
      search: {
        issueCount: 1,
        nodes: [],
        pageInfo: { hasNextPage: true, endCursor: null },
      },
    },
  ]);

  await assert.rejects(
    staleCommand.execute(
      { github, now: new Date("2026-07-13T18:30:00.000Z") },
      staleCommand.parse([], testConfig()),
    ),
    /next stale search cursor/,
  );
});

test("stale output contains identifiers, dates, links, and report totals", () => {
  const stdout = new CaptureStream();
  const output = createCliOutput({ stdout, stderr: new CaptureStream() });
  staleCommand.render(output, {
    candidates: [
      pullRequest(34, "human", "2026-06-01T12:00:00.000Z"),
    ],
    cutoff: new Date("2026-06-29T00:00:00.000Z"),
    days: 14,
    repository: "example/project",
    requestCount: 2,
  });

  assert.match(stdout.read(), /#34 Pull request 34/);
  assert.match(stdout.read(), /Updated: 2026-06-01 UTC/);
  assert.match(stdout.read(), /https:\/\/github.com\/example\/project\/pull\/34/);
  assert.match(stdout.read(), /1 stale pull request · 2 GitHub API requests/);
});

test("stale output explains an empty result", () => {
  const stdout = new CaptureStream();
  const output = createCliOutput({ stdout, stderr: new CaptureStream() });
  staleCommand.render(output, {
    candidates: [],
    cutoff: new Date("2026-06-29T00:00:00.000Z"),
    days: 14,
    repository: "example/project",
    requestCount: 1,
  });

  assert.match(stdout.read(), /No stale pull requests found/);
  assert.match(stdout.read(), /0 stale pull requests · 1 GitHub API request/);
});
