import type { ReleaseContext } from "./context";
import { signIn, signInsOf } from "./requirements";
import { fail } from "./say";
import { shipTo } from "./ship";
import { missingTags, tagRelease } from "./tagRelease";
import { checkout, decideContext, entry, flowOf, isRegistry, unitTarget } from "./targets";

/** The packages whose version their registry does not hold yet, or cannot say. */
const unpublished = async (context: ReleaseContext, scope: ReadonlySet<string>) => {
  const at = await checkout(context);
  const units = context.release.units.filter(({ name }) => scope.has(name));
  const held = await Promise.all(
    units.map(async (unit) => {
      const target = unitTarget(context, { unit, environment: entry(context), ...at });
      const read = target?.module.publishedVersions;
      return target && read ? await read(decideContext(context), target.input) : [];
    }),
  );
  return new Set(
    units.filter(({ version }, index) => !held[index]?.includes(version)).map(({ name }) => name),
  );
};

/** On a runner, before a tag is pushed: whether each package about to publish may, from there. */
const mayPublish = async (context: ReleaseContext, scope: ReadonlySet<string>) => {
  if (!context.options.ci) return true;
  return signIn(context, {
    requirements: signInsOf(context.release, await unpublished(context, scope)),
    again: "run the workflow again",
  });
};

/**
 * `shiplane ship --channel latest`: the released packages, tagged when they are not, then published.
 * On a runner, the dist-tag of where users are follows. Apps never ship: they have environments.
 */
export const shipPackages = async (
  context: ReleaseContext,
  names: readonly string[],
): Promise<boolean> => {
  const { units } = context.release;
  const packages = units.filter((unit) => isRegistry(context, unit)).map(({ name }) => name);
  const others = names.filter((name) => !packages.includes(name));
  if (others.length > 0) {
    fail(context, `Not a package: ${others.join(", ")}`, "latest publishes packages only.");
    return false;
  }
  const scope = new Set(names.length > 0 ? names : packages);
  const tags = (await missingTags(context)).filter(({ app }) => scope.has(app));
  if (!(await mayPublish(context, scope))) return false;
  if (!(await tagRelease(context, tags))) return false;
  if (!(await shipTo(context, entry(context), { scope, via: "local" }))) return false;
  const { users } = flowOf(context);
  if (!context.options.ci || users === null || users === entry(context)) return true;
  return shipTo(context, users, { scope, via: "local" });
};
