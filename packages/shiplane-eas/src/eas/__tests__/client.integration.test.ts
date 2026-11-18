import { RecordingShell } from "shiplane/testing";
import { describe, expect, it } from "vitest";

import { easClient } from "../client";

const CWD = "/repo/apps/expo";

const clientOver = (shell: RecordingShell) => easClient({ shell, cwd: CWD });

const easBuild = (overrides: Record<string, unknown> = {}) => ({
  id: "build-1",
  status: "FINISHED",
  buildProfile: "preview",
  isForIosSimulator: false,
  appVersion: "0.1.115",
  appBuildVersion: "158",
  gitCommitHash: "built-from",
  createdAt: "2026-10-11T00:42:23.771Z",
  fingerprint: { hash: "fp-shipped" },
  ...overrides,
});

const listing = (builds: unknown[]) =>
  new RecordingShell().seed("pnpm exec eas build:list", {
    stdout: `A new version of eas-cli is available.\n${JSON.stringify(builds)}\nDone.`,
  });

describe("asking EAS about a channel's builds", () => {
  it("given notices around the JSON and a simulator build on the channel, when the builds are read, then the store build ships and the running one is named", async () => {
    const shell = listing([
      easBuild({ id: "sim", isForIosSimulator: true, appVersion: "9.9.9" }),
      easBuild({ id: "dev", buildProfile: "development", status: "IN_QUEUE" }),
      easBuild({ id: "queued", status: "NEW", appVersion: "0.1.116", appBuildVersion: null }),
      easBuild({ fingerprint: null, appBuildVersion: null, gitCommitHash: null }),
    ]);

    const builds = await clientOver(shell).channelBuilds({
      platform: "ios",
      environment: "preview",
    });

    expect(builds).toEqual({
      shipped: {
        id: "build-1",
        appVersion: "0.1.115",
        buildNumber: null,
        fingerprint: null,
        gitCommit: null,
        createdAt: "2026-10-11T00:42:23.771Z",
      },
      running: { id: "queued", appVersion: "0.1.116", buildNumber: null },
    });
    expect(shell.calls).toEqual([
      {
        command: "pnpm",
        args: [
          "exec",
          "eas",
          "build:list",
          "--platform",
          "ios",
          "--limit",
          "30",
          "--json",
          "--non-interactive",
        ],
        cwd: CWD,
        env: { APP_VARIANT: "preview" },
      },
    ]);
  });

  it("given the channel read once, when a version's builds are read next, then EAS is not asked again", async () => {
    const shell = listing([easBuild()]);
    const client = clientOver(shell);

    await client.channelBuilds({ platform: "android", environment: "preview" });
    await client.versionBuilds({ platform: "android", environment: "preview", version: "0.1.115" });

    expect(shell.calls).toHaveLength(1);
  });

  it("given a canceled build after the last finished one, when the version's builds are read, then it is reported canceled with its commit", async () => {
    const shell = listing([
      easBuild({ id: "canceled", status: "CANCELED", gitCommitHash: "tagged" }),
      easBuild({ id: "running", status: "IN_PROGRESS" }),
      easBuild({ id: "finished" }),
      easBuild({ id: "other-version", appVersion: "0.1.114" }),
    ]);

    const builds = await clientOver(shell).versionBuilds({
      platform: "ios",
      environment: "preview",
      version: "0.1.115",
    });

    expect(builds.finished?.id).toBe("finished");
    expect(builds.running).toEqual({ id: "running", appVersion: "0.1.115", buildNumber: "158" });
    expect(builds.failed).toEqual({
      id: "canceled",
      status: "canceled",
      createdAt: "2026-10-11T00:42:23.771Z",
      gitCommit: "tagged",
    });
  });

  it("given an errored build with no commit and no finished one, when the version's builds are read, then it is reported errored", async () => {
    const shell = listing([easBuild({ id: "errored", status: "ERRORED", gitCommitHash: null })]);

    const builds = await clientOver(shell).versionBuilds({
      platform: "ios",
      environment: "preview",
      version: "0.1.115",
    });

    expect(builds).toEqual({
      finished: null,
      running: null,
      failed: {
        id: "errored",
        status: "errored",
        createdAt: "2026-10-11T00:42:23.771Z",
        gitCommit: null,
      },
    });
  });

  it("given a build finished after an errored one, when the version's builds are read, then no failure is left to retry", async () => {
    const shell = listing([
      easBuild({ id: "finished" }),
      easBuild({ id: "old", status: "ERRORED" }),
    ]);

    const builds = await clientOver(shell).versionBuilds({
      platform: "ios",
      environment: "preview",
      version: "0.1.115",
    });

    expect(builds.finished?.id).toBe("finished");
    expect(builds.failed).toBeNull();
  });

  it("given eas fails after its upgrade notice, when the builds are read, then the error names the command, the exit code and eas's own error line", async () => {
    const shell = new RecordingShell().seed("pnpm exec eas build:list", {
      status: 1,
      stderr: "  ★ eas-cli@16.0.0 is now available.  \n\nError: Not logged in\nRun eas login\n",
    });

    await expect(
      clientOver(shell).channelBuilds({ platform: "ios", environment: "production" }),
    ).rejects.toThrow("eas build:list exited with 1: Error: Not logged in");
  });

  it("given eas fails with no error line, when the builds are read, then the error ends on its last trimmed line", async () => {
    const shell = new RecordingShell().seed("pnpm exec eas build:list", {
      status: 2,
      stderr: "first line\n  last line  \n\n",
    });

    await expect(
      clientOver(shell).channelBuilds({ platform: "ios", environment: "production" }),
    ).rejects.toThrow(/^eas build:list exited with 2: last line$/);
  });
});

