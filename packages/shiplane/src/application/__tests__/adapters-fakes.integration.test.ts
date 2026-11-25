import { describe, expect, it } from "vitest";

import {
  CiPipelineFake,
  ciPipelineFake,
} from "../../adapters/ci-pipeline/__fakes__/ci-pipeline.fake";
import { CodeHostFake, codeHostFake } from "../../adapters/code-host/__fakes__/code-host.fake";
import { MemoryFiles } from "../../adapters/files/__fakes__/memory-files.fake";
import { RecordingShell } from "../../adapters/shell/__fakes__/shell.fake";
import {
  SourceControlFake,
  sourceControlFake,
} from "../../adapters/source-control/__fakes__/source-control.fake";
import { RecordingProgress } from "../../adapters/terminal/__fakes__/progress.fake";
import {
  FixedClock,
  MemoryOutput,
  ScriptedPrompter,
} from "../../adapters/terminal/__fakes__/terminal.fake";
import {
  VersioningFake,
  versioningFake,
} from "../../adapters/versioning/__fakes__/versioning.fake";

const PR = { number: 7, url: "https://host.test/acme/repo/pull/7", head: "sha-7" };

describe("rehearsing a release against files held in memory", () => {
  it("given files in nested folders, when the root and a folder are listed, then entries and folders are told apart", () => {
    const files = new MemoryFiles({
      "./apps/api/package.json": "{}",
      "apps/web/a.md": "a",
      "README.md": "r",
    });

    expect({
      root: files.list("."),
      rootAgain: files.list(""),
      apps: files.list("apps"),
      rootFolders: files.folders("."),
      appFolders: files.folders("apps"),
      apiFolders: files.folders("apps/api"),
    }).toEqual({
      root: ["README.md", "apps"],
      rootAgain: ["README.md", "apps"],
      apps: ["api", "web"],
      rootFolders: ["apps"],
      appFolders: ["api", "web"],
      apiFolders: [],
    });
  });

  it("given a file, when it and its folder are looked for, then both exist but a name it only starts with does not", () => {
    const files = new MemoryFiles({ "apps/api/package.json": "{}" });

    expect([
      files.exists("apps"),
      files.exists("apps/api/package.json"),
      files.exists("app"),
    ]).toEqual([true, true, false]);
    expect(files.read("./apps/api/package.json")).toBe("{}");
    expect(files.read("apps/none")).toBeNull();
  });

  it("given files written and removed, when the repository is read back, then each change is kept in order and the snapshot is sorted", () => {
    const files = new MemoryFiles({ "b.md": "b" });

    files.write("a.md", "a");
    files.remove("b.md");

    expect(files.changes).toEqual([
      { kind: "write", file: "a.md" },
      { kind: "remove", file: "b.md" },
    ]);
    expect(files.all).toEqual({ "a.md": "a" });
    expect(Object.keys(new MemoryFiles({ "z.md": "", "a.md": "" }).all)).toEqual(["a.md", "z.md"]);
  });
});

describe("rehearsing a release against a shell that runs nothing", () => {
  it("given an answer seeded once ahead of a lasting one, when the command runs twice, then the first gets the one-off answer", async () => {
    const shell = new RecordingShell()
      .seed("git push", { status: 1 })
      .seedOnce("git push", { status: 0, stdout: "ok" });

    const first = await shell.capture("git", ["push"], { cwd: "/repo" });
    const second = await shell.attach("git", ["push", "--tags"]);

    expect([first, second]).toEqual([{ status: 0, stdout: "ok", stderr: "" }, 1]);
    expect(shell.calls).toEqual([
      { command: "git", args: ["push"], cwd: "/repo", env: undefined },
      { command: "git", args: ["push", "--tags"], cwd: undefined, env: undefined },
    ]);
  });

  it("given variables set in two goes, when the release reads them, then both are there", () => {
    const shell = new RecordingShell().seedEnv({ A: "1" }).seedEnv({ B: "2" });

    expect([shell.env("A"), shell.env("B"), shell.env("C")]).toEqual(["1", "2", undefined]);
  });
});

