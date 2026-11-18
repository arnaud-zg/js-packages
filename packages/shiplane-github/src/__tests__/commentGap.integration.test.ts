import type { Shell } from "shiplane/plugin";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { githubHost } from "../github-code-host.adapter";

const SPAWN_MS = 400;

const slowShell = () => {
  const started: number[] = [];
  const shell: Shell = {
    capture: () => {
      started.push(Date.now());
      return new Promise((resolve) =>
        setTimeout(() => resolve({ status: 0, stdout: "{}", stderr: "" }), SPAWN_MS),
      );
    },
    attach: () => Promise.resolve(0),
    env: () => undefined,
  };
  return { shell, started };
};

describe("posting comments a second apart", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("given a post that takes time to send, when the next comment is posted, then it starts one second after the previous one started", async () => {
    const { shell, started } = slowShell();
    const host = githubHost("/repo", shell);
    const issue = { repository: "acme/app", number: 1 };

    const posts = (async () => {
      await host.comment(issue, "one");
      await host.comment(issue, "two");
    })();
    await vi.advanceTimersByTimeAsync(5000);
    await posts;

    expect(started.map((at) => at - (started[0] ?? 0))).toEqual([0, 1000]);
  });
});
