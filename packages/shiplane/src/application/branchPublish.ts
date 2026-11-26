import path from "node:path";

import type { BranchPublished } from "../domain/branchRelease";
import type { OpenPr } from "../domain/releasePr";
import type { Channel } from "../domain/testChannel";
import type { ReleaseUnit } from "../domain/unit";
import type { Files } from "../ports/files.port";
import type { ReleaseContext } from "./context";
import type { PackageJson } from "./manifest";
import type { Outcome } from "./shipSteps";
import type { Step } from "./steps";
import {
  BRANCH_COMMENT_MARKER,
  branchComment,
  installLine,
  installSpec,
  repositoryOfPr,
  SNAPSHOT_TAG,
  tagWords,
} from "../domain/branchRelease";
import { moves } from "../domain/changes";
import { isNumbered, nextNumber, sharedNumbers, testTag, testVersion } from "../domain/testChannel";
import { buildingIfNeeded } from "./buildIfNeeded";
import { readManifest } from "./manifest";
import { MANIFEST } from "./readScope";
import { signIn, signInsOf } from "./requirements";
import { paint, reasonOf } from "./say";
import { preparing } from "./ship";
import { writeTestPlan, writeTestResult } from "./shipSteps";
import { runSteps } from "./steps";
import { decideContext, entry, isRegistry, runHere, shipPlanOf, unitTarget } from "./targets";

/** Where this checkout stands, as a branch release reads it. */
export interface Here {
  branch: string;
  head: string;
  defaultBranch: string;
  /** Where origin's default branch stands, fetched as the position was read. */
  originMain: string;
}

/** One unit a branch release publishes, at its branch version. */
interface Candidate {
  unit: ReleaseUnit;
  version: string;
}

/** What a test release publishes, on which channel and npm tag, and the pending units it cannot test yet. */
export interface BranchPlan {
  channel: Channel;
  tag: string;
  publish: Candidate[];
  others: string[];
}

/**
 * The units a test version covers: what the pending changesets release, each at the version the
 * next release gives it, so a test version always sorts above the last release. The same on every
 * branch: a changeset says what is meant to ship, a diff only what moved.
 */
const pendingUnits = async (
  context: ReleaseContext,
): Promise<{ unit: ReleaseUnit; base: string }[]> => {
  const releases = moves(await context.services.versioning.plan([], []));
  return context.release.units.flatMap((unit) => {
    const next = releases.find(({ name }) => name === unit.packageName)?.newVersion;
    return next ? [{ unit, base: next }] : [];
  });
};

/** The versions the unit's registry holds, to number a channel's next one. */
const publishedVersionsOf = async (context: ReleaseContext, unit: ReleaseUnit, here: Here) => {
  const target = unitTarget(context, {
    unit,
    environment: entry(context),
    commit: here.head,
    defaultBranch: here.defaultBranch,
  });
  const read = target?.module.publishedVersions;
  if (!target || !read) throw new Error(`${unit.name}'s registry cannot list its versions`);
  return read(decideContext(context), target.input);
};

/**
 * The units this test version covers, at test versions on the channel: npm packages publish, the
 * other units are not available as test releases yet. A numbered channel reads each package's
 * published versions for its next number; a fixed group's packages share one.
 */
export const planBranch = async (
  context: ReleaseContext,
  { here, channel }: { here: Here; channel: Channel },
): Promise<BranchPlan> => {
  const changed = await pendingUnits(context);
  const groups = (await context.services.versioning.fixedGroups?.()) ?? [];
  const numbered = await Promise.all(
    changed
      .filter(({ unit }) => isRegistry(context, unit))
      .map(async ({ unit, base }) => ({
        unit,
        name: unit.packageName,
        next: base,
        number: isNumbered(channel)
          ? nextNumber({
              published: await publishedVersionsOf(context, unit, here),
              next: base,
              channel,
            })
          : 0,
      })),
  );
  const publish = sharedNumbers(numbered, groups).map(({ unit, next, number }) => ({
    unit,
    version: testVersion({ next, channel, branch: here.branch, sha: here.head, n: number }),
  }));
  return {
    channel,
    tag: testTag(channel),
    publish,
    others: changed.filter(({ unit }) => !isRegistry(context, unit)).map(({ unit }) => unit.name),
  };
};

const manifestFile = ({ unit }: Candidate) => path.posix.join(unit.dir, MANIFEST);

