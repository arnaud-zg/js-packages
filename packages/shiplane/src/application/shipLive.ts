import type { ReleaseContext } from "./context";
import { fail } from "./say";
import { shipTo } from "./ship";
import { missingTags, tagRelease } from "./tagRelease";
import { entry, flowOf, isRegistry } from "./targets";

/**
 * `shiplane ship --channel live`: the released packages, tagged when they are not, then published.
 * On a runner, the dist-tag of where users are follows. Apps never ship: they have environments.
 */
export const shipLive = async (
  context: ReleaseContext,
  names: readonly string[],
): Promise<boolean> => {
  const { units } = context.release;
  const packages = units.filter((unit) => isRegistry(context, unit)).map(({ name }) => name);
  const others = names.filter((name) => !packages.includes(name));
  if (others.length > 0) {
    fail(context, `Not a package: ${others.join(", ")}`, "live publishes packages only.");
    return false;
  }
  const scope = new Set(names.length > 0 ? names : packages);
  const tags = (await missingTags(context)).filter(({ app }) => scope.has(app));
  if (!(await tagRelease(context, tags))) return false;
  if (!(await shipTo(context, entry(context), { scope, via: "local" }))) return false;
  const { users } = flowOf(context);
  if (!context.options.ci || users === null || users === entry(context)) return true;
  return shipTo(context, users, { scope, via: "local" });
};
