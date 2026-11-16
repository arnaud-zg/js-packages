import type { Environment } from "../domain/environment";
import type { Shipped } from "../modules/module";
import type { ReleaseContext } from "./context";
import { planFollowUps } from "./followUps";
import { releaseOrder } from "./releaseOrder";
import { paint } from "./say";
import { checkout, commandLine, environmentLabel, shipPlanOf, unitTarget } from "./targets";

/**
 * `shiplane plan`: every command shipping the current tags would run, both ways, in release order,
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
    plan.jobs.forEach((job) => {
      output.line(`    ${paint("dim", "this machine")}`);
      job.local.forEach((command) => output.line(`      ${commandLine(command)}`));
      if (job.record)
        output.line(
          `      ${paint("dim", `then record ${tag} on ${environment} in GitHub Deployments`)}`,
        );
      if (job.ci) {
        const workflow = services.ciPipeline.shipWorkflow;
        output.line(`    ${paint("dim", "GitHub Actions")}`);
        output.line(
          `      gh workflow run ${workflow} --ref ${job.ci.ref} -f units=${unit.name} -f environment=${environment}`,
        );
      }
    });
  }
  await planFollowUps(context, shipped);
  output.line();
};
