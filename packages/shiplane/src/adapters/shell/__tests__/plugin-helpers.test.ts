import { describe, expect, it } from "vitest";
import { z } from "zod";

import { RecordingShell } from "../__fakes__/shell.fake";
import { parseJson } from "../../parse-json";
import { mustCapture } from "../must-capture";
import { retrying } from "../retrying";

describe("what a plugin builds its adapters on", () => {
  it("given a command that fails, when it must succeed, then it throws its first error line and keeps all it printed", async () => {
    const shell = new RecordingShell().seed("flyctl deploy", {
      status: 1,
      stdout: "building\n",
      stderr: "\n  Error: no access token  \nrun flyctl auth login\n",
    });

    await expect(
      mustCapture({ shell, command: "flyctl", args: ["deploy", "--remote-only"] }),
    ).rejects.toMatchObject({
      name: "CommandFailed",
      message: "flyctl deploy exited with 1: Error: no access token",
      output: "Error: no access token  \nrun flyctl auth login\nbuilding",
    });
  });

  it("given a command that succeeds, when it must succeed, then it returns what it printed", async () => {
    const shell = new RecordingShell().seed("git rev-parse", { stdout: "abc\n" });

    expect(await mustCapture({ shell, command: "git", args: ["rev-parse", "HEAD"] })).toBe("abc\n");
  });

  it("given a try that keeps failing in a retryable way, when it is retried, then it waits each delay once and returns the last result", async () => {
    const waits: number[] = [];
    let tries = 0;

    const result = await retrying({
      run: () => Promise.resolve(++tries),
      retryable: () => true,
      delays: [2_000, 10_000],
      wait: (ms) => Promise.resolve(waits.push(ms)),
    });

    expect({ result, waits }).toEqual({ result: 3, waits: [2_000, 10_000] });
  });

  it("given a try whose failure cannot be helped, when it is retried, then it is not tried again", async () => {
    let tries = 0;

    await retrying({ run: () => Promise.resolve(++tries), retryable: () => false, delays: [1] });

    expect(tries).toBe(1);
  });

  it("given a notice where JSON was expected, when it is read, then the read fails without throwing", () => {
    expect(parseJson({ text: "npm notice", schema: z.object({}) }).success).toBe(false);
    expect(
      parseJson({ text: '{"latest":"1.0.0"}', schema: z.record(z.string(), z.string()) }),
    ).toEqual({ success: true, data: { latest: "1.0.0" } });
  });
});
