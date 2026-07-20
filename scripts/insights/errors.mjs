export class CliError extends Error {
  // Keeping user-facing context on the error lets the top-level lifecycle own
  // all failure rendering without command modules writing directly to stderr.
  constructor(message, { details = [], action, exitCode = 1 } = {}) {
    super(message);
    this.name = "CliError";
    this.details = details;
    this.action = action;
    this.exitCode = exitCode;
  }
}

export function usageError(message, { details = [], action } = {}) {
  return new CliError(message, { details, action, exitCode: 2 });
}
