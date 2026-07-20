#!/usr/bin/env node

import { runCli } from "./insights/cli.mjs";

// Keep the executable tiny: lifecycle behavior belongs in cli.mjs so tests can
// invoke the same entrypoint without spawning a separate Node process.
process.exitCode = await runCli();
