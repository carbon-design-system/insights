# Repository instructions

## Insights CLI purpose

Insights is a trusted, read-only terminal lens for Carbon repository health, contribution
activity, and work needing attention. A command belongs here only when it answers a recurring
maintainer question, is always safe to run, and clearly reports its scope, dates, filters, API
limits, and cache use.

Insights is not a GitHub mutation tool, automation engine, autonomous reviewer, credential store,
or machine-readable reporting API. Do not add GitHub writes, workflow side effects, Bob execution,
JSON output, quiet modes, or legacy wrappers.

## Command contract

- `yarn insights` opens one flat interactive selector. Use explicit commands without a TTY.
- Every registered command must provide a brief, one-sentence `description`; the interactive
  selector displays it beneath the command label so users understand the choice before running it.
- `pr` and `issue` are aliases for `pr count` and `issue count`.
- The leaf commands are `pr count`, `pr reviews`, `pr open-rate`, `pr stale`, and `issue count`.
- Repository commands accept `--repo <owner/name>` and `-R`. Reviews accepts `--org` and
  repeatable `--user`; supplied users replace the configured roster. Open rate accepts
  `--refresh`; stale accepts `--days`.
- `--no-color` is global and complements `NO_COLOR`.
- Preserve exit codes 0 (success), 1 (runtime/configuration failure), 2 (invalid usage), 127
  (missing `gh`), and 130 (interactive cancellation).
- Keep root, group, and leaf help current whenever the registry or flags change.

## Architecture and configuration

- Keep [Architecture](docs/architecture.md) current when changing the web/CLI boundary, static
  export or Pages behavior, base-path handling, CLI lifecycle, or cache ownership.
- Keep `README.md` focused on end-user setup and usage. High-level deployment and code-ownership
  details belong in `docs/architecture.md`; do not duplicate them back into the README.
- Keep `scripts/insights.mjs` as a thin executable. The registry/lifecycle, configuration,
  GitHub boundary, output layer, and leaf commands remain separate concerns as outlined in the
  architecture document.
- Each leaf command lives in its own module with colocated tests. It exposes metadata, parses its
  flags, executes through injected dependencies, returns a plain result, and renders through the
  shared output layer.
- `config/insights.json` owns the default GitHub organization/repository, review roster, stale-day
  threshold, and ignored authors. Invocation flags override it for one run; do not duplicate these
  defaults in command modules.
- Open-rate cache data belongs at `.cache/open-rate.json` and must remain ignored.

## Read-only invariant

- Use the GitHub CLI (`gh`) for every GitHub request so the operator's local credentials are used.
- Only `scripts/insights/github.mjs` may execute `gh`; command modules receive the shared client.
- The client exposes query-only GraphQL and must reject every non-query document.
- Do not expose generic REST helpers or add GraphQL mutations, comments, draft conversion, review
  request removal, or write/dry-run modes.
- Keep the source-level read-only invariant test updated when commands are added.

## CLI output

- Keep output useful without color and stable in logs or redirected streams.
- Preserve the existing semantic symbols, guide rails, stdout/stderr separation, Unicode/ASCII
  fallbacks, and `NO_COLOR`/`--no-color` behavior.
- Prompts must not repaint the full screen during navigation. Rewrite only changed option rows,
  hide the cursor while active, and restore cursor visibility, raw mode, and paused input through
  the shared cleanup path.
- Send requested results to stdout and warnings/errors to stderr.

## Code readability

- Write comments for a maintainer who is new to the codebase. Explain lifecycle boundaries,
  safety constraints, pagination/cap handling, cache behavior, and other non-obvious reasoning.
- Prefer comments that explain why a design exists. Do not narrate straightforward syntax or let
  comments repeat names that are already clear from the code.
- Update or remove nearby comments when behavior changes so they remain trustworthy.

## Verification

After CLI changes:

1. Run `yarn test:insights`.
2. Run `yarn lint`.
3. Run `git diff --check`.
4. Test rapid up/down navigation and cancellation in a real TTY.
5. Smoke-test each changed leaf command with an authenticated, read-only `gh` session.
6. Confirm `.cache/open-rate.json` remains ignored and no source GitHub mutation was introduced.

Do not run a project build without separate approval. If `yarn.lock` changes, run `yarn dedupe`.
