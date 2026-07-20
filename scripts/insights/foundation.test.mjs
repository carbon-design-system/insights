import assert from "node:assert/strict";
import test from "node:test";

import { extractGlobalOptions } from "./args.mjs";
import {
  commandRegistry,
  resolveCommand,
  runCli,
  selectInsight,
} from "./cli.mjs";
import { loadConfig, validateConfig } from "./config.mjs";
import { issueCountCommand, prCountCommand } from "./count.mjs";
import { createGitHubClient } from "./github.mjs";
import { createCliOutput, renderTable } from "./output.mjs";
import {
  CaptureStream,
  graphqlResponse,
  TestInput,
  testConfig,
} from "./test-helpers.mjs";

test("configuration loads and returns an independent validated value", async () => {
  const source = JSON.stringify(testConfig());
  const first = await loadConfig({ read: async () => source });
  const second = await loadConfig({ read: async () => source });

  first.reviews.users.push("charlie");
  assert.deepEqual(second, testConfig());
});

test("configuration validation reports every invalid field with exit code 1", () => {
  assert.throws(
    () =>
      validateConfig({
        github: { organization: "bad/org", repository: "invalid" },
        reviews: { users: ["same", "SAME"] },
        stale: { days: 0, ignoredAuthors: ["not a login"] },
      }),
    (error) => {
      assert.equal(error.exitCode, 1);
      assert.equal(error.details.length, 5);
      return true;
    },
  );
});

test("configuration read and JSON failures are normalized", async () => {
  await assert.rejects(
    loadConfig({
      read: async () => {
        throw new Error("not found");
      },
    }),
    /Unable to read Insights configuration/,
  );
  await assert.rejects(
    loadConfig({ read: async () => "{" }),
    /not valid JSON/,
  );
});

test("global no-color is accepted before or after a command", () => {
  assert.deepEqual(extractGlobalOptions(["--no-color", "pr"]), {
    args: ["pr"],
    noColor: true,
  });
  assert.deepEqual(extractGlobalOptions(["pr", "count", "--no-color"]), {
    args: ["pr", "count"],
    noColor: true,
  });
});

test("the router supports aliases, hierarchy, and scoped help", () => {
  assert.equal(resolveCommand(["pr"]).command.id, "pr-count");
  assert.equal(resolveCommand(["pr", "count"]).command.id, "pr-count");
  assert.equal(resolveCommand(["issue"]).command.id, "issue-count");
  assert.equal(resolveCommand(["issue", "count"]).command.id, "issue-count");
  assert.equal(resolveCommand(["pr", "reviews"]).command.id, "pr-reviews");
  assert.deepEqual(resolveCommand(["pr", "--help"]), {
    type: "group-help",
    group: "pr",
  });
  assert.deepEqual(resolveCommand(["--help"]), { type: "root-help" });
});

test("every interactive command has a one-sentence description", () => {
  const output = createCliOutput({
    stdout: new CaptureStream({ isTTY: true }),
    stderr: new CaptureStream({ isTTY: true }),
    env: { NO_COLOR: "1" },
  });
  const prompt = output.promptLines("Select an insight", commandRegistry, 0);

  assert.equal(prompt.length, 1 + commandRegistry.length * 2 + 2);
  for (const command of commandRegistry) {
    assert.match(command.description, /^[A-Z].+\.$/);
    assert.ok(prompt.some((line) => line.includes(command.label)));
    assert.ok(prompt.some((line) => line.includes(command.description)));
  }
});

test("the router rejects unknown groups and commands with exit code 2", () => {
  assert.throws(() => resolveCommand(["pulls"]), { exitCode: 2 });
  assert.throws(() => resolveCommand(["pr", "missing"]), { exitCode: 2 });
  assert.throws(() => resolveCommand(["issue", "--help", "extra"]), {
    exitCode: 2,
  });
});

test("the GitHub client uses only gh GraphQL queries and tracks requests", async () => {
  const calls = [];
  const github = createGitHubClient({
    executeGh: async (args) => {
      calls.push(args);
      return graphqlResponse({ viewer: { login: "tay1orjones" } });
    },
  });

  const data = await github.query("query Viewer { viewer { login } }", {
    owner: "carbon-design-system",
  });

  assert.equal(data.viewer.login, "tay1orjones");
  assert.equal(github.requestCount, 1);
  assert.deepEqual(calls[0].slice(0, 4), [
    "api",
    "graphql",
    "-f",
    "query=query Viewer { viewer { login } }",
  ]);
  assert.ok(calls[0].includes("owner=carbon-design-system"));
});

test("the GitHub client rejects mutations before invoking gh", async () => {
  let invoked = false;
  const github = createGitHubClient({
    executeGh: async () => {
      invoked = true;
    },
  });

  await assert.rejects(
    github.query("mutation ChangeSomething { changeSomething }"),
    /read-only GraphQL queries/,
  );
  assert.equal(invoked, false);
  assert.equal(github.requestCount, 0);
});