const writeVersion = (files: Files, candidate: Candidate) => {
  const manifest = readManifest({ files, dir: candidate.unit.dir });
  if (!manifest) return;
  const versioned = { ...manifest, version: candidate.version };
  files.write(manifestFile(candidate), `${JSON.stringify(versioned, null, 2)}\n`);
};

/** The step that writes each branch version into its package.json, for npm to publish. */
const versionStep = ({ files }: ReleaseContext, publish: readonly Candidate[]): Step => ({
  label: `set ${publish.map(({ unit, version }) => `${unit.name} ${version}`).join(", ")}`,
  run: () => Promise.resolve(publish.forEach((candidate) => writeVersion(files, candidate))),
});

/** One package as the branch release publishes it: its name on the registry and its steps. */
interface Publishing {
  published: BranchPublished;
  steps: Step[];
}

const NPM_REGISTRY = /^https?:\/\/registry\.npmjs\.(org|com)\/?$/;

/** Whether npm publishes the package to its public registry: no `publishConfig.registry` elsewhere. */
const publishesToNpmjs = (manifest: PackageJson | null) => {
  const config = manifest && "publishConfig" in manifest ? manifest.publishConfig : undefined;
  const registry =
    typeof config === "object" && config !== null && "registry" in config
      ? config.registry
      : undefined;
  return typeof registry !== "string" || NPM_REGISTRY.test(registry);
};

/** One unit at its branch version, as its registry publishes it under the branch's tag. */
const publishingOf = (
  context: ReleaseContext,
  { candidate, here, tag }: { candidate: Candidate; here: Here; tag: string },
): Publishing[] => {
  const unit = { ...candidate.unit, version: candidate.version };
  const target = unitTarget(context, {
    unit,
    environment: entry(context),
    commit: here.head,
    defaultBranch: here.defaultBranch,
  });
  if (!target) return [];
  const input = {
    ...target.input,
    distTag: tag,
    ...(tag === SNAPSHOT_TAG ? { dropTag: true } : {}),
  };
  const name = target.module.publishedName?.(decideContext(context), input) ?? unit.packageName;
  const onNpmjs = publishesToNpmjs(readManifest({ files: context.files, dir: unit.dir }));
  const { jobs } = shipPlanOf(context, target.module, input);
  const tagged = `${name}@${candidate.version}`;
  // What publishes is built from this commit, never a dist left from before.
  const prepare =
    preparing(context, unit, tagged) ?? buildingIfNeeded(context, { unit, tag: tagged, jobs });
  const steps = [
    ...(prepare ? [prepare] : []),
    ...jobs.map((job) => ({
      label: job.label,
      run: () => runHere(context, job, { tag: target.tag, environment: entry(context) }),
    })),
  ];
  return [{ published: { name, version: candidate.version, tag, onNpmjs }, steps }];
};

/** The package's steps, each noting in `outcomes` how far the package got. */
const recorded = (
  { published: { name }, steps }: Publishing,
  outcomes: Map<string, Outcome>,
): Step[] =>
  steps.map((step, index) => ({
    ...step,
    run: async () => {
      // Failed until its last step is through.
      outcomes.set(name, "failed");
      await step.run();
      if (index === steps.length - 1) outcomes.set(name, "success");
    },
  }));

/**
 * Writes the branch versions, publishes each package, then always puts every package.json back as
 * it was: nothing is committed, tagged or versioned. False when a step failed.
 */
const publishAll = async (
  context: ReleaseContext,
  { plan, publishing }: { plan: BranchPlan; publishing: readonly Publishing[] },
) => {
  const originals = plan.publish
    .map(manifestFile)
    .map((file) => ({ file, text: context.files.read(file) }));
  const outcomes = new Map<string, Outcome>();
  const steps = [
    versionStep(context, plan.publish),
    ...publishing.flatMap((entry) => recorded(entry, outcomes)),
  ];
  try {
    return await runSteps(context, steps);
  } finally {
    originals.forEach(({ file, text }) => text !== null && context.files.write(file, text));
    writeTestResult(
      context,
      publishing.map(({ published: { name, version } }) => ({
        name,
        version,
        outcome: outcomes.get(name) ?? "skipped",
      })),
    );
  }
};

