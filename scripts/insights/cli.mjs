import {
  clearLine,
  clearScreenDown,
  cursorTo,
  emitKeypressEvents,
  moveCursor,
} from "node:readline";

import { extractGlobalOptions } from "./args.mjs";
import { loadConfig } from "./config.mjs";
import { prCountCommand, issueCountCommand } from "./count.mjs";
import { CliError, usageError } from "./errors.mjs";
import { createGitHubClient, runGh } from "./github.mjs";
import { openRateCommand } from "./open-rate.mjs";
import { createCliOutput } from "./output.mjs";
import { reviewsCommand } from "./reviews.mjs";
import { staleCommand } from "./stale.mjs";

export const commandRegistry = [
  prCountCommand,
  issueCountCommand,
  reviewsCommand,
  openRateCommand,
  staleCommand,
];

// `runCli` is the single lifecycle shared by direct and interactive commands:
// resolve -> configure -> parse -> execute -> render -> normalize failures.
export async function runCli(
  argv = process.argv.slice(2),
  {
    input = process.stdin,
    stdout = process.stdout,
    stderr = process.stderr,
    env = process.env,
    now = new Date(),
    executeGh = runGh,
    loadConfiguration = loadConfig,
    cachePath,
    selectCommand = selectInsight,
  } = {},
) {
  const global = extractGlobalOptions(argv);
  const output = createCliOutput({
    stdout,
    stderr,
    env,
    noColor: global.noColor,
  });

  try {
    let resolution = resolveCommand(global.args);
    if (resolution.type === "root-help") {
      printRootHelp(output);
      return 0;
    }
    if (resolution.type === "group-help") {
      printGroupHelp(output, resolution.group);
      return 0;
    }

    if (resolution.type === "interactive") {
      output.intro("Carbon insights");
      output.blank();
      const selectedId = await selectCommand({
        input,
        output: stdout,
        cliOutput: output,
        options: commandRegistry,
      });
      if (selectedId === null) {
        output.warning("Selection cancelled");
        return 130;
      }
      resolution = {
        type: "command",
        command: commandRegistry.find(({ id }) => id === selectedId),
        args: [],
        interactive: true,
      };
      output.step(`Insight: ${resolution.command.label}`);
      output.blank();
    }

    const config = await loadConfiguration();
    const options = resolution.command.parse(resolution.args, config);
    if (options.help) {
      resolution.command.help(output, config);
      return 0;
    }

    const github = createGitHubClient({ executeGh });
    const result = await resolution.command.execute(
      { github, now, cachePath },
      options,
    );
    resolution.command.render(output, result);
    return 0;
  } catch (error) {
    const cliError = normalizeError(error);
    output.failure(cliError.message, cliError.details, cliError.action);
    return cliError.exitCode;
  }
}

export function resolveCommand(args) {
  if (args.length === 0) {
    return { type: "interactive" };
  }
  if (args.length === 1 && ["--help", "-h", "help"].includes(args[0])) {
    return { type: "root-help" };
  }

  const [group, next, ...remaining] = args;
  if (group !== "pr" && group !== "issue") {
    throw usageError(`Unknown command: ${group}`, {
      details: ["Available command groups: pr, issue"],
      action: "Run `yarn insights --help` for usage",
    });
  }

  if (["--help", "-h", "help"].includes(next)) {
    if (remaining.length > 0) {
      throw usageError(`Unknown option: ${remaining[0]}`);
    }
    return { type: "group-help", group };
  }

  if (next === undefined || next.startsWith("-")) {
    // The group names are intentionally useful aliases: `pr` behaves like
    // `pr count`, and `issue` behaves like `issue count`.
    return {
      type: "command",
      command: group === "pr" ? prCountCommand : issueCountCommand,
      args: next === undefined ? [] : [next, ...remaining],
    };
  }

  const command = commandRegistry.find(
    (candidate) => candidate.group === group && candidate.name === next,
  );
  if (!command) {
    throw usageError(`Unknown ${group} command: ${next}`, {
      action: `Run \`yarn insights ${group} --help\` for usage`,
    });
  }
  return { type: "command", command, args: remaining };
}