describe("asking EAS what a platform submitted", () => {
  it("given a paged answer with both ways of naming the build and one unreadable entry, when read, then each readable submission comes back with its build", async () => {
    const shell = new RecordingShell().seed("pnpm exec eas submit:list", {
      stdout: JSON.stringify({
        currentPage: [
          {
            id: "s1",
            status: "AWAITING_BUILD",
            createdAt: "2026-10-11T01:00:00.000Z",
            submittedBuild: { id: "b1" },
          },
          { id: "s2", status: "ERRORED", buildId: "b2" },
          { id: "s3", status: "FINISHED" },
          { status: "FINISHED" },
        ],
      }),
    });

    const submissions = await clientOver(shell).submissions({
      platform: "android",
      environment: "production",
    });

    expect(submissions).toEqual([
      { id: "s1", status: "awaiting-build", createdAt: "2026-10-11T01:00:00.000Z", buildId: "b1" },
      { id: "s2", status: "errored", createdAt: null, buildId: "b2" },
      { id: "s3", status: "finished", createdAt: null, buildId: null },
    ]);
    expect(shell.calls[0]?.args).toEqual([
      "exec",
      "eas",
      "submit:list",
      "--platform",
      "android",
      "--limit",
      "10",
      "--json",
      "--non-interactive",
    ]);
  });

  it("given eas fails to list submissions, when read, then nothing is known and nothing throws", async () => {
    const shell = new RecordingShell().seed("pnpm exec eas submit:list", {
      status: 1,
      stderr: "Error: boom\n",
    });

    await expect(
      clientOver(shell).submissions({ platform: "ios", environment: "preview" }),
    ).resolves.toBeNull();
  });
});

describe("asking EAS what native code changed", () => {
  it("given sources added, changed, removed and kept, when compared with the last build, then each change is listed once by its file, id or type", async () => {
    const shell = new RecordingShell().seed("pnpm exec eas fingerprint:compare", {
      stdout: JSON.stringify({
        fingerprint1: {
          hash: "old",
          sources: [
            { type: "file", filePath: "../../node_modules/expo/package.json", hash: "a" },
            { type: "file", filePath: "ios/Podfile.lock", hash: "same" },
            { type: "contents", id: "expoConfig", hash: "c1" },
            { type: "dir", filePath: "android", hash: "d" },
          ],
        },
        fingerprint2: {
          hash: "new",
          sources: [
            { type: "file", filePath: "../../node_modules/expo/package.json", hash: "b" },
            { type: "file", filePath: "ios/Podfile.lock", hash: "same" },
            { type: "contents", id: "expoConfig", hash: "c2" },
            { type: "contents", id: "packageJson:scripts", hash: "e" },
            { type: "patches", hash: null },
          ],
        },
      }),
    });

    const changes = await clientOver(shell).nativeChanges({
      buildId: "build-1",
      environment: "preview",
    });

    expect(changes).toEqual([
      "~ node_modules/expo/package.json",
      "~ expoConfig",
      "+ packageJson:scripts",
      "+ patches",
      "- android",
    ]);
    expect(shell.calls[0]?.args.slice(2, 5)).toEqual([
      "fingerprint:compare",
      "--build-id",
      "build-1",
    ]);
  });
});

describe("asking EAS about a channel's updates", () => {
  it("given the newest group fully rolled out, when the last update is read, then it reaches everyone", async () => {
    const shell = new RecordingShell().seed("pnpm exec eas update:list --branch production", {
      stdout: JSON.stringify({ currentPage: [{ group: "g1" }, { group: "g0" }] }),
    });

    const last = await clientOver(shell).lastUpdate("production");

    expect(last).toEqual({ group: "g1", rolloutPercentage: 100 });
    expect(shell.calls[0]?.args).toEqual([
      "exec",
      "eas",
      "update:list",
      "--branch",
      "production",
      "--limit",
      "1",
      "--json",
      "--non-interactive",
    ]);
  });

  it("given no update on the channel, when the last update is read, then there is none", async () => {
    const shell = new RecordingShell().seed("pnpm exec eas update:list", {
      stdout: JSON.stringify({ currentPage: [] }),
    });

    await expect(clientOver(shell).lastUpdate("preview")).resolves.toBeNull();
  });

  it("given an update group, when its origin is read, then eas is asked without --non-interactive and the commit and date come back", async () => {
    const shell = new RecordingShell().seed("pnpm exec eas update:view g1", {
      stdout: JSON.stringify([{ gitCommitHash: "abc", createdAt: "2026-10-10T09:00:00.000Z" }]),
    });

    const origin = await clientOver(shell).updateOrigin({ group: "g1", environment: "preview" });

    expect(origin).toEqual({ commit: "abc", createdAt: "2026-10-10T09:00:00.000Z" });
    expect(shell.calls[0]?.args).toEqual(["exec", "eas", "update:view", "g1", "--json"]);
  });

  it("given an update group eas lists nothing for, when its origin is read, then neither commit nor date is known", async () => {
    const shell = new RecordingShell().seed("pnpm exec eas update:view", { stdout: "[]" });

    await expect(
      clientOver(shell).updateOrigin({ group: "g1", environment: "preview" }),
    ).resolves.toEqual({ commit: null, createdAt: null });
  });
});
