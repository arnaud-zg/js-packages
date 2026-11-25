import path from "node:path";

import type { ReleaseUnit } from "../domain/unit";
import type { SetupContext } from "./setupContext";
import { buildCommandOf } from "./buildCommand";
import { checkStatus, requirementsOf } from "./requirements";
import { paint, reasonOf } from "./say";
import { checkout, commandLine, entry, shipPlanOf, unitTarget } from "./targets";

class StepFailed extends Error {}

/** A failed check, said: a spinner already said a check that did not pass; one that broke says why. */
const sayFailed = (context: SetupContext, { label, error }: { label: string; error: unknown }) => {
  if (error instanceof StepFailed && context.progress) return;
  context.output.line(`  ${paint("red", "✗")} ${label}`);
  if (error instanceof StepFailed) return;
  context.output.line(`     ${paint("dim", reasonOf(error))}`);
};

/** One rehearsal check under a spinner when there is one: true when `work` says it passed. */
const check = async (context: SetupContext, label: string, work: () => Promise<boolean>) => {
  const run = async () => {
    if (!(await work())) throw new StepFailed();
  };
  const runPlain = async () => {
    await run();
    context.output.line(`  ${paint("green", "✓")} ${label}`);
  };
  try {
    await (context.progress ? context.progress.during(label, "working", run) : runPlain());
    return true;
  } catch (error) {
    sayFailed(context, { label, error });
    return false;
  }
};

/**
 * A release played through with nothing pushed, published or deployed: the config loads, every app
 * builds, every ship plan resolves, every sign-in is there. Each failure says how to fix it.
 */
export const rehearse = async (context: SetupContext): Promise<boolean> => {
  const { output, shell, root } = context;
  output.line();
  output.line(
    `  ${paint("bold", "Rehearsal")}  ${paint("dim", "· nothing is pushed, published or deployed")}`,
  );
  const release = await context.load();
  if (release.problems.length > 0) {
    release.problems.forEach(({ file, line, message, hint }) => {
      output.line(
        `  ${paint("red", "✗")} ${line === undefined ? file : `${file}:${line}`}  ${message}`,
      );
      if (hint) output.line(`     ${paint("dim", hint)}`);
    });
    return false;
  }
  const builds = release.units.flatMap((unit) => {
    const build = buildCommandOf(context, unit);
    return build ? [{ unit, build }] : [];
  });
  const results: {
    unit: ReleaseUnit;
    shown: string;
    failed: boolean;
    seconds: string;
    tail: string[];
  }[] = [];
  const built =
    builds.length === 0 ||
    (await check(
      context,
      `build ${builds.length} app${builds.length === 1 ? "" : "s"}`,
      async () => {
        results.push(
          ...(await Promise.all(
            builds.map(async ({ unit, build }) => {
              const started = Date.now();
              const result = await shell.capture(build.command, build.args, {
                cwd: path.join(root, unit.dir),
              });
              return {
                unit,
                shown: build.shown,
                failed: result.status !== 0,
                seconds: `${((Date.now() - started) / 1000).toFixed(1)}s`,
                tail: `${result.stderr}${result.stdout}`.trim().split("\n").slice(-3),
              };
            }),
          )),
        );
        return results.every(({ failed }) => !failed);
      },
    ));
  for (const { unit, shown, failed, seconds, tail } of results) {
    output.line(
      `     ${failed ? paint("red", "✗") : paint("green", "✓")} ${unit.dir.padEnd(18)}${paint("dim", `${shown}  ${seconds}`)}`,
    );
    if (!failed) continue;
    tail.forEach((line) => output.line(`         ${paint("dim", line)}`));
    output.line(`         ${paint("dim", `fix the build, or set buildCommand: in ${unit.file}`)}`);
  }

  const releaseContext = context.compose?.(release);
  const planned =
    !releaseContext ||
    (await check(context, `plan  ${release.units.length} apps, nothing runs`, async () => {
      const at = await checkout(releaseContext);
      for (const unit of release.units) {
        const target = unitTarget(releaseContext, {
          unit,
          environment: entry(releaseContext),
          ...at,
        });
        if (target) shipPlanOf(releaseContext, target.module, target.input);
      }
      return true;
    }));

  let signedIn = true;
  for (const requirement of requirementsOf(release)) {
    const status = await checkStatus(shell, root, requirement);
    if (await check(context, requirement.label, () => Promise.resolve(status === 0))) continue;
    signedIn = false;
    const fix =
      status === 127
        ? `not installed: ${requirement.check.command}`
        : requirement.fix
          ? `run ${commandLine(requirement.fix)}, then shiplane setup`
          : "not available here";
    output.line(`     ${paint("dim", fix)}`);
  }
  return built && planned && signedIn;
};
