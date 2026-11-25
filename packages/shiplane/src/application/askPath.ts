import type { ActionsMinutes } from "../domain/budget";
import type { DeployPath, ShipItem } from "../domain/deploys";
import type { Environment } from "../domain/environment";
import type { CiPipelinePort, MinutesBlocked } from "../ports/ci-pipeline.port";
import type { ReleaseContext } from "./context";
import { deployEstimate, minutesBudget } from "../domain/budget";
import { fail, paint } from "./say";

export interface Shipment {
  item: ShipItem;
  /** The workflow its jobs dispatch on the CI pipeline, if any. */
  workflows: string[];
  typicalMinutes: number | undefined;
}

/** What a person calls the CI pipeline: its own label, else `CI`. */
export const ciLabel = (ci: CiPipelinePort) => ci.label ?? "CI";

/** A way to ship, as a person reads it: the pipeline's label, or this machine. */
export const pathLabel = (ci: CiPipelinePort, path: DeployPath) =>
  path === "ci" ? ciLabel(ci) : "this machine";

/** The minutes block above the question: status, what is left, this release shaded in, the pace. */
const showMinutes = (
  { output, clock, services }: ReleaseContext,
  budget: ActionsMinutes,
  estimate: ReturnType<typeof deployEstimate>,
) => {
  const label = ciLabel(services.ciPipeline);
  const drawn = minutesBudget(budget, clock.now(), 30, estimate.total, label);
  output.line();
  output.line(`  ${paint("bold", drawn.title)}   ${paint(["bold", drawn.tone], drawn.status)}`);
  output.line(`  ${paint(drawn.tone, drawn.bar)}  ${paint(["bold", drawn.tone], drawn.amount)}`);
  if (drawn.after) {
    output.line(`  ${drawn.after}`);
    const each = estimate.lines.map(
      ({ app, minutes, measured }) =>
        `${app} ~${minutes} ${measured ? "(its last runs)" : "(typical, no run yet)"}`,
    );
    output.line(`  ${paint("dim", `  ${each.join(" · ")}`)}`);
  }
  output.line(`  ${paint("dim", drawn.pace)}`);
  output.line();
};

/** Why the minutes are not shown, where to read them, and what shows them next time. */
const warnBlocked = (
  { output, services }: ReleaseContext,
  { reason, url, fix }: MinutesBlocked,
) => {
  const label = ciLabel(services.ciPipeline);
  output.line();
  output.line(`  ${paint("yellow", `⚠ ${label} minutes not shown: ${reason}`)} You can continue.`);
  output.line(`    See them: ${paint("cyan", url)}`);
  if (fix) output.line(`    Show them here next time: ${paint("cyan", fix)}`);
  output.line();
};

/**
 * How each unit ships, asked one by one with this month's Actions minutes shown once: GitHub Actions
 * or this machine, in the order given. Null when cancelled or without a terminal to ask.
 */
export const askPaths = async (
  context: ReleaseContext,
  environment: Environment,
  shipments: readonly Shipment[],
): Promise<DeployPath[] | null> => {
  const { services, prompter, clock } = context;
  const measured = Object.fromEntries(
    await Promise.all(
      shipments.map(async ({ item, workflows }) => [
        item.app,
        (
          await Promise.all(
            workflows.map((workflow) => services.ciPipeline.measuredMinutes(workflow)),
          )
        ).flat(),
      ]),
    ),
  );
  const typical = Object.fromEntries(
    shipments.flatMap(({ item, typicalMinutes }) =>
      typicalMinutes === undefined ? [] : [[item.app, typicalMinutes]],
    ),
  );
  const estimate = deployEstimate(
    shipments.map(({ item }) => item),
    measured,
    typical,
  );
  const minutes = await services.ciPipeline.minutes();
  const blocked = minutes && "reason" in minutes ? minutes : null;
  const budget = minutes && "included" in minutes ? minutes : null;
  if (blocked && prompter.interactive) warnBlocked(context, blocked);
  if (budget) showMinutes(context, budget, estimate);
  if (!prompter.interactive) {
    fail(context, "Not a terminal", "say how to ship.", [
      "shiplane ship --via ci",
      "shiplane ship --via local",
    ]);
    return null;
  }
  const low =
    budget !== null && minutesBudget(budget, clock.now(), 30, estimate.total).tone === "red";
  const paths: DeployPath[] = [];
  for (const { item } of shipments) {
    const cost = estimate.lines.find(({ app }) => app === item.app)?.minutes;
    const path = await prompter.select<DeployPath>(
      `How should ${item.tag} ship to ${environment}?`,
      [
        {
          value: "ci",
          label: pathLabel(services.ciPipeline, "ci"),
          hint: budget
            ? `runs on ${ciLabel(services.ciPipeline)} from its tag, about ${cost} of ${budget.left.toLocaleString("en-US")} minutes left`
            : `its workflow runs on ${ciLabel(services.ciPipeline)}, from its tag`,
        },
        {
          value: "local",
          label: pathLabel(services.ciPipeline, "local"),
          hint: "the same commands, run here: no Actions minutes",
        },
      ],
      low ? "local" : "ci",
    );
    if (!path) return null;
    paths.push(path);
  }
  return paths;
};
