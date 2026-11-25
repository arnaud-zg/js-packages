import type { Environment } from "../domain/environment";
import type { ReleaseContext } from "./context";
import { plural } from "../domain/words";
import { readStatus } from "./readStatus";
import { fail, listed, paint, reasonOf } from "./say";

/** What a step of a unit does: its `prepare` command, or shipping it. */
export type Stage = "prepare" | "ship";

/** One thing a ship runs: a job from this machine, or a workflow run dispatched. */
export interface ShipStep {
  label: string;
  run: () => Promise<unknown>;
  /** The tags left unshipped when it fails. */
  tags: string[];
  /** The unit it ships, or the units of a dispatched run, as a person reads them. */
  unit: string;
  stage: Stage;
}

export type Outcome = "success" | "failed" | "skipped";

/** How each unit went, in the order it shipped. */
export type Outcomes = Map<string, Record<Stage, Outcome>>;

/** A failed ship left its tag unshipped: the next run's first question offers it again. */
const offerAgain = ({ output }: ReleaseContext, tags: string[]) =>
  output.line(`    ${paint("dim", `Run shiplane again: it offers ${listed(tags)} again`)}`);

/** On this machine: each step under its progress line, in order; the first failure stops the rest. */
const runInOrder = async (context: ReleaseContext, steps: readonly ShipStep[]) => {
  for (const [index, { label, run, tags }] of steps.entries()) {
    try {
      await context.progress.during(label, "working", run, { index, total: steps.length });
    } catch (error) {
      fail(context, `${label} failed`, `${reasonOf(error)}, nothing after it ran.`);
      offerAgain(context, tags);
      return false;
    }
  }
  return true;
};

/**
 * On a runner: every unit goes, each in its own log group. A failed step skips the rest of its
 * unit, never the next unit.
 */
const runEvery = async (
  context: ReleaseContext,
  steps: readonly ShipStep[],
  outcomes: Outcomes,
) => {
  const { output } = context;
  let open: string | undefined;
  for (const [index, { label, run, unit, stage }] of steps.entries()) {
    if (unit !== open) {
      if (open !== undefined) output.line("::endgroup::");
      output.line(`::group::${unit}`);
      open = unit;
    }
    const outcome = outcomes.get(unit) ?? { prepare: "skipped", ship: "skipped" };
    outcomes.set(unit, outcome);
    if (Object.values(outcome).includes("failed")) continue;
    try {
      await context.progress.during(label, "working", run, { index, total: steps.length });
      outcome[stage] = "success";
    } catch (error) {
      outcome[stage] = "failed";
      fail(context, `${label} failed`, `${reasonOf(error)}, the next unit still goes.`);
    }
  }
  if (open !== undefined) output.line("::endgroup::");
  return ![...outcomes.values()].some((outcome) => Object.values(outcome).includes("failed"));
};

/**
 * Runs a ship's steps. On a runner (`options.ci`) every unit goes and `outcomes` records how; on
 * this machine the first failure stops the rest. False when one failed.
 */
export const runShipSteps = (
  context: ReleaseContext,
  steps: readonly ShipStep[],
  outcomes: Outcomes = new Map(),
) => (context.options.ci ? runEvery(context, steps, outcomes) : runInOrder(context, steps));

/** Text kept on one table cell. */
const cell = (text: string) => text.replaceAll("|", "\\|").replaceAll("\n", " ");

const table = (head: string[], rows: string[][]) =>
  [head, head.map(() => "---"), ...rows]
    .map((row) => `| ${row.map(cell).join(" | ")} |`)
    .join("\n");

/** The runner's run page, when it has one: GitHub Actions names it in `GITHUB_STEP_SUMMARY`. */
const summaryFile = (context: ReleaseContext) =>
  context.options.ci ? context.shell.env("GITHUB_STEP_SUMMARY") : undefined;

/** On a runner's run page: each unit about to ship, in release order, and where it stands. */
export const writePlan = async (
  context: ReleaseContext,
  environment: Environment,
  units: ReadonlySet<string>,
) => {
  const file = summaryFile(context);
  if (!file) return;
  const status = await readStatus(context, environment);
  const rows = status.units
    .filter(({ unit }) => units.has(unit))
    .map(({ unit, target, version, hint }) => [unit, target, version, hint]);
  context.files.append(
    file,
    `### Ship to ${environment}\n\n${table(["Unit", "Target", "Version", "Where it stands"], rows)}\n\n`,
  );
};

/** One package of a test release, as the run page shows it. */
interface TestRow {
  name: string;
  version: string;
}

/** On a runner's run page: each package a test release is about to publish, at its version. */
export const writeTestPlan = (
  context: ReleaseContext,
  {
    channel,
    packages,
    dryRun = false,
  }: { channel: string; packages: readonly TestRow[]; dryRun?: boolean },
) => {
  const file = summaryFile(context);
  if (!file) return;
  const rows = packages.map(({ name, version }) => [name, version]);
  const title = `### Ship to ${channel}${dryRun ? " (dry run)" : ""}: ${plural(packages.length, "package")}`;
  context.files.append(file, `${title}\n\n${table(["Package", "Version"], rows)}\n\n`);
};

/** On a runner's run page: how each package of a test release went. */
export const writeTestResult = (
  context: ReleaseContext,
  results: readonly (TestRow & { outcome: Outcome })[],
) => {
  const file = summaryFile(context);
  if (!file) return;
  const rows = results.map(({ name, version, outcome }) => [name, version, outcome]);
  context.files.append(file, `### Result\n\n${table(["Package", "Version", "Result"], rows)}\n\n`);
};

/** On a runner's run page: how each unit's prepare and ship went. */
export const writeResult = (context: ReleaseContext, outcomes: Outcomes) => {
  const file = summaryFile(context);
  if (!file) return;
  const rows = [...outcomes].map(([unit, { prepare, ship }]) => [unit, prepare, ship]);
  context.files.append(file, `### Result\n\n${table(["Unit", "Prepare", "Ship"], rows)}\n\n`);
};
