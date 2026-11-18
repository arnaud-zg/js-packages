import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Display } from "../../domain/display";
import { systemShell } from "../../adapters/shell/system-shell.adapter";
import { paintMascot, terminalProgress } from "../../adapters/terminal/terminal-progress.adapter";
import {
  onGitHubActions,
  systemClock,
  terminalOutput,
  terminalPrompter,
} from "../../adapters/terminal/terminal.adapter";
import { drawingOf } from "../../domain/display";

// eslint-disable-next-line no-control-regex
const plain = (text: string) => text.replace(/\u001B\[[0-9;?]*[A-Za-z]/g, "");

/** Everything this process printed to stdout while a test ran, as written. */
let printed: string[];

beforeEach(() => {
  printed = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    printed.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const lines = () => plain(printed.join("")).split("\n");
const all = () => plain(printed.join(""));

const QUIET: Display = { verbose: false, mascot: null, motion: false };
const VERBOSE: Display = { verbose: true, mascot: null, motion: false };
const HEDGEHOG: Display = { verbose: true, mascot: drawingOf(true), motion: false };

describe("seeing the mascot in colour", () => {
  beforeEach(() => {
    vi.stubEnv("FORCE_COLOR", "1");
  });

  it("given the hedgehog, when he is drawn, then his spines, face and what he holds each get their colour", () => {
    const hedgehog = drawingOf(true);
    const text = hedgehog.draw({ mood: "working", tick: 0, label: "" });

    expect(paintMascot(hedgehog, { mood: "working", tick: 0, label: "" })).toBe(
      `\u001B[33m${text.slice(0, 5)}\u001B[39m\u001B[1m${text.slice(5, 10)}\u001B[22m\u001B[36m${text.slice(10)}\u001B[39m`,
    );
  });

  it("given the hedgehog happy, when he is drawn, then his face is bold and green", () => {
    const hedgehog = drawingOf(true);

    expect(paintMascot(hedgehog, { mood: "happy", tick: 0, label: "" })).toContain(
      "\u001B[1m\u001B[32m(^ω^)",
    );
  });

  it("given any mascot worried, when it is drawn, then all of it is red", () => {
    const hedgehog = drawingOf(true);
    const text = hedgehog.draw({ mood: "worried", tick: 0, label: "" });

    expect(paintMascot(hedgehog, { mood: "worried", tick: 0, label: "" })).toBe(
      `\u001B[31m${text}\u001B[39m`,
    );
  });

  it("given a mascot of one's own, when it is drawn, then it is green when happy and plain otherwise", () => {
    const own = drawingOf(({ mood }) => (mood === "happy" ? "\\o/" : "-o-"));

    expect(paintMascot(own, { mood: "happy", tick: 0, label: "" })).toBe(
      "\u001B[32m\\o/\u001B[39m",
    );
    expect(paintMascot(own, { mood: "working", tick: 0, label: "" })).toBe("-o-");
  });
});

describe("following a release's progress in the terminal or a CI log", () => {
  it("given a quiet release, when a step runs, then only its name is printed, after a blank line", async () => {
    const progress = terminalProgress(QUIET, true);

    const result = await progress.during("build api", "working", () => Promise.resolve(7), {
      index: 0,
      total: 2,
    });

    expect({ result, lines: lines() }).toEqual({ result: 7, lines: ["", "▶ build api", ""] });
  });

  it("given a quiet release, when a batch or an unplaced step runs, then nothing is printed", async () => {
    const progress = terminalProgress(QUIET, true);

    await progress.during("build 3 apps", "working", () => Promise.resolve(), {
      done: () => 0,
      total: 3,
    });
    await progress.during("read the tags", "thinking", () => Promise.resolve());
    progress.stage(["read", "ship"], 0);

    expect(printed).toEqual([]);
  });

  it("given a log, not a terminal, when a step runs, then it is one plain line with its place", async () => {
    const progress = terminalProgress(VERBOSE, false);

    await progress.during("deploy api", "working", () => Promise.resolve(), { index: 1, total: 3 });

    expect(lines()).toEqual(["  2/3  deploy api", ""]);
  });

  it("given a log and the hedgehog, when a step runs, then he is drawn beside it", async () => {
    const progress = terminalProgress(HEDGEHOG, false);
    const hedgehog = drawingOf(true).draw({ mood: "working", tick: 0, label: "" });

    await progress.during("deploy api", "working", () => Promise.resolve());

    expect(lines()).toEqual([`  ${hedgehog} deploy api`, ""]);
  });

  it("given one step label just fitting and one wider than the terminal, when they run, then the first is printed whole and the second cut with an ellipsis", async () => {
    const progress = terminalProgress(VERBOSE, false);

    await progress.during("y".repeat(90), "working", () => Promise.resolve());
    await progress.during("x".repeat(150), "working", () => Promise.resolve());

    expect(lines().slice(0, 2)).toEqual([`  ${"y".repeat(90)}`, `  ${"x".repeat(89)}…`]);
  });

  it("given a verbose release, when it reaches a stage, then a blank line and the journey bar with its place are printed", () => {
    const progress = terminalProgress(VERBOSE, false);

    progress.stage(["read", "decide", "ship"], 1);

    expect(lines()).toEqual(["", `  ${"█".repeat(12)}${"░".repeat(6)}  2/3  decide`, ""]);
  });

  it("given a verbose release past its last stage, when its place is shown, then no stage name is printed", () => {
    const progress = terminalProgress(VERBOSE, false);

    progress.stage(["read"], 1);

    expect(lines()[1]).toMatch(/ {2}2\/1 {2}$/);
  });

  it("given a release with something to say, when it says it, then it is printed, beside the mascot when there is one", () => {
    terminalProgress(VERBOSE, false).say("happy", "all shipped");
    const hedgehog = drawingOf(true).draw({ mood: "happy", tick: 0, label: "" });
    terminalProgress(HEDGEHOG, false).say("happy", "all shipped");

    expect(lines()).toEqual(["all shipped", `  ${hedgehog} all shipped`, ""]);
  });

  it("given a step in place, when it succeeds, then its line is kept with a tick and its time", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const progress = terminalProgress(VERBOSE, true);

    const result = await progress.during(
      "deploy api",
      "working",
      () => {
        vi.setSystemTime(Date.now() + 65_000);
        return Promise.resolve("shipped");
      },
      { index: 0, total: 1 },
    );

    expect(result).toBe("shipped");
    expect(all()).toContain("⠋ 1/1  deploy api 0s");
    expect(all()).toContain("  ✓ 1/1  deploy api 1m 05s");
  });

  it("given a step in place, when it fails, then its line is kept with a cross and the error goes on", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const progress = terminalProgress(VERBOSE, true);

    await expect(
      progress.during("deploy api", "working", () => {
        vi.setSystemTime(Date.now() + 3_000);
        return Promise.reject(new Error("boom"));
      }),
    ).rejects.toThrow("boom");

    expect(all()).toContain("  ✗ deploy api 3s");
    expect(all()).not.toContain("✓");
  });

  it("given a batch in place, when it ends, then its line counts the items done", async () => {
    const progress = terminalProgress(VERBOSE, true);

    await progress.during("build 3 apps", "working", () => Promise.resolve(), {
      done: () => 2,
      total: 3,
    });

    expect(all()).toContain("  ✓ build 3 apps 2/3  0s");
  });

  it("given a step already in place, when another runs inside it, then the inner one prints above", async () => {
    const progress = terminalProgress(VERBOSE, true);

    await progress.during("ship all", "working", () =>
      progress.during("deploy api", "working", () => Promise.resolve()),
    );

    expect(all()).toContain("  deploy api\n");
    expect(all()).not.toContain("✓ deploy api");
    expect(all()).toContain("  ✓ ship all 0s");
  });

  it("given the hedgehog moving, when a step runs in place, then he is drawn beside it and its line ends ticked", async () => {
    const progress = terminalProgress({ ...HEDGEHOG, motion: true }, true);

    await progress.during("deploy api", "working", () => Promise.resolve());

    expect(all()).toContain(
      `${drawingOf(true).draw({ mood: "working", tick: 0, label: "" })} deploy api 0s`,
    );
    expect(all()).toContain("  ✓ deploy api 0s");
  });

  it("given a child process holding the terminal, when a step ends meanwhile, then its line is written plainly", async () => {
    const progress = terminalProgress(VERBOSE, true);

    const [, status] = await Promise.all([
      progress.during("deploy api", "working", () => Promise.resolve()),
      systemShell.attach(process.execPath, ["-e", "setTimeout(() => {}, 300)"], {
        cwd: process.cwd(),
      }),
    ]);

    expect(status).toBe(0);
    expect(printed.join("")).toContain("  ✓ deploy api 0s\n");
  });
});

describe("talking to the person who runs the release", () => {
  it("given a line to show, when the release prints it, then it goes to stdout, an empty one by default", () => {
    terminalOutput.line("hello");
    terminalOutput.line();

    expect(printed).toEqual(["hello\n", "\n"]);
  });

  it("given GITHUB_ACTIONS set to true or false, when the release checks where it runs, then only true counts as a CI job", () => {
    vi.stubEnv("GITHUB_ACTIONS", "true");
    const inside = onGitHubActions();
    vi.stubEnv("GITHUB_ACTIONS", "false");

    expect([inside, onGitHubActions()]).toEqual([true, false]);
  });

  it("given a release waiting, when time is read after the wait, then real time has passed", async () => {
    const before = Date.now();

    await systemClock.sleep(20);

    expect(systemClock.now().getTime() - before).toBeGreaterThanOrEqual(15);
  });

  it("given no terminal to ask in, when the release asks a question, then every answer is no", async () => {
    const prompter = terminalPrompter();
    const started = Date.now();

    expect(prompter.interactive).toBe(false);
    expect(
      await Promise.all([
        prompter.confirm("Ship?", true),
        prompter.typed("Type ship", "ship"),
        prompter.select("Which?", [{ value: "a", label: "A" }]),
        prompter.multiselect("Which ones?", [{ value: "a", label: "A" }], []),
        prompter.text("Name?"),
        prompter.waitForKey("waiting", 30, ["r"]),
      ]),
    ).toEqual([false, false, null, null, null, null]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
  });
});