describe("rehearsing a release against a repository history held in memory", () => {
  it("given what the repository holds, when a release reads its history, then each known answer comes back and anything unknown is empty", async () => {
    const fake = new SourceControlFake().seed({
      versionCommits: { "apps/api@1.0.0": { sha: "s1", subject: "release" } },
      diffs: { "a..b": ["x.ts"] },
      mergeBases: { "a...b": "base" },
      commits: { "a..b": [{ subject: "feat: x", files: ["x.ts"] }] },
      files: { "main:package.json": "{}" },
      defaultBranch: "master",
      clean: false,
    });

    expect(
      await Promise.all([
        fake.versionCommit("apps/api", "package.json", "1.0.0"),
        fake.versionCommit("apps/api", "package.json", "2.0.0"),
        fake.diffNames("a", "b"),
        fake.diffNames("b", "c"),
        fake.mergeBase("a", "b"),
        fake.mergeBase("c", "d"),
        fake.commitsBetween("a", "b"),
        fake.commitsBetween("b", "c"),
        fake.fileAt("main", "package.json"),
        fake.fileAt("main", "none"),
        fake.defaultBranch(),
        fake.isClean(),
      ]),
    ).toEqual([
      { sha: "s1", subject: "release" },
      null,
      ["x.ts"],
      [],
      "base",
      "c",
      [{ subject: "feat: x", files: ["x.ts"] }],
      [],
      "{}",
      null,
      "master",
      false,
    ]);
  });

  it("given every write a release makes to the repository, when they run, then each is recorded in order and no changed file is left", async () => {
    const { fake, name, create } = sourceControlFake();
    fake.seed({ changed: ["a.md", "b.md", "c.md"] });

    await fake.commit(["a.md"], "docs: a", "body", { skipHooks: true });
    await fake.commit(["b.md"], "docs: b");
    await fake.push("main");
    await fake.pull();
    await fake.pushTags(["v1"]);
    await fake.discard(["c.md"]);
    await fake.deleteBranch("old");
    await fake.deleteRemoteBranch("old");

    expect({ name, same: create({ root: "/", shell: new RecordingShell() }) === fake }).toEqual({
      name: "fake",
      same: true,
    });
    expect(fake.received).toEqual([
      { type: "commit", files: ["a.md"], title: "docs: a", body: "body", skipHooks: true },
      { type: "commit", files: ["b.md"], title: "docs: b", body: undefined },
      { type: "push", branch: "main" },
      { type: "pull" },
      { type: "push-tags", names: ["v1"] },
      { type: "discard", files: ["c.md"] },
      { type: "delete-branch", name: "old" },
      { type: "delete-remote", branch: "old" },
    ]);
    expect(await fake.changedFiles()).toEqual([]);
  });

  it("given a push set to fail the second time, when a release pushes twice, then only the second fails, and it is still recorded", async () => {
    const fake = new SourceControlFake().failAt("push", 2, new Error("rejected"));

    await fake.push("main");
    await expect(fake.push("main")).rejects.toThrow("rejected");
    await fake.pull();

    expect(fake.received.map(({ type }) => type)).toEqual(["push", "push", "pull"]);
  });

  it("given ignored files, when a release looks for them by pattern, then a star stays within a folder and dots are literal", async () => {
    const fake = new SourceControlFake().seed({
      ignored: [".env", ".env.local", "apps/.env", "xenv", "a+b.log"],
    });

    expect(await fake.ignoredFiles([".env*", "a+b.log"])).toEqual([
      ".env",
      ".env.local",
      "a+b.log",
    ]);
    expect(await fake.ignoredFiles([])).toEqual([]);
  });

  it("given a worktree added then removed, when the release's activity is read, then both steps are recorded", async () => {
    const fake = new SourceControlFake();

    await fake.addWorktree("/tmp/w", "v1");
    await fake.removeWorktree("/tmp/w");

    expect(fake.received).toEqual([
      { type: "worktree-add", dir: "/tmp/w", ref: "v1" },
      { type: "worktree-remove", dir: "/tmp/w" },
    ]);
  });
});

