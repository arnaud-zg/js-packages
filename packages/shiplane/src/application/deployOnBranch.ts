import type { ReleaseUnit } from "../domain/unit";
import type { Here } from "./branchPublish";
import type { ReleaseContext } from "./context";
import { branchVersion } from "../domain/branchRelease";
import { buildingIfNeeded } from "./buildIfNeeded";
import { checkEnvBeforeDeploy } from "./checkEnvBeforeDeploy";
import { signIn, signInsOf } from "./requirements";
import { confirm, listed, paint } from "./say";
import { preparing } from "./ship";
import { runSteps } from "./steps";
import { isRegistry, moduleOf, runHere, shipPlanOf, unitTarget } from "./targets";

/**
 * The pending apps a branch may deploy, as the config's `deployApps.onBranch` allows: never from the
 * default branch, whose release does it, and never one its own platform decides for.
 */
export const appsOnBranch = (
  context: ReleaseContext,
  { here, pending }: { here: Here; pending: readonly string[] },
): ReleaseUnit[] => {
  const { release, options } = context;
  if (!release.deployOnBranch || here.branch === here.defaultBranch || options.ci) return [];
  return release.units.filter((unit) => {
    const module = moduleOf(context, unit);
    return (
      pending.includes(unit.name) &&
      module !== undefined &&
      !isRegistry(context, unit) &&
      !module.releaseOnly &&
      !module.decidedBy
    );
  });
};

/**
 * Deploys the apps from this checkout to the branch environment, over what runs there until the next
 * release. Not recorded as a deploy: no release did it, so nothing is promoted from it.
 */
export const deployOnBranch = async (
  context: ReleaseContext,
  { here, apps }: { here: Here; apps: readonly ReleaseUnit[] },
): Promise<boolean> => {
  const environment = context.release.deployOnBranch;
  if (!environment || apps.length === 0) return true;
  const names = listed(apps.map(({ name }) => name));
  const question = `Deploy ${names} from ${here.branch} to ${environment}? It replaces what runs there until the next release.`;
  if (!(await confirm(context, question))) {
    context.progress.say("resting", paint("dim", "Nothing deployed."));
    return true;
  }
  const signedIn = await signIn(context, {
    requirements: signInsOf(context.release, new Set(apps.map(({ name }) => name))),
    again: "run shiplane again",
  });
  if (!signedIn || !(await checkEnvBeforeDeploy(context, { environment, units: apps })))
    return false;
  const steps = apps.flatMap((unit) => {
    const target = unitTarget(context, {
      unit,
      environment,
      commit: here.head,
      defaultBranch: here.defaultBranch,
    });
    if (!target) return [];
    const version = branchVersion({ current: unit.version, branch: here.branch, sha: here.head });
    const tag = `${unit.name}@${version}`;
    const { jobs } = shipPlanOf(context, target.module, { ...target.input, tag });
    const prepare = preparing(context, unit, tag) ?? buildingIfNeeded(context, { unit, tag, jobs });
    return [
      ...(prepare ? [prepare] : []),
      ...jobs.map((job) => ({
        label: job.label,
        // This checkout, not a tag: the branch has none.
        run: () =>
          runHere(context, { ...job, from: undefined, record: false }, { tag, environment }),
      })),
    ];
  });
  return runSteps(context, steps);
};
