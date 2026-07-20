import { parseRepository, readFlagValue } from "./args.mjs";
import { CliError, usageError } from "./errors.mjs";

function createCountCommand(type) {
  // Pull request and issue counts have the same lifecycle. The connection name
  // is the only important query difference, so one factory keeps them aligned.
  const pullRequests = type === "pr";
  const connection = pullRequests ? "pullRequests" : "issues";
  const label = pullRequests ? "Pull request count" : "Issue count";
  const plural = pullRequests ? "pull requests" : "issues";
  const description = pullRequests
    ? "Count open pull requests in a GitHub repository."
    : "Count open issues, excluding pull requests, in a GitHub repository.";

  return {
    id: `${type}-count`,
    group: type,
    name: "count",
    label,
    description,
    parse(args, config) {
      const options = { help: false, repository: config.github.repository };
      for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === "--help" || arg === "-h") {
          options.help = true;
        } else if (arg === "--repo" || arg === "-R") {
          options.repository = parseRepository(readFlagValue(args, index, arg), arg);
          index += 1;
        } else if (arg.startsWith("--repo=")) {
          options.repository = parseRepository(arg.slice("--repo=".length));
        } else {
          throw usageError(`Unknown option: ${arg}`, {
            action: `Run \`yarn insights ${type} count --help\` for usage`,
          });
        }
      }
      return options;
    },
    help(output, config) {
      output.intro(label);
      output.detail();
      output.info(`Usage: yarn insights ${type} count [options]`);
      output.detail(`--repo, -R <repo>  Repository (default: ${config.github.repository})`);
      output.detail("--no-color         Disable styled output");
      output.detail("--help, -h         Show help");
      output.detail();
      output.outro(this.description);
    },
    async execute({ github }, options) {
      const [owner, name] = options.repository.split("/");
      // GitHub's issues connection contains issues only; unlike search results,
      // pull requests do not need to be removed from this total afterward.
      const data = await github.query(
        `query RepositoryOpenCount($owner: String!, $name: String!) {
          repository(owner: $owner, name: $name) {
            ${connection}(states: OPEN) { totalCount }
          }
        }`,
        { owner, name },
      );
      const count = data.repository?.[connection]?.totalCount;
      if (!Number.isInteger(count) || count < 0) {
        throw new CliError("GitHub returned an unexpected count", {
          action: "Run `gh auth status` and try again",
        });
      }
      return { count, repository: options.repository };
    },
    render(output, result) {
      output.intro("Carbon insights");
      output.blank();
      output.info(`Repository: ${result.repository}`);
      output.blank();
      output.success(`Open ${plural}: ${result.count}`);
      output.blank();
      output.outro("GitHub data retrieved");
    },
  };
}

export const prCountCommand = createCountCommand("pr");
export const issueCountCommand = createCountCommand("issue");