test("the GitHub client normalizes malformed data and GraphQL errors", async () => {
  const malformed = createGitHubClient({ executeGh: async () => "not-json" });
  await assert.rejects(malformed.query("query Test { viewer { login } }"), {
    message: "GitHub returned malformed JSON",
  });

  const graphqlError = createGitHubClient({
    executeGh: async () => JSON.stringify({ errors: [{ message: "denied" }] }),
  });
  await assert.rejects(
    graphqlError.query("query Test { viewer { login } }"),
    (error) => error.message === "GitHub GraphQL query failed" && error.details[0] === "denied",
  );
});

test("authentication failures provide a recovery action", async () => {
  const github = createGitHubClient({
    executeGh: async () => {
      const error = new Error("gh failed");
      error.stderr = "HTTP 401: Bad credentials";
      throw error;
    },
  });

  await assert.rejects(
    github.query("query Viewer { viewer { login } }"),
    (error) =>
      error.message === "GitHub authentication failed" &&
      error.action === "Run `gh auth login` and try again",
  );
});

for (const [command, connection] of [
  [prCountCommand, "pullRequests"],
  [issueCountCommand, "issues"],
]) {
  test(`${command.id} queries the repository totalCount connection`, async () => {
    let document;
    let variables;
    const result = await command.execute(
      {
        github: {
          query: async (nextDocument, nextVariables) => {
            document = nextDocument;
            variables = nextVariables;
            return { repository: { [connection]: { totalCount: 42 } } };
          },
        },
      },
      command.parse(["-R", "example/project"], testConfig()),
    );

    assert.match(document, new RegExp(`${connection}\\(states: OPEN\\)`));
    assert.deepEqual(variables, { owner: "example", name: "project" });
    assert.deepEqual(result, { count: 42, repository: "example/project" });
  });
}

