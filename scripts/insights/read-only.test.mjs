import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const implementationDirectory = new URL("./", import.meta.url);

test("Insights source preserves the read-only GitHub invariant", async () => {
  const filenames = (await readdir(implementationDirectory)).filter(
    (filename) => filename.endsWith(".mjs") && !filename.includes(".test"),
  );
  const sources = await Promise.all(
    filenames.map(async (filename) => [
      filename,
      await readFile(new URL(filename, implementationDirectory), "utf8"),
    ]),
  );

  for (const [filename, source] of sources) {
    assert.doesNotMatch(source, /\bmutation\s+[A-Za-z_]/i, filename);
    assert.doesNotMatch(source, /addComment|convertPullRequestToDraft/i, filename);
    assert.doesNotMatch(source, /requested_reviewers|requestedReviewers/i, filename);
    assert.doesNotMatch(source, /["']--method["']/, filename);
    if (filename !== "github.mjs") {
      assert.doesNotMatch(source, /node:child_process/, filename);
    }
  }
});
