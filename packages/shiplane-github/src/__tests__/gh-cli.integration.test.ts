import type { Shell, ShellResult } from "shiplane/plugin";
import { describe, expect, it } from "vitest";

import { ghCli } from "../gh-cli";
import { fakeGh } from "./gh.fake";

const LIMITED: ShellResult = {
  status: 1,
  stdout: "",
  stderr: "gh: You have exceeded a secondary rate limit. Please wait a few minutes (HTTP 403)",
};
const OK: ShellResult = { status: 0, stdout: '{"ok":true}', stderr: "" };

const replying = (...results: ShellResult[]) => {
  const calls: string[][] = [];
  const shell: Shell = {
    capture: (_command, args) => {
      calls.push([...args]);
      return Promise.resolve(results.shift() ?? OK);
    },
    attach: () => Promise.resolve(0),
    env: () => undefined,
  };
  return { shell, calls };
};

describe("talking to GitHub under its rate limits", () => {
  it("given GitHub rate limits a call twice, when it is made, then it is retried with a longer wait each time and succeeds", async () => {
    const { shell, calls } = replying(LIMITED, LIMITED, OK);
    const waits: number[] = [];

    const result = await ghCli({
      root: "/repo",
      shell,
      wait: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    }).json(["api", "graphql"]);

    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(3);
    expect(waits).toEqual([2000, 4000]);
  });

  it("given GitHub keeps rate limiting, when the retries run out, then the call fails saying so", async () => {
    const { shell } = replying(LIMITED, LIMITED, LIMITED, LIMITED, LIMITED);

    await expect(
      ghCli({ root: "/repo", shell, wait: () => Promise.resolve() }).must(["api", "graphql"]),
    ).rejects.toThrow("rate limit");
  });

  it("given a call that fails for another reason, when it is made, then it is not retried", async () => {
    const { shell, calls } = replying({ status: 1, stdout: "", stderr: "HTTP 404: Not Found" });

    await expect(
      ghCli({ root: "/repo", shell, wait: () => Promise.resolve() }).must(["pr", "view"]),
    ).rejects.toThrow("404");
    expect(calls).toHaveLength(1);
  });

  it("given a call that succeeds while warning about the rate limit, when it is made, then it is not retried", async () => {
    const { shell, calls } = replying({
      status: 0,
      stdout: "{}",
      stderr: "close to the rate limit",
    });

    await ghCli({ root: "/repo", shell, wait: () => Promise.resolve() }).must(["api", "user"]);

    expect(calls).toHaveLength(1);
  });
});

describe("running gh in the repository", () => {
  it("given a call with input, when it is made, then gh runs in the repository and reads that input", async () => {
    const gh = fakeGh();

    await ghCli({ root: "/repo", shell: gh.shell }).must(["api", "x", "--input", "-"], "{}");

    expect(gh.calls).toEqual([
      {
        how: "capture",
        command: "gh",
        args: ["api", "x", "--input", "-"],
        cwd: "/repo",
        input: "{}",
      },
    ]);
  });

  it("given a call that fails, when it is made, then the error names the gh command, its exit status and the first line it printed", async () => {
    const gh = fakeGh().seed("pr view", { status: 4, stderr: "HTTP 404: Not Found\nmore detail" });

    await expect(
      ghCli({ root: "/repo", shell: gh.shell }).must(["pr", "view", "42", "--json", "state"]),
    ).rejects.toThrow(/^gh pr view exited with 4: HTTP 404: Not Found$/);
  });

  it("given a call that fails silently, when it is made, then the error names the gh command and its exit status alone", async () => {
    const gh = fakeGh().seed("pr view", { status: 1 });

    await expect(
      ghCli({ root: "/repo", shell: gh.shell }).must(["pr", "view", "42"]),
    ).rejects.toThrow(/^gh pr view exited with 1$/);
  });
});
