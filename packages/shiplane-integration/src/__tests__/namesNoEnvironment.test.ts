import { globSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import { gitHubActionsCiPipeline } from "@shiplane/github";
import { RecordingShell } from "shiplane/testing";
import { describe, expect, it } from "vitest";

import { REPOSITORY_ROOT } from "../examples";

// An environment's name is its repository's: nothing shiplane ships may know one. Whole files are
// read, comments and messages included, so no default, label or identifier brings one back.

const NAME = /preview|production/i;

/** What Cloudflare's own command line calls its two: the one constant that says so. */
const CLOUDFLARES_OWN =
  /^const WRANGLER_ENV = \{ users: "production", others: "preview" \} as const;$/;

const TESTS = /__tests__|__fakes__|\.contract\.ts$|\/testing\//;

const naming = (files: readonly string[]) =>
  files.flatMap((file) =>
    readFileSync(file, "utf8")
      .split("\n")
      .flatMap((line, index) =>
        NAME.test(line) && !CLOUDFLARES_OWN.test(line)
          ? [`${relative(REPOSITORY_ROOT, file)}:${index + 1}: ${line.trim()}`]
          : [],
      ),
  );

const found = (pattern: string) => globSync(`${REPOSITORY_ROOT}/${pattern}`);

describe("what shiplane ships names no environment", () => {
  it("given every package's source, when it is read, then no line names one", () => {
    const files = found("packages/shiplane*/src/**/*.ts").filter((file) => !TESTS.test(file));

    expect(files.length).toBeGreaterThan(100);
    expect(naming(files)).toEqual([]);
  });

  it("given the ship action, this repository's workflows and the config's schema, when they are read, then no line names one", () => {
    const files = [
      ...found(".github/actions/**/*.yml"),
      ...found(".github/workflows/*.yml"),
      ...found("packages/shiplane/shiplane.schema.json"),
    ];

    expect(files.length).toBeGreaterThan(3);
    expect(naming(files)).toEqual([]);
  });

  it("given a repository's own names, when ship.yml is made for it, then it holds those and no other", async () => {
    const shell = new RecordingShell();
    shell.seed("gh api repos/arnaud-zg/js-packages/git/ref/tags/shiplane@0.6.0", {
      stdout: JSON.stringify({ object: { sha: "c0ffee", type: "commit" } }),
    });
    const made = await gitHubActionsCiPipeline()
      .create({ root: "/repo", shell })
      .callerWorkflow?.("0.6.0", {
        apps: ["dev", "prod"],
        environments: ["dev", "prod"],
        secrets: [],
        features: [],
      });

    const content = made && "content" in made ? made.content : "";
    expect(content).toContain("options: [dev, prod]");
    expect(content).not.toMatch(NAME);
  });
});
