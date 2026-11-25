import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// The setup-node-project action other repositories import, against the steps the ship action runs inline: an
// action cannot use another from its own commit, so the two copies must stay equal.

interface Step {
  name?: string;
  shell?: string;
  "working-directory"?: string;
  [key: string]: unknown;
}

const read = <T>(path: string) =>
  parse(readFileSync(new URL(`../../../../.github/${path}`, import.meta.url), "utf8")) as T;

const action = read<{
  inputs: Record<string, unknown>;
  outputs: Record<string, { value: string }>;
  runs: { using: string; steps: Step[] };
}>("actions/setup-node-project/action.yml");

const ship = read<typeof action>("actions/ship/action.yml");

const FIRST = "Detect the package manager and Node version";
const LAST = "Install";

/** The steps from FIRST to LAST, without what every composite step has: `shell: bash` and the
 * working directory. Both read `inputs.x` the same way. */
const setupSteps = (steps: Step[]) => {
  const from = steps.findIndex(({ name }) => name === FIRST);
  const to = steps.findIndex(({ name }) => name === LAST);
  return steps.slice(from, to + 1).map(({ shell, ...step }) => {
    delete step["working-directory"];
    return shell && shell !== "bash" ? { ...step, shell } : step;
  });
};

describe("the setup-node-project action other repositories import", () => {
  it("given action.yml, when it is read, then it is a composite action with no checkout and no secret", () => {
    expect(action.runs.using).toBe("composite");
    expect(JSON.stringify(action.runs.steps)).not.toMatch(/actions\/checkout|secrets\./);
    expect(Object.keys(action.inputs)).toEqual([
      "node-version",
      "install-command",
      "working-directory",
    ]);
    const outputs = Object.entries(action.outputs).map(([name, { value }]) => [name, value]);
    expect(Object.fromEntries(outputs)).toEqual({
      "package-manager": "${{ steps.detect.outputs.pm }}",
      exec: "${{ steps.detect.outputs.exec }}",
      "cache-hit": "${{ steps.modules.outputs.cache-hit }}",
    });
  });

  it("given the ship action, when its setup steps are compared with the action's, then they are the same steps", () => {
    const inline = setupSteps(ship.runs.steps);

    expect(inline.map(({ name }) => name)).toEqual([
      FIRST,
      "Set up pnpm",
      "Set up Node",
      "Set up yarn",
      "Node version",
      "Cache node_modules",
      LAST,
    ]);
    expect(setupSteps(action.runs.steps)).toEqual(inline);
  });

  it("given the action, when each run step runs, then it runs in bash or node from the working-directory input", () => {
    const runs = action.runs.steps.filter((step) => "run" in step);

    expect(runs.map(({ shell }) => shell)).toEqual(["node {0}", "bash", "bash", "bash"]);
    for (const step of runs) {
      expect(step["working-directory"]).toBe("${{ inputs.working-directory }}");
    }
  });

  it("given node_modules, when the job runs, then one cache step restores it and saves it at the end of the job", () => {
    const cache = action.runs.steps.find((step) => step.name === "Cache node_modules");

    expect(cache?.uses).toBe("actions/cache@v4");
    expect(JSON.stringify(action.runs.steps)).not.toMatch(/actions\/cache\/(restore|save)/);
  });
});
