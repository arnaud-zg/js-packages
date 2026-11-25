import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { RecordingShell } from "../../adapters/shell/__fakes__/shell.fake";
import { systemShell } from "../../adapters/shell/system-shell.adapter";
import { commandFailed, firstLine, mustCapture, parseJson, retrying } from "../../plugin";

const NODE = process.execPath;
let cwd: string;

beforeEach(() => {
  cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "shiplane-adapters-shell-")));
});

afterEach(() => {
  fs.rmSync(cwd, { recursive: true, force: true });
});

describe("running the commands of a release on this machine", () => {
  it("given a command that prints and succeeds, when it is captured, then its output and a zero status come back", async () => {
    const result = await systemShell.capture(
      NODE,
      ["-e", "process.stdout.write('out'); process.stderr.write('err')"],
      { cwd },
    );

    expect(result).toEqual({ status: 0, stdout: "out", stderr: "err" });
  });

  it("given a command run in a folder, when it is captured, then it runs there with the variables it was given", async () => {
    const result = await systemShell.capture(
      NODE,
      ["-e", "process.stdout.write(process.cwd() + '|' + process.env.SHIPLANE_TEST_TOKEN)"],
      { cwd, env: { SHIPLANE_TEST_TOKEN: "secret" } },
    );

    expect(result.stdout).toBe(`${cwd}|secret`);
  });

  it("given a command reading its input, when it is captured with input, then it reads that input", async () => {
    const result = await systemShell.capture(
      NODE,
      ["-e", "process.stdin.on('data', (d) => process.stdout.write(String(d).toUpperCase()))"],
      { cwd, input: "piped" },
    );

    expect(result.stdout).toBe("PIPED");
  });

  it("given a command that exits non-zero, when it is captured, then its status is that exit code, not an error", async () => {
    const result = await systemShell.capture(NODE, ["-e", "process.exit(3)"], { cwd });

    expect(result.status).toBe(3);
  });

  it("given a command that is not installed, when it is captured, then it answers 127 as a shell would", async () => {
    const result = await systemShell.capture("shiplane-no-such-command", [], { cwd });

    expect(result.status).toBe(127);
  });

  it("given a command attached to the terminal, when it exits, then its exit code comes back", async () => {
    expect(await systemShell.attach(NODE, ["-e", "process.exit(4)"], { cwd })).toBe(4);
    expect(await systemShell.attach(NODE, ["-e", ""], { cwd })).toBe(0);
  });

  it("given an attached command given input and a folder, when it runs, then it reads the input there", async () => {
    const status = await systemShell.attach(
      NODE,
      [
        "-e",
        "let t='';process.stdin.on('data',(d)=>t+=d).on('end',()=>{require('fs').writeFileSync('seen.txt', t + '|' + process.env.SHIPLANE_TEST_TOKEN)})",
      ],
      { cwd, input: "typed", env: { SHIPLANE_TEST_TOKEN: "attached" } },
    );

    expect(status).toBe(0);
    expect(fs.readFileSync(path.join(cwd, "seen.txt"), "utf8")).toBe("typed|attached");
  });

  it("given an attached command that is not installed, when it runs, then it answers 127", async () => {
    expect(await systemShell.attach("shiplane-no-such-command", [], { cwd })).toBe(127);
  });

  it("given a variable set for shiplane, when a release reads it, then its value comes back, and an unset one is missing", () => {
    expect(systemShell.env("PATH")).toBe(process.env.PATH);
    expect(systemShell.env("SHIPLANE_NEVER_SET_VARIABLE")).toBeUndefined();
  });
});

describe("writing a plugin's commands with shiplane's helpers", () => {
  it("given a tool's output with blank lines first, when the plugin reads its first line, then it is the first with text, trimmed", () => {
    expect(firstLine("\n   \n  hello  \nworld")).toBe("hello");
    expect(firstLine(" \n \n")).toBeUndefined();
  });

  it("given a tool that fails printing nothing to stderr, when the failure is reported, then it names only the step and status, and keeps stdout", () => {
    const error = commandFailed({
      label: "storectl build",
      result: { status: 2, stdout: "  partial  ", stderr: "   " },
    });

    expect({ message: error.message, output: error.output }).toEqual({
      message: "storectl build exited with 2",
      output: "partial",
    });
  });

  it("given a command with a folder, variables and input, when the plugin runs it, then the shell runs it with all three", async () => {
    const shell = new RecordingShell();

    await mustCapture({
      shell,
      command: "codehost",
      args: ["api", "user"],
      cwd: "/repo",
      env: { HOST_TOKEN: "t" },
      input: "body",
    });

    expect(shell.calls).toEqual([
      { command: "codehost", args: ["api", "user"], cwd: "/repo", env: { HOST_TOKEN: "t" } },
    ]);
  });

  it("given a failing command, when the plugin runs it, then the error names its step, or the bare command when it has no arguments", async () => {
    const shell = new RecordingShell().seed("sitectl", { status: 1, stderr: "nope" });

    await expect(
      mustCapture({ shell, command: "sitectl", args: ["deploy"], label: "upload the site" }),
    ).rejects.toThrow("upload the site exited with 1: nope");
    await expect(mustCapture({ shell, command: "sitectl", args: [] })).rejects.toThrow(
      /^sitectl exited with 1: nope$/,
    );
  });

  it("given a busy service that recovers on the second try, when the plugin retries, then it stops there without waiting again", async () => {
    const waits: number[] = [];
    const results = ["busy", "ok", "busy"];
    let tries = 0;

    const result = await retrying({
      run: () => Promise.resolve(results[tries++] ?? "none"),
      retryable: (value) => value === "busy",
      delays: [5, 50, 500],
      wait: (ms) => Promise.resolve(waits.push(ms)),
    });

    expect({ result, tries, waits }).toEqual({ result: "ok", tries: 2, waits: [5] });
  });

  it("given a retry with no wait of its own, when the service is busy, then it waits for real and tries again", async () => {
    let tries = 0;

    const result = await retrying({
      run: () => Promise.resolve(++tries),
      retryable: (value) => value < 2,
      delays: [1, 1],
    });

    expect(result).toBe(2);
  });

  it("given a tool answering text that is not JSON or not the expected shape, when the plugin reads it, then the error says why", () => {
    const notJson = parseJson({ text: "npm notice", schema: z.object({}) });
    const wrongShape = parseJson({
      text: '{"latest":1}',
      schema: z.object({ latest: z.string() }),
    });

    expect(notJson.success || notJson.error).toContain("JSON");
    expect(wrongShape.success || wrongShape.error).toContain("latest");
  });
});
