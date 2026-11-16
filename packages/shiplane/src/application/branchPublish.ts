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
import { readManifest } from "./manifest";
import { MANIFEST } from "./readScope";
import { paint, reasonOf } from "./say";
import { runSteps } from "./steps";
import { decideContext, moduleOf, runHere, shipPlanOf, unitTarget } from "./targets";

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

/** What a branch release publishes, under which npm tag, and the changed units it leaves out. */
export interface BranchPlan {
  tag: string;
  publish: Candidate[];
  others: string[];
}

const REGISTRY = "package-registry";

const isRegistry = (context: ReleaseContext, unit: ReleaseUnit) =>
  moduleOf(context, unit)?.capability === REGISTRY;

/** The files this branch changed: from where it left the default branch, not what main did since. */
const branchChanges = async ({ services }: ReleaseContext, here: Here) => {
  const { sourceControl } = services;
  const base = (await sourceControl.mergeBase(here.originMain, here.head)) ?? here.originMain;
  return sourceControl.diffNames(base, here.head);
};

const touches = (files: readonly string[], { dir }: ReleaseUnit) =>
  dir === "." || dir === "" ? files.length > 0 : files.some((file) => file.startsWith(`${dir}/`));

/** The units this branch changed, at branch versions: npm packages publish, the rest wait. */
export const planBranch = async (context: ReleaseContext, here: Here): Promise<BranchPlan> => {
  const files = await branchChanges(context, here);
  const changed = context.release.units.filter((unit) => touches(files, unit));
  return {
    tag: branchTag(branchSlug(here.branch)),
    publish: changed
      .filter((unit) => isRegistry(context, unit))
      .map((unit) => ({
        unit,
        version: branchVersion({ current: unit.version, branch: here.branch, sha: here.head }),
      })),
    others: changed.filter((unit) => !isRegistry(context, unit)).map((unit) => unit.name),
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

/** One unit at its branch version, as its registry publishes it under the branch's tag. */
const publishingOf = (
  context: ReleaseContext,
  { candidate, here, tag }: { candidate: Candidate; here: Here; tag: string },
): Publishing[] => {
  const unit = { ...candidate.unit, version: candidate.version };
  const target = unitTarget(context, {
    unit,
    environment: "preview",
    commit: here.head,
    defaultBranch: here.defaultBranch,
  });
  if (!target) return [];
  const input = { ...target.input, distTag: tag };
  const name = target.module.publishedName?.(decideContext(context), input) ?? unit.packageName;
  const steps = shipPlanOf(context, target.module, input).jobs.map((job) => ({
    label: job.label,
    run: () => runHere(context, job, { tag: target.tag, environment: "preview" }),
  }));
  return [{ published: { name, version: candidate.version, tag }, steps }];
};

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
  const steps = [versionStep(context, plan.publish), ...publishing.flatMap(({ steps }) => steps)];
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
  const publishing = run.plan.publish.flatMap((candidate) =>
    publishingOf(context, { candidate, here: run.here, tag: run.plan.tag }),
  );
  if (!(await publishAll(context, { plan: run.plan, publishing }))) return false;
  const published = publishing.map((entry) => entry.published);
  printPublished(context, published);
  await commentOn(context, { pr: run.pr, sha: run.here.head, published });
  return true;
};
