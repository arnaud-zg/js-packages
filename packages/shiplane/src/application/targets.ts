import os from "node:os";
import path from "node:path";

import type { DeployFlow, Environment } from "../domain/environment";
import type { ReleaseUnit } from "../domain/unit";
import type { AfterShipContext, AppInput, ReleaseModule } from "../modules/module";
import type { Command, DecideContext, Job } from "../ports/delivery.port";
import type { Release } from "./config/loadRelease";
import type { ReleaseContext } from "./context";
import { changesReaching, codeFolders } from "../domain/codeScope";
import { DEFAULT_FLOW, entryOf, keysOf } from "../domain/environment";
import { tagName } from "../domain/tags";
import { optionsFor } from "./config/optionsFor";
import { settingsOn } from "./config/unitSchema";
import { reasonOf } from "./say";

/** The module that ships an app: the one its unit file names. */
export const moduleOf = ({ release }: ReleaseContext, unit: ReleaseUnit) =>
  release.modules.find(({ name }) => name === unit.module);

/** Whether a unit publishes to a package registry. */
export const isRegistry = (context: ReleaseContext, unit: ReleaseUnit) =>
  moduleOf(context, unit)?.capability === "package-registry";

/** An app's settings for an environment, its module's defaults applied first. */
export const resolvedOptions = (
  module: ReleaseModule,
  unit: ReleaseUnit,
  environment: Environment,
  units: readonly ReleaseUnit[],
  path?: readonly Environment[],
): Record<string, unknown> => {
  const withDefaults = settingsOn(module.settings, path).parse(unit.options);
  return optionsFor({ ...unit, options: withDefaults }, environment, units, path);
};

/** The way this repository's apps go to their users. */
export const flowOf = ({ release }: { release: Pick<Release, "appFlow"> }): DeployFlow =>
  release.appFlow ?? DEFAULT_FLOW;

/** Where a release deploys. */
export const entry = (context: { release: Pick<Release, "appFlow"> }) => entryOf(flowOf(context));

/** Where this checkout stands: the commit it is on and the branch releases start from. */
export interface Checkout {
  commit: string;
  defaultBranch: string;
}

/** The commit this machine is on and the default branch, read once for every unit a run looks at. */
export const checkout = async ({ services }: ReleaseContext): Promise<Checkout> => {
  const [{ head }, defaultBranch] = await Promise.all([
    services.sourceControl.position(),
    services.sourceControl.defaultBranch(),
  ]);
  return { commit: head, defaultBranch };
};

/** What a module's stages are told about one app's tag. */
export const jobInput = (
  context: ReleaseContext,
  module: ReleaseModule,
  unit: ReleaseUnit,
  { tag, environment, commit, defaultBranch }: { tag: string; environment: Environment } & Checkout,
): AppInput => ({
  unit,
  tag,
  environment,
  commit,
  defaultBranch,
  options: resolvedOptions(
    module,
    unit,
    environment,
    context.release.units,
    keysOf(flowOf(context)),
  ),
  ...(context.release.appFlow ? { flow: context.release.appFlow } : {}),
});

/** The module that ships a unit and the tag it ships, or null when no module claims it. */
export const unitTag = (context: ReleaseContext, unit: ReleaseUnit) => {
  const module = moduleOf(context, unit);
  if (!module) return null;
  return { module, tag: tagName(unit.name, unit.version, context.release.tagFormat) };
};

/** One unit aimed at an environment at a commit: its module, its tag, and what its stages are told. */
export const unitTarget = (
  context: ReleaseContext,
  { unit, environment, ...at }: { unit: ReleaseUnit; environment: Environment } & Checkout,
) => {
  const found = unitTag(context, unit);
  if (!found) return null;
  const input = jobInput(context, found.module, unit, { tag: found.tag, environment, ...at });
  return { ...found, input };
};

