# Architecture

Carbon Insights has two user-facing surfaces in one repository: a statically hosted web
application and a local, read-only command-line interface. They share the Node/Yarn project but
have separate entrypoints and runtime behavior.

## Web application

The web application uses the Next.js App Router under `src/app`, with reusable UI in
`src/components` and feature-specific code in `src/features`.

Next.js is configured as a static export, so builds produce an `out` directory rather than a
long-running server. The Pages workflow builds that export, uploads it as an artifact, and deploys
it to GitHub Pages.

`next.config.mjs` reads `PAGES_BASE_PATH` when a deployment needs to live below the domain root.
Local and custom-domain builds normally leave it unset. GitHub's Pages setup action supplies the
deployment-specific base path during the hosted build, allowing the same configuration to support
both a project URL and the custom domain.

## Command-line interface

The `insights` package script starts `scripts/insights.mjs`, which delegates to the command
registry and lifecycle in `scripts/insights/cli.mjs`. A command follows the same high-level flow:

1. Resolve the command or interactive selection.
2. Load and validate defaults from `config/insights.json`.
3. Parse invocation-specific flags.
4. Query GitHub through the authenticated local `gh` session.
5. Render a human-readable result through the shared output layer.

Leaf command modules own their query, result shape, and presentation. The shared GitHub client is
the only code allowed to execute `gh`, and it accepts GraphQL queries only. This keeps the entire
CLI read-only by construction.

Open-rate data may be cached in `.cache/open-rate.json`. The cache is local, ignored by Git, and
does not affect the web application.

## Operational boundaries

- Web changes are validated through the Next.js static-export workflow.
- CLI changes are validated through `yarn test:insights`, linting, and real-terminal prompt checks.
- Running the CLI does not build or deploy the web application.
- Deploying the web application does not execute Insights CLI commands or query GitHub through a
  maintainer's credentials.