describe("rehearsing a release against a code host held in memory", () => {
  it("given a pull request that opens then merges, when a release waits on it, then it sees each state and stays merged", async () => {
    const fake = new CodeHostFake().seed({ prStates: { 7: ["OPEN", "MERGED"] } });

    const states = [await fake.prState(PR), await fake.prState(PR), await fake.prState(PR)];

    expect(states).toEqual(["OPEN", "MERGED", "MERGED"]);
    expect(fake.polled).toEqual([7, 7, 7]);
  });

  it("given a release that merges its pull request, when its state is read, then it is merged by the squash offered first", async () => {
    const fake = new CodeHostFake();

    await fake.merge(PR, "--squash");

    expect(await fake.prState(PR)).toBe("MERGED");
    expect(fake.received).toEqual([{ type: "merge", pr: PR, method: "--squash" }]);
    expect(await fake.mergeMethods()).toEqual({
      allowed: ["--squash", "--merge", "--rebase"],
      preselected: "--squash",
    });
  });

  it("given open release and feature pull requests, when a release looks for its own, then only the release branch matches", async () => {
    const fake = new CodeHostFake();
    const release = await fake.createPr({
      base: "main",
      head: "release/a",
      title: "t",
      body: "b",
      label: "l",
    });
    await fake.createPr({ base: "main", head: "feat/b", title: "t", body: "b", label: "l" });

    expect(await fake.openPrsFrom("release/")).toEqual([release]);
    expect(release).toEqual({
      number: 1800,
      url: "https://host.test/acme/repo/pull/1800",
      head: "sha-1800",
    });
  });

  it("given the host refusing every write, when a release tries each, then each fails and nothing is recorded", async () => {
    const error = new Error("forbidden");
    const fake = new CodeHostFake()
      .failCreate(error)
      .failClose(error)
      .failRelease(error)
      .failComment(error);

    await expect(
      fake.createPr({ base: "m", head: "h", title: "t", body: "b", label: "l" }),
    ).rejects.toBe(error);
    await expect(fake.closePr(PR, "bye")).rejects.toBe(error);
    await expect(fake.createRelease("v1", "notes", true)).rejects.toBe(error);
    await expect(fake.comment({ repository: "acme/repo", number: 1 }, "hi")).rejects.toBe(error);
    await expect(fake.upsertComment({ on: PR, marker: "m", body: "b" })).rejects.toBe(error);

    expect(fake.received).toEqual([]);
  });

  it("given merged pull requests, when release notes read them, then each comes back, and a missing one fails by its number", async () => {
    const linked = { number: 3, title: "fix", issues: [] };
    const fake = new CodeHostFake().seed({ pullRequests: { 3: linked } as never });

    expect(await fake.pullRequests([3])).toEqual([linked]);
    await expect(fake.pullRequests([3, 4])).rejects.toThrow("no pull request #4");
    expect(fake.reads).toEqual(["pull-requests", "pull-requests"]);
  });

  it("given a release comment on a pull request with others, when it is posted again, then only the marked comment changes", async () => {
    const fake = new CodeHostFake().seed({
      comments: { "acme/repo#7": ["other", "<!-- m --> old"] },
    });

    await fake.upsertComment({ on: PR, marker: "<!-- m -->", body: "<!-- m --> new" });
    await fake.upsertComment({ on: PR, marker: "<!-- n -->", body: "<!-- n --> added" });

    expect(await fake.comments([{ repository: "acme/repo", number: 7 }])).toEqual([
      ["other", "<!-- m --> new", "<!-- n --> added"],
    ]);
    expect(fake.received).toEqual([
      { type: "upsert-comment", issue: "acme/repo#7", body: "<!-- m --> new", edited: true },
      { type: "upsert-comment", issue: "acme/repo#7", body: "<!-- n --> added", edited: false },
    ]);
  });

  it("given releases with and without a previous tag, when they are published, then the previous tag is kept only when given", async () => {
    const { fake, name, create } = codeHostFake();

    await fake.createRelease("v2", "notes", true, "v1");
    await fake.createRelease("v3", "notes", false);
    await fake.showDiff();
    await fake.openInBrowser();

    expect(name).toBe("fake");
    expect(create({ root: "/", shell: new RecordingShell() })).toBe(fake);
    expect(fake.received).toEqual([
      { type: "release", tag: "v2", notes: "notes", latest: true, previous: "v1" },
      { type: "release", tag: "v3", notes: "notes", latest: false },
    ]);
  });
});

describe("rehearsing a ship through CI held in memory", () => {
  it("given a ship sent to CI, when it is dispatched, then it is recorded and the line shown is the command to run it by hand", async () => {
    const { fake, name } = ciPipelineFake();

    await fake.dispatch("ship.yml", "v1", { app: "api" });

    expect(name).toBe("fake");
    expect(fake.received).toEqual([
      { type: "dispatch", workflow: "ship.yml", ref: "v1", inputs: { app: "api" } },
    ]);
    expect(fake.dispatchLine("ship.yml", "v1", { app: "api", env: "preview" })).toBe(
      "fake-ci run ship.yml --ref v1 -f app=api -f env=preview",
    );
    expect(fake.workflowFile("ship.yml")).toBe("ci/ship.yml");
    expect([fake.label, fake.shipWorkflow, new CiPipelineFake("deploy.yml").shipWorkflow]).toEqual([
      "Fake CI",
      "ship.yml",
      "deploy.yml",
    ]);
  });

  it("given past runs and their minutes, when a release estimates its time, then only that workflow's runs count", async () => {
    const run = { title: "Deploy v1 to preview", state: "done" as const };
    const fake = new CiPipelineFake().seed({
      workflowRuns: { "ship.yml": [run] },
      measured: { "ship.yml": [3, 4] },
    });

    expect(await fake.workflowRuns("ship.yml")).toEqual([run]);
    expect(await fake.measuredMinutes("ship.yml")).toEqual([3, 4]);
    expect(await fake.measuredMinutes("other.yml")).toEqual([]);
  });
});