/** Where a tag lands and the jobs that ship it, as its module says. */
export const shipPlanOf = (context: ReleaseContext, module: ReleaseModule, input: AppInput) =>
  module.ship(decideContext(context), input);

/** Every file a release may move after a tag without changing what ships. */
export const versionFiles = (context: ReleaseContext) =>
  new Set(
    context.release.units.flatMap(
      (unit) =>
        moduleOf(context, unit)?.versionFiles?.(unit, context.release.units, context.open) ?? [],
    ),
  );

/** A command as a person would type it, variables first, secrets by name only. */
export const commandLine = ({ command, args, env, secrets }: Command) =>
  [
    ...Object.entries(env ?? {}).map(([key, value]) => `${key}=${value}`),
    command,
    ...args,
    ...(secrets ?? []).flatMap(({ flag, name }) => [flag, `${name}=$${name}`]),
  ].join(" ");

/** Runs a job's commands in a checkout in order. Throws on the first failure. */
const runIn = async ({ shell, output }: ReleaseContext, job: Job, root: string) => {
  const secretArgs = (step: Command) =>
    (step.secrets ?? []).flatMap(({ flag, name }) => {
      const value = shell.env(name);
      if (value) return [flag, `${name}=${value}`];
      output.line(`  ! ${name} is not set: ${flag} left out`);
      return [];
    });
  const run = (step: Command) =>
    shell.attach(step.command, [...step.args, ...secretArgs(step)], {
      cwd: path.join(root, step.cwd ?? ""),
      env: step.env,
    });
  try {
    for (const step of job.local) {
      const status = await run(step);
      if (status !== 0) throw new Error(`${step.command} exited with ${status}`);
    }
  } finally {
    for (const step of job.cleanup ?? []) await run(step);
  }
};

const SIGNALS = ["SIGINT", "SIGTERM"] as const;

/**
 * Runs a job from a worktree detached at its tag: installed, given the checkout's ignored `.env*`
 * files at the root and in each folder a command runs in, and always removed after, also when it
 * was half made or the run is interrupted. A removal that fails is said, never in place of the
 * run's own failure.
 */
const runFromTag = async (context: ReleaseContext, job: Job, tag: string) => {
  const { shell, release, services, clock, output } = context;
  const dir = path.join(
    os.tmpdir(),
    `shiplane-${tag.replace(/[^\w.-]/g, "-")}-${clock.now().getTime()}`,
  );
  const folders = [...new Set(job.local.flatMap(({ cwd }) => (cwd ? [cwd] : [])))];
  let removing: Promise<void> | null = null;
  const remove = () => {
    removing ??= services.sourceControl.removeWorktree(dir).catch((error: unknown) => {
      const reason = reasonOf(error);
      output.line(`  ! could not remove the worktree ${dir}: ${reason}`);
      output.line(`    git worktree remove --force ${dir}`);
    });
    return removing;
  };
  // Interrupted, the worktree goes first, then the signal does what it would have.
  const onSignal = (signal: NodeJS.Signals) => {
    detach();
    void remove().finally(() => process.kill(process.pid, signal));
  };
  const detach = () => SIGNALS.forEach((signal) => process.off(signal, onSignal));
  SIGNALS.forEach((signal) => process.once(signal, onSignal));
  try {
    await services.sourceControl.addWorktree(dir, tag);
    const envFiles = await services.sourceControl.ignoredFiles([
      ".env*",
      ...folders.map((folder) => path.posix.join(folder, ".env*")),
    ]);
    for (const file of envFiles) {
      const { status, stderr } = await shell.capture("cp", [
        path.join(release.root, file),
        path.join(dir, file),
      ]);
      if (status !== 0) throw new Error(`copying ${file} failed: ${stderr.trim()}`);
    }
    const installed = await shell.attach("pnpm", ["install", "--frozen-lockfile"], { cwd: dir });
    if (installed !== 0) throw new Error(`pnpm install exited with ${installed}`);
    await runIn(context, job, dir);
  } finally {
    detach();
    await remove();
  }
};

