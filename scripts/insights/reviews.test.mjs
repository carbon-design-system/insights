import assert from "node:assert/strict";
import test from "node:test";

import { createCliOutput } from "./output.mjs";
import {
  buildReviewSearchQuery,
  createReviewWeeks,
  findReviewWeekIndex,
  reviewsCommand,
  splitSearchRange,
} from "./reviews.mjs";
import { CaptureStream, testConfig } from "./test-helpers.mjs";

function fakeGitHub(respond) {
  let requestCount = 0;
  return {
    get requestCount() {
      return requestCount;
    },
    async query(document, variables) {
      requestCount += 1;
      return respond(document, variables, requestCount);
    },
  };
}

function searchPage({ issueCount = 0, nodes = [], nextCursor = null } = {}) {
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

function pullRequest(id, reviews, nextCursor = null) {
  return {
    id,
    timelineItems: {
      nodes: reviews,
      pageInfo: {
        endCursor: nextCursor,
        hasNextPage: Boolean(nextCursor),
      },
    },
  };
}

function review(id, login, submittedAt) {
  return { id, author: { login }, submittedAt };
}

test("review options use config defaults and supplied users replace the roster", () => {
  const defaults = reviewsCommand.parse([], testConfig());
  assert.deepEqual(defaults.users, ["alice", "bob"]);
  assert.equal(defaults.organization, "carbon-design-system");

  const overrides = reviewsCommand.parse(
    ["--org", "example", "--user", "Taylor", "--user=taylor", "--user", "Sam"],
    testConfig(),
  );
  assert.equal(overrides.organization, "example");
  assert.deepEqual(overrides.users, ["Taylor", "Sam"]);
});

test("review options reject invalid organizations, users, and unknown flags", () => {
  assert.throws(() => reviewsCommand.parse(["--org", "bad/org"], testConfig()), {
    exitCode: 2,
  });
  assert.throws(() => reviewsCommand.parse(["--user", "bad user"], testConfig()), {
    exitCode: 2,
  });
  assert.throws(() => reviewsCommand.parse(["--write"], testConfig()), {
    exitCode: 2,
  });
});

test("review weeks are current-first UTC Sunday through Saturday windows", () => {
  const now = new Date("2026-07-15T18:20:00.000Z");
  const weeks = createReviewWeeks(now);

  assert.equal(weeks.length, 5);
  assert.equal(weeks[0].start.toISOString(), "2026-07-12T00:00:00.000Z");
  assert.equal(weeks[0].end.toISOString(), now.toISOString());
  assert.equal(weeks[1].start.toISOString(), "2026-07-05T00:00:00.000Z");
  assert.equal(weeks[1].end.toISOString(), "2026-07-11T23:59:59.999Z");
  assert.equal(
    findReviewWeekIndex(new Date("2026-07-11T23:59:59.999Z"), weeks),
    1,
  );
  assert.equal(
    findReviewWeekIndex(new Date("2026-06-01T00:00:00.000Z"), weeks),
    -1,
  );
});

test("review search ranges split into adjacent UTC date intervals", () => {
  assert.deepEqual(splitSearchRange("2026-06-14", "2026-07-15"), [
    { start: "2026-06-14", end: "2026-06-29" },
    { start: "2026-06-30", end: "2026-07-15" },
  ]);
  assert.equal(splitSearchRange("2026-07-15", "2026-07-15"), null);
  assert.equal(
    buildReviewSearchQuery("example", "2026-07-01", "2026-07-15"),
    "org:example type:pr updated:2026-07-01..2026-07-15",
  );
});

test("the review report paginates PRs and timelines and deduplicates reviews", async () => {
  const responses = [
    searchPage({
      issueCount: 101,
      nextCursor: "pr-page-2",
      nodes: [
        pullRequest(
          "PR-1",
          [review("review-1", "ALICE", "2026-07-14T12:00:00.000Z")],
          "review-page-2",
        ),
      ],
    }),
    {
      node: {
        timelineItems: {
          nodes: [
            review("review-1", "alice", "2026-07-14T12:00:00.000Z"),
            review("review-2", "bob", "2026-07-10T12:00:00.000Z"),
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    },
    searchPage({
      issueCount: 101,
      nodes: [
        pullRequest("PR-2", [
          review("review-3", "alice", "2026-07-10T09:00:00.000Z"),
          review("review-4", "someone-else", "2026-07-14T09:00:00.000Z"),
        ]),
      ],
    }),
  ];
  const github = fakeGitHub(() => responses.shift());

  const result = await reviewsCommand.execute(
    { github, now: new Date("2026-07-15T18:20:00.000Z") },
    reviewsCommand.parse([], testConfig()),
  );

  assert.deepEqual(result.rows, [
    ["alice", "1", "1", "0", "0", "0"],
    ["bob", "0", "1", "0", "0", "0"],
  ]);
  assert.equal(result.requestCount, 3);
  assert.equal(result.scannedPullRequests, 2);
  assert.equal(result.countedReviews, 3);
});

test("the review report recursively splits capped search ranges", async () => {
  const rootRange = "updated:2026-06-14..2026-07-15";
  const github = fakeGitHub((_document, variables) =>
    searchPage({ issueCount: variables.searchQuery.includes(rootRange) ? 1_000 : 0 }),
  );

  const result = await reviewsCommand.execute(
    { github, now: new Date("2026-07-15T18:20:00.000Z") },
    reviewsCommand.parse([], testConfig()),
  );

  assert.equal(result.requestCount, 3);
  assert.equal(result.scannedPullRequests, 0);
});

test("the review report refuses a capped single UTC day", async () => {
  const github = fakeGitHub(() => searchPage({ issueCount: 1_000 }));

  await assert.rejects(
    reviewsCommand.execute(
      { github, now: new Date("2026-07-15T18:20:00.000Z") },
      reviewsCommand.parse([], testConfig()),
    ),
    /at least 1000 pull requests on/,
  );
});

test("the review report refuses incomplete pagination metadata", async () => {
  const github = fakeGitHub(() => ({
    search: {
      issueCount: 1,
      nodes: [],
      pageInfo: { hasNextPage: true, endCursor: null },
    },
  }));

  await assert.rejects(
    reviewsCommand.execute(
      { github, now: new Date("2026-07-15T18:20:00.000Z") },
      reviewsCommand.parse([], testConfig()),
    ),
    /next review search cursor/,
  );
});

test("review rendering explains scope and includes request totals", () => {
  const stdout = new CaptureStream();
  const output = createCliOutput({ stdout, stderr: new CaptureStream() });
  reviewsCommand.render(output, {
    organization: "example",
    weeks: createReviewWeeks(new Date("2026-07-15T18:20:00.000Z")),
    rows: [["alice", "1", "2", "3", "4", "5"]],
    requestCount: 2,
    scannedPullRequests: 4,
    countedReviews: 15,
  });

  assert.match(stdout.read(), /Weeks: Sunday–Saturday in UTC/);
  assert.match(stdout.read(), /Alice|alice/);
  assert.match(stdout.read(), /2 GraphQL requests · 4 PRs scanned · 15 matching reviews/);
});
