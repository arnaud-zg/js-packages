import path from "node:path";

import type { BranchPublished } from "../domain/branchRelease";
import type { OpenPr } from "../domain/releasePr";
import type { ReleaseUnit } from "../domain/unit";
import type { Files } from "../ports/files.port";
import type { ReleaseContext } from "./context";
import type { Step } from "./steps";
import {
  BRANCH_COMMENT_MARKER,
  branchComment,
  branchSlug,
  branchTag,
  branchVersion,
  installLine,
} from "../domain/branchRelease";
import { appBumps } from "../domain/changes";
import { readManifest } from "./manifest";
import { MANIFEST, unitRefs } from "./readScope";
import { paint, reasonOf } from "./say";
import { runSteps } from "./steps";
import { moduleOf, runHere, shipPlanOf, unitTarget } from "./targets";

/** Where this checkout stands, as a branch release reads it. */
export interface Here {
  branch: string;
  head: string;
  defaultBranch: string;
}

/** One unit a branch release publishes, at its branch version. */
interface Candidate {
  unit: ReleaseUnit;
  version: string;
}

/** What a branch release publishes, under which npm tag, and the pending units it leaves out. */
export interface BranchPlan {
  tag: string;
  publish: Candidate[];
  others: string[];
}

const REGISTRY = "package-registry";

const isRegistry = (context: ReleaseContext, unit: ReleaseUnit) =>
  moduleOf(context, unit)?.capability === REGISTRY;

/** What the pending changesets would move, at branch versions: npm packages publish, the rest wait. */
export const planBranch = async (context: ReleaseContext, here: Here): Promise<BranchPlan> => {
  const { versioning } = context.services;
  const [plan, dependencies] = await Promise.all([
    versioning.plan([], []),
    versioning.dependencies(),
  ]);
  const bumps = appBumps(plan, dependencies, unitRefs(context.release.units));
  const moving = context.release.units.flatMap((unit) => {
    const bump = bumps.find(({ app }) => app === unit.name);
    return bump ? [{ unit, next: bump.to }] : [];
  });
  return {
    tag: branchTag(branchSlug(here.branch)),
    publish: moving
      .filter(({ unit }) => isRegistry(context, unit))
      .map(({ unit, next }) => ({
        unit,
        version: branchVersion({ next, branch: here.branch, sha: here.head }),
      })),
    others: moving.filter(({ unit }) => !isRegistry(context, unit)).map(({ unit }) => unit.name),
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

/** The jobs that publish one unit under the branch's tag, as its registry builds them. */
const publishSteps = (
  context: ReleaseContext,
  { candidate, head, tag }: { candidate: Candidate; head: string; tag: string },
): Step[] => {
  const unit = { ...candidate.unit, version: candidate.version };
  const target = unitTarget(context, { unit, environment: "preview", commit: head });
  if (!target) return [];
  const input = { ...target.input, distTag: tag };
  return shipPlanOf(context, target.module, input).jobs.map((job) => ({
    label: job.label,
    run: () => runHere(context, job, { tag: target.tag, environment: "preview" }),
  }));
};

/**
 * Writes the branch versions, publishes each package, then always puts every package.json back as
 * it was: nothing is committed, tagged or versioned. False when a step failed.
 */
const publishAll = async (context: ReleaseContext, { here, plan }: BranchRun) => {
  const originals = plan.publish
    .map(manifestFile)
    .map((file) => ({ file, text: context.files.read(file) }));
  const steps = [
    versionStep(context, plan.publish),
    ...plan.publish.flatMap((candidate) =>
      publishSteps(context, { candidate, head: here.head, tag: plan.tag }),
    ),
  ];
  try {
    return await runSteps(context, steps);
  } finally {
    originals.forEach(({ file, text }) => text !== null && context.files.write(file, text));
  }
};

/** Rows padded to their widest cell, two spaces apart. */
const padded = (rows: readonly string[][]) => {
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

const printPublished = ({ output, progress }: ReleaseContext, published: BranchPublished[]) => {
  const [first] = published;
  progress.say("happy", `${paint("green", "✓")} Published under npm tag ${first?.tag ?? ""}`);
  const [header = "", ...rows] = padded([
    ["Package", "Version", "Install"],
    ...published.map((entry) => [entry.name, entry.version, installLine(entry)]),
  ]);
  output.line(paint("dim", `  ${header}`));
  rows.forEach((row) => output.line(`  ${row}`));
};

/** The pull request's comment, edited each run; a failure is said, never undoes the publish. */
const commentOn = (
  { services, output }: ReleaseContext,
  { pr, sha, published }: { pr: OpenPr; sha: string; published: BranchPublished[] },
) =>
  services.codeHost
    .upsertComment({
      on: pr,
      marker: BRANCH_COMMENT_MARKER,
      body: branchComment({ sha, published }),
    })
    .then(() => output.line(paint("dim", `  The install lines are on #${pr.number} too.`)))
    .catch((error: unknown) =>
      output.line(
        `  ${paint("yellow", "!")} could not comment on #${pr.number}: ${reasonOf(error)}`,
      ),
    );

/** A branch release ready to go: where it runs, its pull request and what it publishes. */
export interface BranchRun {
  here: Here;
  pr: OpenPr;
  plan: BranchPlan;
}

/** Publishes the branch release, prints its install lines and keeps them on the pull request. */
export const publishBranch = async (context: ReleaseContext, run: BranchRun) => {
  if (!(await publishAll(context, run))) return false;
  const published = run.plan.publish.map(({ unit, version }) => ({
    name: unit.packageName,
    version,
    tag: run.plan.tag,
  }));
  printPublished(context, published);
  await commentOn(context, { pr: run.pr, sha: run.here.head, published });
  return true;
};