/**
 * Runs a job's commands here in order, from its tag when it names one, then records the deploy.
 * Throws on the first failure.
 */
export const runHere = async (
  context: ReleaseContext,
  job: Job,
  { tag, environment }: { tag: string; environment: Environment },
) => {
  await (job.from ? runFromTag(context, job, job.from) : runIn(context, job, context.release.root));
  if (job.record) await context.services.codeHost.recordDeployment(tag, environment);
};

/** Dispatches the ship workflow on a ref for its units and returns at once: the runner ships them. */
export const dispatchShip = async (
  { services }: ReleaseContext,
  { ref, units }: { ref: string; units: readonly string[] },
  environment: Environment,
) =>
  services.ciPipeline.dispatch(services.ciPipeline.shipWorkflow, ref, {
    units: units.join(" "),
    environment,
  });

/** Which changed files can reach what a unit ships. */
const reaching = async (context: ReleaseContext, unit: ReleaseUnit) => {
  const { versioning } = context.services;
  const [dependencies, folders] = await Promise.all([
    versioning.dependencies(),
    versioning.folders(),
  ]);
  const scope = {
    own: [unit.dir, ...codeFolders(unit.packageName, dependencies, folders)],
    workspace: Object.values(folders),
    versionFiles: versionFiles(context),
  };
  return (files: readonly string[]) => changesReaching(files, scope);
};

/** What a module's per-app stages may read and run. */
export const decideContext = (context: ReleaseContext): DecideContext => ({
  root: context.release.root,
  shell: context.shell,
  sourceControl: context.services.sourceControl,
  codeHost: context.services.codeHost,
  ciPipeline: context.services.ciPipeline,
  units: context.release.units,
  tagFormat: context.release.tagFormat,
  versionFiles: versionFiles(context),
  now: () => context.clock.now(),
  open: context.open,
  changedCode: async (unit, from, to) => {
    const [files, filter] = await Promise.all([
      context.services.sourceControl.diffNames(from, to),
      reaching(context, unit),
    ]);
    return filter(files);
  },
});

/** What a module may read once apps ship. */
export const afterShipContext = (context: ReleaseContext): AfterShipContext => ({
  open: context.open,
  tagFormat: context.release.tagFormat,
  subjectsReaching: async (unit, from, to) => {
    const [commits, filter] = await Promise.all([
      context.services.sourceControl.commitsBetween(from, to),
      reaching(context, unit),
    ]);
    return commits.filter(({ files }) => filter(files).length > 0).map(({ subject }) => subject);
  },
});

/** A package registry has no staging and nothing deploys a release-only unit: no environment. */
export const hasNoEnvironment = ({ kind, releaseOnly }: ReleaseModule) =>
  kind === "published-package" || releaseOnly === true;

/**
 * What the person reads for an environment: when no unit has one, preview is where users get them,
 * so it reads "live". Naming no unit asks about the whole repository.
 */
export const environmentLabel = (
  context: ReleaseContext,
  units: Iterable<string>,
  environment: string,
) => {
  if (environment !== entry(context)) return environment;
  const named = [...units];
  const names = named.length > 0 ? named : context.release.units.map(({ name }) => name);
  const noneHasOne =
    names.length > 0 &&
    names.every((name) => {
      const unit = context.release.units.find((candidate) => candidate.name === name);
      const module = unit && moduleOf(context, unit);
      return module !== undefined && hasNoEnvironment(module);
    });
  return noneHasOne ? "live" : environment;
};

/** Where a sentence sends units: "to preview", or "live" when none of them has an environment. */
export const destination = (
  context: ReleaseContext,
  units: Iterable<string>,
  environment: string,
) => {
  const label = environmentLabel(context, units, environment);
  return label === "live" ? label : `to ${label}`;
};