/** Rows padded to their widest cell, two spaces apart. */
export const padded = (rows: readonly string[][]) => {
  const widths = (rows[0] ?? []).map((_, column) =>
    Math.max(...rows.map((row) => (row[column] ?? "").length)),
  );
  return rows.map((row) =>
    row
      .map((cell, column) => cell.padEnd(widths[column] ?? 0))
      .join("  ")
      .trimEnd(),
  );
};

/** The plan on a runner's run page: the run's title names no package. */
const planOnRunPage = (
  context: ReleaseContext,
  { channel, publish }: BranchPlan,
  { dryRun }: { dryRun: boolean },
) =>
  writeTestPlan(context, {
    channel,
    packages: publish.map(({ unit, version }) => ({ name: unit.packageName, version })),
    dryRun,
  });

/** What a dry run shows: each package at the version it would take, and the npm tag; true. */
export const printPlan = (context: ReleaseContext, plan: BranchPlan) => {
  const { output, progress } = context;
  planOnRunPage(context, plan, { dryRun: true });
  progress.say("resting", `Would publish on ${plan.channel}, ${tagWords(plan.tag)} (dry run)`);
  const [header = "", ...rows] = padded([
    ["Package", "Version", "Install"],
    ...plan.publish.map(({ unit, version }) => [
      unit.packageName,
      version,
      `npm i ${installSpec({ name: unit.packageName, version, tag: plan.tag })}`,
    ]),
  ]);
  output.line(paint("dim", `  ${header}`));
  rows.forEach((row) => output.line(`  ${row}`));
  output.line(paint("dim", "  Nothing published."));
  return true;
};

const printPublished = ({ output, progress }: ReleaseContext, published: BranchPublished[]) => {
  const [first] = published;
  progress.say(
    "happy",
    `${paint("green", "✓")} Published${first?.tag === SNAPSHOT_TAG ? ", no npm tag" : ` under npm tag ${first?.tag ?? ""}`}`,
  );
  const [header = "", ...rows] = padded([
    ["Package", "Version", "Install"],
    ...published.map((entry) => [entry.name, entry.version, installLine(entry)]),
  ]);
  output.line(paint("dim", `  ${header}`));
  rows.forEach((row) => output.line(`  ${row}`));
};

/**
 * The pull request's comment, from the config's template, edited each run; none without a pull
 * request. A failure is said, never undoes the publish.
 */
const commentOn = async (
  { services, output, release }: ReleaseContext,
  {
    pr,
    here,
    published,
    others,
    channel,
  }: {
    pr: OpenPr | null;
    here: Here;
    published: BranchPublished[];
    others: readonly string[];
    channel: Channel;
  },
) => {
  if (!pr) return;
  const body = branchComment({
    sha: here.head,
    branch: here.branch,
    repository: repositoryOfPr(pr.url),
    published,
    others,
    channel,
    ...(release.testComment === undefined ? {} : { template: release.testComment }),
  });
  await services.codeHost
    .upsertComment({ on: pr, marker: BRANCH_COMMENT_MARKER, body })
    .then(() => output.line(paint("dim", `  The install lines are on #${pr.number} too.`)))
    .catch((error: unknown) =>
      output.line(
        `  ${paint("yellow", "!")} could not comment on #${pr.number}: ${reasonOf(error)}`,
      ),
    );
};

/** A test version ready to go: where it runs, its pull request if any, and what it publishes. */
export interface BranchRun {
  here: Here;
  pr: OpenPr | null;
  plan: BranchPlan;
}

/** Publishes the test version, prints its install lines and keeps them on the pull request, if any. */
export const publishBranch = async (context: ReleaseContext, run: BranchRun) => {
  planOnRunPage(context, run.plan, { dryRun: false });
  // An expired npm token fails the publish as a 404: check the sign-in before writing a version.
  const signedIn = await signIn(context, {
    requirements: signInsOf(
      context.release,
      new Set(run.plan.publish.map(({ unit }) => unit.name)),
    ),
    again: "run shiplane again",
  });
  if (!signedIn) return false;
  const publishing = run.plan.publish.flatMap((candidate) =>
    publishingOf(context, { candidate, here: run.here, tag: run.plan.tag }),
  );
  if (!(await publishAll(context, { plan: run.plan, publishing }))) return false;
  const published = publishing.map((entry) => entry.published);
  printPublished(context, published);
  await commentOn(context, {
    pr: run.pr,
    here: run.here,
    published,
    others: run.plan.others,
    channel: run.plan.channel,
  });
  return true;
};