describe("rehearsing version bumps held in memory", () => {
  it("given a change written twice under one id, when the pending changes are read, then the second replaces the first, as a changeset file", async () => {
    const { fake, name } = versioningFake();

    await fake.write({ id: "c1", releases: [{ name: "a", type: "patch" }], summary: "first" });
    await fake.write({
      id: "c1",
      releases: [
        { name: "a", type: "minor" },
        { name: "b", type: "major" },
      ],
      summary: "second",
    });

    expect(name).toBe("fake");
    expect(await fake.pending()).toEqual([
      { id: "c1", text: '---\n"a": minor\n"b": major\n---\n\nsecond\n' },
    ]);
  });

  it("given a known plan and dependencies, when a release plans and applies its bumps, then it gets that plan and the bump is recorded", async () => {
    const added = [{ id: "c1", releases: [], summary: "s" }];
    const fake = new VersioningFake().seed({
      plan: (planned, held, ceiling) =>
        ({
          changesets: [],
          releases: [
            {
              name: `${planned.length}-${held.length}-${ceiling}`,
              type: "patch",
              oldVersion: "",
              newVersion: "",
            },
          ],
        }) as never,
      dependencies: { a: ["b"] },
    });

    const plan = await fake.plan(added, [], "minor");
    await fake.apply(added, [], "minor");

    expect(plan.releases[0]?.name).toBe("1-0-minor");
    expect(await fake.dependencies()).toEqual({ a: ["b"] });
    expect(fake.applied).toEqual([{ added, held: [], ceiling: "minor" }]);
    expect(fake.nextChange).toBe("pnpm changeset");
  });
});

describe("rehearsing a release with a scripted person at the terminal", () => {
  it("given scripted answers, when the release asks its questions, then each gets the next answer and what was offered is kept", async () => {
    const prompter = new ScriptedPrompter().answer(true, "ship", "b", ["a"], "name", null);
    const choices = [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ];

    const answers = [
      await prompter.confirm("Ship?"),
      await prompter.typed("Type ship", "ship"),
      await prompter.select("Which?", choices, "a"),
      await prompter.multiselect("Which ones?", choices, ["b"]),
      await prompter.text("Name?"),
      await prompter.confirm("Again?", true),
    ];

    expect(answers).toEqual([true, true, "b", ["a"], "name", false]);
    expect(prompter.asked).toEqual([
      "Ship?",
      "Type ship",
      "Which?",
      "Which ones?",
      "Name?",
      "Again?",
    ]);
    expect(prompter.initials).toEqual({
      "Ship?": false,
      "Which?": "a",
      "Which ones?": ["b"],
      "Again?": true,
    });
    expect(prompter.choices).toEqual({ "Which?": choices, "Which ones?": choices });
    expect(() => prompter.confirm("More?")).toThrow("Unexpected question: More?");
    expect(new ScriptedPrompter(false).interactive).toBe(false);
  });

  it("given keys pressed ahead, when the release waits on the person, then each wait takes the next key, then times out", async () => {
    const prompter = new ScriptedPrompter().press("r", "q");

    expect([
      await prompter.waitForKey(),
      await prompter.waitForKey(),
      await prompter.waitForKey(),
    ]).toEqual(["r", "q", null]);
  });

  it("given coloured lines printed, when the output is read back, then it is plain text, one line each", () => {
    const output = new MemoryOutput();

    output.line("\u001B[1m\u001B[32mshipped\u001B[39m\u001B[22m");
    output.line();

    expect(output.lines).toEqual(["shipped", ""]);
    expect(output.text).toBe("shipped\n");
  });

  it("given a fixed clock, when the release waits, then no time passes", async () => {
    const at = new Date("2026-01-01T00:00:00Z");
    const clock = new FixedClock(at);

    await clock.sleep();

    expect(clock.now()).toBe(at);
  });

  it("given a release going through stages, steps and batches, when it reports progress, then each is recorded and only what it says is printed", async () => {
    const output = new MemoryOutput();
    const progress = new RecordingProgress(output);

    progress.stage(["read", "ship"], 1);
    progress.stage(["read"], 4);
    await progress.during("one", "working", () => Promise.resolve(1), { index: 0, total: 2 });
    await progress.during("batch", "working", () => Promise.resolve(2), {
      done: () => 1,
      total: 3,
    });
    await progress.during("plain", "thinking", () => Promise.resolve(3));
    progress.say("happy", "done");

    expect(progress.events).toEqual([
      { kind: "stage", text: "ship", step: { index: 1, total: 2 } },
      { kind: "stage", text: "", step: { index: 4, total: 1 } },
      { kind: "during", mood: "working", text: "one", step: { index: 0, total: 2 } },
      { kind: "during", mood: "working", text: "batch", batch: 3 },
      { kind: "during", mood: "thinking", text: "plain" },
      { kind: "say", mood: "happy", text: "done" },
    ]);
    expect(output.lines).toEqual(["done"]);
  });
});
