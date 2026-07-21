const apiVersion = "2026-03-10";
const apiOrigin = "https://api.github.com";
const organization = "carbon-design-system";
const projectNumber = 39;
const triageViewNumber = 6;

// The saved view owns the triage filter, keeping project configuration out of the client.
const initialUrl = `${apiOrigin}/orgs/${organization}/projectsV2/${projectNumber}/views/${triageViewNumber}/items?per_page=100`;

const requestHeaders = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": apiVersion,
};

function getNextPageUrl(linkHeader) {
  if (!linkHeader) {
    return null;
  }

  const nextLink = linkHeader
    .split(",")
    .find((link) => /;\s*rel="next"\s*$/u.test(link));
  const nextUrl = nextLink?.match(/<([^>]+)>/u)?.[1] ?? null;

  if (nextUrl && new URL(nextUrl).origin !== apiOrigin) {
    throw new Error("GitHub returned an unexpected pagination URL");
  }

  return nextUrl;
}

export async function fetchTriageIssues({
  fetchImpl = fetch,
  signal,
} = {}) {
  const issues = [];
  const visitedUrls = new Set();
  let url = initialUrl;

  while (url) {
    if (visitedUrls.has(url)) {
      throw new Error("GitHub returned invalid Project view pagination data");
    }

    visitedUrls.add(url);

    const response = await fetchImpl(url, {
      headers: requestHeaders,
      signal,
    });

    if (!response.ok) {
      throw new Error(`GitHub API responded with ${response.status}`);
    }

    const items = await response.json();

    if (!Array.isArray(items)) {
      throw new Error("GitHub API returned an unexpected response");
    }

    for (const item of items) {
      if (
        item.content_type === "Issue" &&
        item.content?.state === "open" &&
        item.content.repository?.full_name
      ) {
        issues.push(item.content);
      }
    }

    url = getNextPageUrl(response.headers.get("link"));
  }

  return issues;
}
