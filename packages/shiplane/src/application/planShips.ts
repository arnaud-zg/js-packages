import type { Environment } from "../domain/environment";
import type { Shipped } from "../modules/module";
import type { ReleaseContext } from "./context";
import { prepareLine } from "../domain/prepare";
import { ciLabel } from "./askPath";
import { neededBuild } from "./buildIfNeeded";
import { planFollowUps } from "./followUps";
import { releaseOrder } from "./releaseOrder";
import { paint } from "./say";
import { checkout, commandLine, environmentLabel, shipPlanOf, unitTarget } from "./targets";

/**
 * `--dry-run`: every command shipping the current tags would run, both ways, in release order,
 * then what the features would do. It runs nothing and asks nothing; it reads git, and the code host
 * for features.
 */
export const planShips = async (context: ReleaseContext, environment: Environment) => {
  const { release, services, output } = context;
  const at = await checkout(context);
  output.line();
  output.line(
    `  ${paint("bold", "Plan")}  ${paint("dim", "·")}  ${environmentLabel(context, [], environment)}  ${paint("dim", "· nothing runs")}`,
  );
  output.line(`  ${paint("bold", "Order")}  ${releaseOrder(release.units)}`);
  const shipped: Shipped[] = [];
  for (const unit of release.units) {
    const target = unitTarget(context, { unit, environment, ...at });
    if (!target) continue;
    const { module, tag, input } = target;
    const tagged = (await services.sourceControl.tagCommit(tag)) !== null;
    if (tagged && !module.releaseOnly) shipped.push({ unit, tag, environment });
    const plan = shipPlanOf(context, module, input);
    output.line();
    output.line(
      `  ${paint("bold", tag)} → ${plan.where}${tagged ? "" : paint("yellow", "  (not tagged yet: release first)")}`,
    );
    const build = neededBuild(context, unit, plan.jobs);
    plan.jobs.forEach((job, index) => {
      output.line(`    ${paint("dim", "this machine")}`);
      if (index === 0 && release.prepare !== undefined) {
        output.line(`      sh -c ${JSON.stringify(prepareLine(release.prepare, unit))}`);
      }
      if (index === 0 && build) {
        output.line(`      ${build.shown}  ${paint("dim", `(in ${unit.dir}, if needed)`)}`);
      }
      job.local.forEach((command) => output.line(`      ${commandLine(command)}`));
      if (job.record)
        output.line(
          `      ${paint("dim", `then record ${tag} on ${environment} in GitHub Deployments`)}`,
        );
      if (job.ci) {
        const pipeline = services.ciPipeline;
        const inputs = { units: unit.name, environment };
        output.line(`    ${paint("dim", ciLabel(pipeline))}`);
        output.line(
          `      ${pipeline.dispatchLine?.(pipeline.shipWorkflow, job.ci.ref, inputs) ?? `dispatch ${pipeline.shipWorkflow} on ${job.ci.ref} with units=${unit.name}, environment=${environment}`}`,
        );
      }
    });
  }
  await planFollowUps(context, shipped);
  output.line();
};
