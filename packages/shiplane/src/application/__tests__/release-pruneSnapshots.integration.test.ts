import { describe, expect, it } from "vitest";

import { packageRegistryFake } from "../../adapters/package-registry/__fakes__/package-registry.fake";
import { publishedPackage } from "../../modules/published-package/published-package.module";
import { testContext, testUnit } from "../../testing/releaseContext";
import { pruneSnapshots } from "../pruneSnapshots";

// The test clock reads 2026-10-12T09:00:00Z.
const daysAgo = (days: number) =>
  new Date(Date.parse("2026-10-12T09:00:00Z") - days * 86_400_000).toISOString();

const lib = testUnit("lib", {
  dir: "packages/lib",
  packageName: "@acme/lib",
  version: "1.2.0",
  module: "published-package",
});

const TAGS = [
  { tag: "latest", version: "1.2.0", publishedAt: daysAgo(90) },
  { tag: "old-branch", version: "1.3.0-old-branch.ae08284", publishedAt: daysAgo(45) },
  { tag: "gone-too", version: "1.3.0-gone-too.bc12345", publishedAt: daysAgo(31) },
  { tag: "fresh", version: "1.3.0-fresh.cd12345", publishedAt: daysAgo(2) },
  { tag: "beta", version: "1.3.0-beta.4", publishedAt: daysAgo(120) },
];

const world = ({ yes = true, interactive = false } = {}) => {
  const registry = packageRegistryFake();
  registry.fake.seed({ tags: { "@acme/lib": TAGS } });
  const made = testContext({
    units: [lib],
    modules: [publishedPackage({ packageRegistry: registry })],
    yes,
    interactive,
  });
  made.source.seed({ position: { branch: "main", head: "abc1234", originMain: "abc1234" } });
  return made;
};

const untags = (calls: { command: string; args: string[] }[]) =>
  calls.map(({ args }) => args.join(" ")).filter((line) => line.startsWith("untag"));

describe("removing the npm tags old snapshots left", () => {
  it("given snapshot tags older and younger than 30 days, when pruned with --yes, then only the old ones go and latest and beta stay", async () => {
    const { context, shell, output } = world();

    const done = await pruneSnapshots(context, { otp: "123456" });

    expect(done).toBe(true);
    expect(untags(shell.calls)).toEqual([
      "untag @acme/lib old-branch otp=123456",
      "untag @acme/lib gone-too otp=123456",
    ]);
    expect(output.lines).toContain(
      "  @acme/lib  old-branch  1.3.0-old-branch.ae08284  45 days ago",
    );
    expect(output.text).toContain("✓ Removed 2 tags");
  });

  it("given a dry run, when pruned, then it lists the tags and removes none", async () => {
    const { context, shell, output } = world();

    await pruneSnapshots(context, { dryRun: true });

    expect(untags(shell.calls)).toEqual([]);
    expect(output.text).toContain("2 snapshot tags older than 30 days (dry run)");
    expect(output.text).toContain("Nothing removed.");
  });

  it("given no terminal and no --yes, when pruned, then it removes nothing and says to add --yes", async () => {
    const { context, shell, output } = world({ yes: false });

    const done = await pruneSnapshots(context, {});

    expect(done).toBe(false);
    expect(untags(shell.calls)).toEqual([]);
    expect(output.text).toContain("add --yes");
  });

  it("given a terminal, when the person agrees and types a code, then each removal passes that code", async () => {
    const { context, shell, prompter } = world({ yes: false, interactive: true });
    prompter.answer(true, "654321");

    await pruneSnapshots(context, {});

    expect(untags(shell.calls)).toEqual([
      "untag @acme/lib old-branch otp=654321",
      "untag @acme/lib gone-too otp=654321",
    ]);
  });

  it("given a code that expires midway in a terminal, when a removal fails, then a fresh code retries it and the rest", async () => {
    const { context, shell, prompter } = world({ yes: true, interactive: true });
    shell.seedOnce("echo untag @acme/lib gone-too", { status: 1 });
    prompter.answer("111111");

    const done = await pruneSnapshots(context, { otp: "000000" });

    expect(done).toBe(true);
    expect(untags(shell.calls)).toEqual([
      "untag @acme/lib old-branch otp=000000",
      "untag @acme/lib gone-too otp=000000",
      "untag @acme/lib gone-too otp=111111",
    ]);
  });

  it("given a removal that fails with no terminal, when pruned, then it stops and says a rerun with a fresh --otp picks up the rest", async () => {
    const { context, shell, output } = world();
    shell.seed("echo untag @acme/lib old-branch", { status: 1 });

    const done = await pruneSnapshots(context, { otp: "000000" });

    expect(done).toBe(false);
    expect(untags(shell.calls)).toEqual(["untag @acme/lib old-branch otp=000000"]);
    expect(output.text).toContain("0 tags of 2 removed");
    expect(output.text).toContain("fresh --otp");
  });

  it("given an age under 7 days, when pruned, then it refuses before reading any tag", async () => {
    const { context, shell, output } = world();

    const done = await pruneSnapshots(context, { olderThanDays: 3 });

    expect(done).toBe(false);
    expect(shell.calls).toEqual([]);
    expect(output.text).toContain("7 or more");
  });

  it("given no snapshot tag old enough, when pruned, then it says so and runs nothing", async () => {
    const { context, shell, progress } = world();

    await pruneSnapshots(context, { olderThanDays: 400 });

    expect(shell.calls).toEqual([]);
    expect(progress.events.at(-1)).toMatchObject({ text: "No snapshot tag older than 400 days." });
  });
});
