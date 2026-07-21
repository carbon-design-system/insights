import assert from "node:assert/strict";
import test from "node:test";

import { groupIssuesByRepository } from "./group-issues-by-repository.mjs";

function issue(id, repository) {
  return {
    id,
    repository: { full_name: repository },
  };
}

test("puts the monorepo first and sorts the remaining repositories", () => {
  const groups = groupIssuesByRepository([
    issue(1, "carbon-design-system/carbon-website"),
    issue(2, "carbon-design-system/ibm-products"),
    issue(3, "carbon-design-system/carbon"),
    issue(4, "carbon-design-system/carbon-charts"),
    issue(5, "carbon-design-system/carbon"),
  ]);

  assert.deepEqual(
    groups.map(({ name, issues }) => ({
      name,
      issueIds: issues.map(({ id }) => id),
    })),
    [
      {
        name: "carbon-design-system/carbon",
        issueIds: [3, 5],
      },
      {
        name: "carbon-design-system/carbon-charts",
        issueIds: [4],
      },
      {
        name: "carbon-design-system/carbon-website",
        issueIds: [1],
      },
      {
        name: "carbon-design-system/ibm-products",
        issueIds: [2],
      },
    ],
  );
});
