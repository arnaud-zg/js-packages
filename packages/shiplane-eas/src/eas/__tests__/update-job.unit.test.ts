import { spawnSync } from "node:child_process";
import path from "node:path";
import type { Workspace } from "shiplane/testing";
import { createWorkspace, TEST_FLOW, testUnit } from "shiplane/testing";
import { afterEach, describe, expect, it } from "vitest";

import type { EasInput } from "../options";
import { updateJob } from "../jobs";

let workspace: Workspace | undefined;
afterEach(() => workspace?.remove());

const input: EasInput = {
  unit: testUnit("expo", { dir: "apps/expo", module: "mobile-app" }),
  tag: "expo@0.7.1",
  environment: "staging",
  flow: TEST_FLOW,
  options: { versionFile: "app-version.json", update: "eas:update:staging" },
  commit: "c0ffee",
  defaultBranch: "main",
};

/** The update job's pnpm args, the script holding `command`. */
const argsWith = (command: string) => {
  workspace = createWorkspace({
    "apps/expo/package.json": JSON.stringify({ scripts: { "eas:update:staging": command } }),
  });
  return updateJob(input, workspace.root).local[0]?.args;
};

describe("publishing an update off a terminal", () => {
  it("given a script that names no message, when the update is published, then the tag is its message", () => {
    expect(argsWith("APP_VARIANT=staging eas update --channel staging")).toEqual([
      "run",
      "eas:update:staging",
      "--message",
      "expo@0.7.1",
    ]);
  });

  it.each(["--message 'from the script'", "-m hi", "--message=hi", "--auto"])(
    "given a script that names the update with %s, when the update is published, then it runs as written",
    (flag) => {
      expect(argsWith(`eas update --channel staging ${flag}`)).toEqual([
        "run",
        "eas:update:staging",
      ]);
    },
  );

  it("given a script that names no message, when pnpm runs the update, then the script gets the message and no --", () => {
    workspace = createWorkspace({
      "apps/expo/package.json": JSON.stringify({
        scripts: { "eas:update:staging": "node argv.js" },
      }),
      "apps/expo/argv.js": "console.log(JSON.stringify(process.argv.slice(2)));",
    });
    const [step] = updateJob(input, workspace.root).local;
    const run = spawnSync(step?.command ?? "", step?.args ?? [], {
      cwd: path.join(workspace.root, step?.cwd ?? ""),
      encoding: "utf8",
    });

    expect(run.stdout.trim().split("\n").at(-1)).toBe(JSON.stringify(["--message", "expo@0.7.1"]));
  });

  it("given no repository to read the script from, when the update is published, then it runs as written", () => {
    expect(updateJob(input).local[0]?.args).toEqual(["run", "eas:update:staging"]);
  });
});
