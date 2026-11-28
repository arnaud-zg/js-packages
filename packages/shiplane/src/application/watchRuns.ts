import type { PipelineRun } from "../ports/ci-pipeline.port";
import type { ReleaseContext } from "./context";
import { plural } from "../domain/words";
import { ciLabel } from "./askPath";
import { paint } from "./say";

/** How often, and how long apart, the pipeline is asked for the runs a dispatch started. */
const LOOKS = 5;
const LOOK_APART_MS = 2_000;

/** The answer that follows none of the runs. */
const NONE = "";

/** The runs `count` dispatches started since `since`; fewer when the pipeline is slow to show them. */
const findRuns = async (
  context: ReleaseContext,
  find: NonNullable<ReleaseContext["services"]["ciPipeline"]["startedRuns"]>,
  { workflow, since, count }: { workflow: string; since: Date; count: number },
) => {
  let runs: PipelineRun[] = [];
  for (let look = 0; look < LOOKS; look += 1) {
    if (look > 0) await context.clock.sleep(LOOK_APART_MS);
    runs = await find(workflow, since).catch(() => []);
    if (runs.length >= count) break;
  }
  return runs.slice(-count);
};

/** The command to follow each run later, or to list the latest when the pipeline has none. */
const printFollowLines = ({ services, output }: ReleaseContext, runs: readonly PipelineRun[]) => {
  const { watchLine, runsLine } = services.ciPipeline;
  const lines = watchLine && runs.length > 0 ? runs.map(watchLine) : runsLine ? [runsLine] : [];
  lines.forEach((line) => output.line(`    ${paint("cyan", line)}`));
};

/** The run to follow next, asked of the person, the first one offered first; null to follow none. */
const pick = async (context: ReleaseContext, runs: readonly PipelineRun[]) => {
  const label = ciLabel(context.services.ciPipeline);
  const [first] = runs;
  if (!first) return null;
  if (runs.length === 1) {
    const watch = await context.prompter.confirm(
      `Watch ${first.title} on ${label} until it ends?`,
      true,
    );
    return watch ? first : null;
  }
  const id = await context.prompter.select(
    `Watch a run on ${label} until it ends?`,
    [
      ...runs.map(({ id, title, url }) => ({
        value: id,
        label: title,
        ...(url ? { hint: url } : {}),
      })),
      { value: NONE, label: "No, return now" },
    ],
    first.id,
  );
  return runs.find((run) => run.id === id) ?? null;
};

/** Follows one run to its end and says how it went. */
const follow = async (
  context: ReleaseContext,
  run: PipelineRun,
  watch: (run: PipelineRun) => Promise<boolean>,
) => {
  context.output.line();
  const ok = await watch(run).catch(() => false);
  context.output.line();
  if (ok) {
    context.progress.say("happy", `${paint(["bold", "green"], "✓")} ${run.title} succeeded.`);
  } else {
    const where = run.url ? `: ${run.url}` : "";
    context.progress.say(
      "worried",
      `${paint(["bold", "red"], "✗")} ${run.title} did not succeed${where}`,
    );
  }
  return ok;
};

/**
 * After a ship dispatched `count` runs of `workflow` since `since`, follows them live, or not:
 * `--watch`/`--no-watch` say it for this run, else the config's `watch`, else `--yes` accepts; with
 * none of them, the person is asked, the first run preselected, and without a terminal nothing is
 * followed. A run not followed gets the command to follow it. False when a run followed failed.
 */
export const watchRuns = async (
  context: ReleaseContext,
  started: { workflow: string; since: Date; count: number },
) => {
  const { ciPipeline } = context.services;
  const { prompter, options, release } = context;
  const { startedRuns, watch } = ciPipeline;
  // Said once wins over asking: the flag for this run, then the config; --yes accepts the question.
  const said = options.watch ?? release.watch ?? (options.yes ? true : undefined);
  const asks = said === undefined && prompter.interactive;
  const wanted = said === true || asks;
  if (!startedRuns || !watch || !wanted || options.ci) {
    printFollowLines(context, []);
    return true;
  }
  const runs = await context.progress.during(
    `find the ${started.count === 1 ? "run" : plural(started.count, "run")} ${ciLabel(ciPipeline)} started`,
    "waiting",
    () => findRuns(context, startedRuns, started),
  );
  if (runs.length === 0) {
    context.output.line(
      paint("dim", `  ${ciLabel(ciPipeline)} shows no run yet: follow it later.`),
    );
    printFollowLines(context, []);
    return true;
  }
  let left = runs;
  let ok = true;
  while (left.length > 0) {
    const run = asks ? await pick(context, left) : left[0];
    if (!run) break;
    ok = (await follow(context, run, watch)) && ok;
    left = left.filter(({ id }) => id !== run.id);
  }
  printFollowLines(context, left);
  return ok;
};
