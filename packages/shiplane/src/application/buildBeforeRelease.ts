import path from "node:path";

import type { ReleaseUnit } from "../domain/unit";
import type { ReleaseContext } from "./context";
import type { Step } from "./steps";
import { prepareLine } from "../domain/prepare";
import { plural } from "../domain/words";
import { CommandFailed } from "../ports/shell.port";
import { buildCommandOf } from "./buildCommand";
import { build } from "./buildIfNeeded";
import { fail, paint } from "./say";
import { runSteps } from "./steps";

/** A command run from a folder, its output shown only when it fails. */
const quietly =
  ({ shell, release }: ReleaseContext) =>
  async (command: { command: string; args: string[]; shown: string }, dir: string) => {
    const result = await shell.capture(command.command, command.args, {
      cwd: path.join(release.root, dir),
      // Nobody answers a build: one that reads its input ends instead of waiting.
      input: "",
    });
    if (result.status === 0) return;
    throw new CommandFailed(
      `${command.shown} in ${dir} exited with ${result.status}`,
      `${result.stdout}${result.stderr}`.trim(),
    );
  };

/** What builds each unit that has something to build: the config's `prepare`, else its own build. */
const buildSteps = (context: ReleaseContext, units: readonly ReleaseUnit[]) => {
  const { prepare } = context.release;
  const run = quietly(context);
  const seen = new Set<string>();
  const always = new Set(units.map(({ dir }) => dir));
  return units.flatMap((unit): { name: string; step: Step }[] => {
    const { name } = unit;
    if (prepare !== undefined) {
      const line = prepareLine(prepare, unit);
      const command = { command: "sh", args: ["-c", line], shown: line };
      return [{ name, step: { label: `prepare ${name}: ${line}`, run: () => run(command, ".") } }];
    }
    if (!buildCommandOf(context, unit)) return [];
    const building = async () => {
      await build(context, { folder: unit, seen, always, run });
    };
    return [{ name, step: { label: `build ${name}`, run: building } }];
  });
};

/**
 * Before a release writes anything: every picked unit builds. The units a ship of this same commit
 * need not build again, or null when one failed.
 */
export const buildBeforeRelease = async (
  context: ReleaseContext,
  units: readonly ReleaseUnit[],
): Promise<ReadonlySet<string> | null> => {
  const { output, progress, release, services } = context;
  const building = buildSteps(context, units);
  if (building.length === 0) return new Set();
  const wasClean = await services.sourceControl.isClean();
  const steps = building.map(({ step }) => step);
  if (!(await runSteps(context, steps))) {
    output.line(
      paint(
        "dim",
        "    Nothing was written: no release PR, tag or publish. Fix the build, then run:",
      ),
    );
    output.line(`    ${paint("cyan", "shiplane")}`);
    return null;
  }
  if (wasClean && !(await services.sourceControl.isClean())) {
    fail(
      context,
      "The build changed files your repository tracks",
      "nothing was written. Commit what it generates, or stop tracking it, then run the release again.",
    );
    return null;
  }
  progress.say("happy", `${paint("green", "✓")} ${plural(building.length, "unit")} built`);
  // A `prepare` may write where the next unit's does, so each runs again right before its own ship.
  if (release.prepare !== undefined && building.length > 1) return new Set();
  return new Set(building.map(({ name }) => name));
};
