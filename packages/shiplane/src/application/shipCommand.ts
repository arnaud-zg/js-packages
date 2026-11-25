import type { DeployPath } from "../domain/deploys";
import type { Environment } from "../domain/environment";
import type { ReleaseContext } from "./context";
import { shipTo } from "./ship";
import { missingTags, tagRelease } from "./tagRelease";
import { isRegistry, skipsPreview } from "./targets";

/**
 * `shiplane ship`. On a runner, where there is nothing to preview, the packages a merged release PR
 * brought are tagged first: the run started by hand is the whole release.
 */
export const shipCommand = async (
  context: ReleaseContext,
  {
    environment,
    units,
    via,
  }: { environment: Environment; units: readonly string[]; via?: DeployPath },
): Promise<boolean> => {
  const packages = new Set(
    context.release.units
      .filter((unit) => isRegistry(context, unit))
      .map(({ name }) => name)
      .filter((name) => units.length === 0 || units.includes(name)),
  );
  if (context.options.ci && skipsPreview(context)) {
    const tags = (await missingTags(context)).filter(({ app }) => packages.has(app));
    if (!(await tagRelease(context, tags))) return false;
  }
  return shipTo(context, environment, {
    via,
    ...(units.length > 0 ? { scope: new Set(units) } : {}),
  });
};
