import { EventEmitter } from "node:events";

export class CaptureStream extends EventEmitter {
  constructor({ isTTY = false } = {}) {
    super();
    this.isTTY = isTTY;
    this.content = "";
  }

  write(chunk) {
    this.content += String(chunk);
    return true;
  }

  read() {
    return this.content;
  }
}

export class TestInput extends EventEmitter {
  isTTY = true;
  isRaw = false;
  paused = true;

  setRawMode(value) {
    this.isRaw = value;
  }

  resume() {
    this.paused = false;
  }

  pause() {
    this.paused = true;
  }
}

export function testConfig() {
  return {
    github: {
      organization: "carbon-design-system",
      repository: "carbon-design-system/carbon",
    },
    reviews: { users: ["alice", "bob"] },
    stale: { days: 14, ignoredAuthors: ["dependabot", "renovate"] },
  };
}

export function graphqlResponse(data) {
  return JSON.stringify({ data });
}