test("runCli renders help without querying GitHub", async () => {
  const stdout = new CaptureStream();
  const stderr = new CaptureStream();
  let queried = false;
  const exitCode = await runCli(["pr", "reviews", "--help"], {
    stdout,
    stderr,
    loadConfiguration: async () => testConfig(),
    executeGh: async () => {
      queried = true;
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(queried, false);
  assert.match(stdout.read(), /Usage: yarn insights pr reviews/);
  assert.equal(stderr.read(), "");
});

test("runCli returns documented codes for usage, missing gh, and cancellation", async () => {
  const usageError = new CaptureStream();
  assert.equal(
    await runCli(["pr", "count", "--unknown"], {
      stdout: new CaptureStream(),
      stderr: usageError,
      loadConfiguration: async () => testConfig(),
    }),
    2,
  );

  const missingGh = new CaptureStream();
  assert.equal(
    await runCli(["pr"], {
      stdout: new CaptureStream(),
      stderr: missingGh,
      loadConfiguration: async () => testConfig(),
      executeGh: async () => {
        const error = new Error("spawn gh ENOENT");
        error.code = "ENOENT";
        throw error;
      },
    }),
    127,
  );
  assert.match(missingGh.read(), /GitHub CLI is required/);

  assert.equal(
    await runCli([], {
      stdout: new CaptureStream({ isTTY: true }),
      stderr: new CaptureStream({ isTTY: true }),
      env: { NO_COLOR: "1" },
      selectCommand: async () => null,
    }),
    130,
  );
});

test("arrow navigation rewrites only changed rows without clearing screen-down", async () => {
  const input = new TestInput();
  const stdout = new CaptureStream({ isTTY: true });
  const cliOutput = createCliOutput({
    stdout,
    stderr: new CaptureStream({ isTTY: true }),
    env: { NO_COLOR: "1" },
  });
  const options = [
    { id: "one", label: "First", description: "Run the first command." },
    { id: "two", label: "Second", description: "Run the second command." },
    { id: "three", label: "Third", description: "Run the third command." },
  ];
  const selection = selectInsight({ input, output: stdout, cliOutput, options });
  assert.match(stdout.read(), /Run the first command\./);
  assert.match(stdout.read(), /Run the second command\./);
  assert.match(stdout.read(), /Run the third command\./);
  const beforeArrow = stdout.read().length;

  input.emit("keypress", "", { name: "down" });
  const arrowOutput = stdout.read().slice(beforeArrow);

  assert.doesNotMatch(arrowOutput, /\u001b\[0J/);
  assert.equal((arrowOutput.match(/\u001b\[2K/g) || []).length, 2);
  assert.match(arrowOutput, /First/);
  assert.match(arrowOutput, /Second/);
  assert.doesNotMatch(arrowOutput, /Third/);
  assert.doesNotMatch(arrowOutput, /Run the/);

  input.emit("keypress", "", { name: "escape" });
  assert.equal(await selection, null);
  assert.equal(input.isRaw, false);
  assert.equal(input.paused, true);
  assert.match(stdout.read(), /\u001b\[\?25l/);
  assert.match(stdout.read(), /\u001b\[\?25h/);
});

test("interactive navigation wraps from first to last and preserves selection", async () => {
  const input = new TestInput();
  const stdout = new CaptureStream({ isTTY: true });
  const cliOutput = createCliOutput({
    stdout,
    stderr: new CaptureStream({ isTTY: true }),
    env: { NO_COLOR: "1" },
  });
  const options = [
    { id: "one", label: "First", description: "Run the first command." },
    { id: "two", label: "Second", description: "Run the second command." },
    { id: "three", label: "Third", description: "Run the third command." },
  ];
  const selection = selectInsight({ input, output: stdout, cliOutput, options });

  input.emit("keypress", "", { name: "up" });
  input.emit("keypress", "", { name: "return" });

  assert.equal(await selection, "three");
  assert.equal(input.isRaw, false);
  assert.equal(input.paused, true);
});

test("Ctrl+C and input errors share the terminal cleanup path", async () => {
  for (const event of ["interrupt", "stream-error"]) {
    const input = new TestInput();
    const stdout = new CaptureStream({ isTTY: true });
    const cliOutput = createCliOutput({
      stdout,
      stderr: new CaptureStream({ isTTY: true }),
      env: { NO_COLOR: "1" },
    });
    const selection = selectInsight({
      input,
      output: stdout,
      cliOutput,
      options: [{ id: "one", label: "First" }],
    });

    if (event === "interrupt") {
      input.emit("keypress", "", { ctrl: true, name: "c" });
      assert.equal(await selection, null);
    } else {
      input.emit("error", new Error("input failed"));
      await assert.rejects(selection, /input failed/);
    }

    assert.equal(input.isRaw, false);
    assert.equal(input.paused, true);
    assert.match(stdout.read(), /\u001b\[\?25h/);
  }
});

test("prompt render failures still restore raw mode and attempt to show the cursor", async () => {
  class FailingOutput extends CaptureStream {
    writes = 0;
    cursorRestored = false;

    write(chunk) {
      this.writes += 1;
      if (this.writes === 2) {
        throw new Error("render failed");
      }
      if (String(chunk).includes("\u001B[?25h")) {
        this.cursorRestored = true;
      }
      return super.write(chunk);
    }
  }

  const input = new TestInput();
  const stdout = new FailingOutput({ isTTY: true });
  const cliOutput = createCliOutput({
    stdout,
    stderr: new CaptureStream({ isTTY: true }),
    env: { NO_COLOR: "1" },
  });

  await assert.rejects(
    selectInsight({
      input,
      output: stdout,
      cliOutput,
      options: [{ id: "one", label: "First" }],
    }),
    /render failed/,
  );
  assert.equal(input.isRaw, false);
  assert.equal(input.paused, true);
  assert.equal(stdout.cursorRestored, true);
});

test("rendering supports ASCII tables and disables color through NO_COLOR", () => {
  const stdout = new CaptureStream({ isTTY: true });
  const output = createCliOutput({
    stdout,
    stderr: new CaptureStream({ isTTY: true }),
    env: { TERM: "xterm", NO_COLOR: "1", FORCE_ASCII: "1" },
  });
  output.success("Done");

  assert.equal(output.color, false);
  assert.equal(output.unicode, false);
  assert.doesNotMatch(stdout.read(), /\u001b\[/);
  assert.equal(
    renderTable(["Name", "Count"], [["Alice", "2"]], {
      unicode: false,
      rightAlign: [1],
    }),
    [
      "+-------+-------+",
      "| Name  | Count |",
      "+-------+-------+",
      "| Alice |     2 |",
      "+-------+-------+",
    ].join("\n"),
  );
});

test("TTY output uses Unicode, --no-color disables styling, and warnings use stderr", async () => {
  const stdout = new CaptureStream({ isTTY: true });
  const stderr = new CaptureStream({ isTTY: true });
  const exitCode = await runCli(["pr", "--no-color"], {
    stdout,
    stderr,
    env: { TERM: "xterm-256color" },
    loadConfiguration: async () => testConfig(),
    executeGh: async () =>
      graphqlResponse({ repository: { pullRequests: { totalCount: 7 } } }),
  });

  assert.equal(exitCode, 0);
  assert.match(stdout.read(), /┌  Carbon insights/);
  assert.doesNotMatch(stdout.read(), /\u001b\[/);
  assert.equal(stderr.read(), "");

  const routedStdout = new CaptureStream();
  const routedStderr = new CaptureStream();
  const output = createCliOutput({
    stdout: routedStdout,
    stderr: routedStderr,
  });
  output.success("Result");
  output.warning("Caution", ["Details"]);
  assert.match(routedStdout.read(), /Result/);
  assert.doesNotMatch(routedStdout.read(), /Caution/);
  assert.match(routedStderr.read(), /Caution/);
  assert.match(routedStderr.read(), /Details/);
});
