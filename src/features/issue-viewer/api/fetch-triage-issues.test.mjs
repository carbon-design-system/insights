import assert from "node:assert/strict";
import test from "node:test";

import { fetchTriageIssues } from "./fetch-triage-issues.mjs";

const firstUrl =
  "https://api.github.com/orgs/carbon-design-system/projectsV2/39/views/6/items?per_page=100";
const nextUrl =
  "https://api.github.com/organizations/25179978/projectsV2/39/views/6/items?per_page=100&after=next-page";

function jsonResponse(body, link) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: link ? { link } : undefined,
  });
}

function projectItem({
  id,
  state = "open",
  contentType = "Issue",
  repository = "carbon",
}) {
  return {
    content_type: contentType,
    content: {
      id,
      number: id,
      title: `Issue ${id}`,
      html_url: `https://github.com/carbon-design-system/${repository}/issues/${id}`,
      created_at: "2026-07-21T12:00:00Z",
      state,
      repository: {
        name: repository,
        full_name: `carbon-design-system/${repository}`,
      },
    },
  };
}

test("loads every saved-view page and returns only open issue content", async () => {
  const responses = new Map([
    [
      firstUrl,
      () =>
        jsonResponse(
          [
            projectItem({ id: 1 }),
            projectItem({ id: 2, state: "closed" }),
          ],
          `<${nextUrl}>; rel="next"`,
        ),
    ],
    [
      nextUrl,
      () =>
        jsonResponse([
          projectItem({ id: 3, repository: "carbon-website" }),
          projectItem({ id: 4, contentType: "PullRequest" }),
        ]),
    ],
  ]);
  const requestedUrls = [];
  const signal = new AbortController().signal;
  const fetchImpl = async (url, options) => {
    requestedUrls.push(url);
    assert.deepEqual(options, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2026-03-10",
      },
      signal,
    });

    const response = responses.get(url);
    assert.ok(response, `Unexpected request to ${url}`);
    return response();
  };

  const issues = await fetchTriageIssues({ fetchImpl, signal });

  assert.deepEqual(requestedUrls, [firstUrl, nextUrl]);
  assert.deepEqual(
    issues.map(({ id, repository }) => ({
      id,
      repository: repository.full_name,
    })),
    [
      { id: 1, repository: "carbon-design-system/carbon" },
      { id: 3, repository: "carbon-design-system/carbon-website" },
    ],
  );
});

test("reports GitHub HTTP errors", async () => {
  const fetchImpl = async () => new Response(null, { status: 403 });

  await assert.rejects(
    fetchTriageIssues({ fetchImpl }),
    /GitHub API responded with 403/u,
  );
});

test("rejects pagination links outside the GitHub API origin", async () => {
  const fetchImpl = async () =>
    jsonResponse([], '<https://example.com/items>; rel="next"');

  await assert.rejects(
    fetchTriageIssues({ fetchImpl }),
    /unexpected pagination URL/u,
  );
});