export async function selectInsight({
  input = process.stdin,
  output = process.stdout,
  cliOutput,
  options = commandRegistry,
} = {}) {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
    throw usageError("Interactive input requires a terminal", {
      details: ["Choose a command explicitly when input is redirected."],
      action: "Run `yarn insights --help` to see available commands",
    });
  }

  const wasRaw = Boolean(input.isRaw);
  let selectedIndex = 0;
  let renderedLineCount = 0;
  let settled = false;
  let cleanedUp = false;

  return new Promise((resolve, reject) => {
    function clearPrompt() {
      if (renderedLineCount === 0) {
        return;
      }
      moveCursor(output, 0, -renderedLineCount);
      cursorTo(output, 0);
      clearScreenDown(output);
      renderedLineCount = 0;
    }

    function cleanup() {
      if (cleanedUp) {
        return;
      }
      cleanedUp = true;
      input.off("keypress", onKeypress);
      input.off?.("error", onStreamError);
      output.off?.("error", onStreamError);
      try {
        input.setRawMode(wasRaw);
      } catch {
        // Continue cleanup so one failed terminal operation cannot skip the rest.
      }
      try {
        input.pause();
      } catch {
        // Continue cleanup so one failed terminal operation cannot skip the rest.
      }
      try {
        clearPrompt();
      } catch {
        // The original stream or render error is more useful.
      }
      try {
        cliOutput.showCursor();
      } catch {
        // The original stream error is more useful than a cleanup failure.
      }
    }

    function finish(value, error) {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    }

    function onStreamError(error) {
      finish(null, error);
    }

    function rewriteOption(index, selected) {
      // Descriptions never change while navigating. Move to the option's title
      // row and rewrite only that row so arrow keys do not flash the full prompt.
      const offset = promptOptionOffset(options, index);
      moveCursor(output, 0, offset);
      cursorTo(output, 0);
      clearLine(output, 0);
      output.write(cliOutput.promptOption(options[index], selected));
      moveCursor(output, 0, -offset);
      cursorTo(output, 0);
    }

    function moveSelection(nextIndex) {
      const previousIndex = selectedIndex;
      selectedIndex = nextIndex;
      rewriteOption(previousIndex, false);
      rewriteOption(selectedIndex, true);
    }

    function onKeypress(_character, key = {}) {
      try {
        if (key.name === "up") {
          moveSelection((selectedIndex - 1 + options.length) % options.length);
        } else if (key.name === "down") {
          moveSelection((selectedIndex + 1) % options.length);
        } else if (key.name === "return") {
          finish(options[selectedIndex].id);
        } else if (key.name === "escape" || (key.ctrl && key.name === "c")) {
          finish(null);
        }
      } catch (error) {
        finish(null, error);
      }
    }

    try {
      emitKeypressEvents(input);
      input.setRawMode(true);
      input.resume();
      input.on("keypress", onKeypress);
      input.on?.("error", onStreamError);
      output.on?.("error", onStreamError);
      cliOutput.hideCursor();
      const lines = cliOutput.promptLines("Select an insight", options, selectedIndex);
      output.write(`${lines.join("\n")}\n`);
      renderedLineCount = lines.length;
    } catch (error) {
      finish(null, error);
    }
  });
}

function promptOptionOffset(options, index) {
  const selectedOptionDescription = options[index].description ? 1 : 0;
  const followingOptionLines = options
    .slice(index + 1)
    .reduce((total, option) => total + 1 + (option.description ? 1 : 0), 0);

  // Add one row to move from the cursor to the final rendered row, plus the
  // guide and instruction rows at the bottom of the prompt.
  return -(3 + selectedOptionDescription + followingOptionLines);
}

function printRootHelp(output) {
  output.intro("Carbon insights");
  output.detail("A trusted, read-only lens into Carbon repository and review health");
  output.blank();
  output.info("Usage: yarn insights <group> [command] [options]");
  output.detail("pr             Count open pull requests");
  output.detail("pr count       Count open pull requests");
  output.detail("pr reviews     Report five weeks of review activity");
  output.detail("pr open-rate   Compare PR opening volume with one year ago");
  output.detail("pr stale       Find inactive PRs awaiting your review");
  output.detail("issue          Count open issues");
  output.detail("issue count    Count open issues");
  output.blank();
  output.outro("Run without a command to choose interactively");
}

function printGroupHelp(output, group) {
  output.intro(group === "pr" ? "Pull request insights" : "Issue insights");
  output.detail();
  output.info(`Usage: yarn insights ${group} [command] [options]`);
  if (group === "pr") {
    output.detail("count       Count open pull requests (default)");
    output.detail("reviews     Report five weeks of review activity");
    output.detail("open-rate   Compare PR opening volume with one year ago");
    output.detail("stale       Find inactive PRs awaiting your review");
  } else {
    output.detail("count       Count open issues (default)");
  }
  output.detail();
  output.outro(`Run \`yarn insights ${group} <command> --help\` for options`);
}

function normalizeError(error) {
  if (error instanceof CliError) {
    return error;
  }
  return new CliError("Insights command failed", {
    details: [error?.message || String(error)],
    action: "Check the error above and try again",
  });
}
