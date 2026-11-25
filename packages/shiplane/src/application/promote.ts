import type { Released } from "../domain/companions";
import type { DeployPath } from "../domain/deploys";
import type { Environment } from "../domain/environment";
import type { ReleaseContext } from "./context";
import { releasedTogether } from "../domain/companions";
import { capitalized, previousOf } from "../domain/environment";
import { scopeChoices } from "../domain/scope";
import { changelogSection, tagName } from "../domain/tags";
import { pickScope } from "./pickScope";
import { confirm, listed, paint } from "./say";
import { shipTo } from "./ship";
import { checkout, decideContext, entry, flowOf, unitTarget } from "./targets";

const STAGES = ["What to promote", "Ship"] as const;

/** Each unit's version on the environment before, with its notes, read from its tag. */
const releasedVersions = async (
  { release, services }: ReleaseContext,
  apps: readonly string[],
): Promise<Released[]> =>
  Promise.all(
    release.units
      .filter(({ name }) => apps.includes(name))
      .map(async ({ name, dir, version }) => {
        const changelog = await services.sourceControl.fileAt(
          tagName(name, version, release.tagFormat),
          services.versioning.changelogFile(dir),
        );
        return { app: name, version, notes: changelogSection(changelog ?? "", version) };
      }),
  );

/**
 * Which units a promote takes: the person's pick, plus what the environment before only ever ran with it when they
 * accept. Offered ticked with why, never added silently. Null when cancelled.
 */
export const pickPromotion = async (
  context: ReleaseContext,
  environment: Environment,
): Promise<Set<string> | null> => {
  const flow = flowOf(context);
  const previous = previousOf(flow, environment) ?? entry(context);
  const { output } = context;
  const picked = await pickScope(context, environment);
  if (!picked || picked.scope.size === 0) return null;
  const left = scopeChoices(picked.info, environment, flow)
    .filter(({ app, pending }) => pending && !picked.scope.has(app))
    .map(({ app }) => app);
  if (left.length === 0) return picked.scope;
  const companions = await context.progress.during(
    `Reading the notes of what ${previous} runs, to see what went there together`,
    "thinking",
    async () =>
      releasedTogether(
        await releasedVersions(context, [...picked.scope]),
        await releasedVersions(context, left),
        previous,
      ),
  );
  if (companions.length === 0) return picked.scope;
  const names = companions.map(({ app }) => app);
  const partners = [...new Set(companions.flatMap(({ with: partner }) => partner))];
  output.line();
  output.line(
    `  ${paint(["bold", "yellow"], "!")} ${paint("bold", `${capitalized(previous)} runs ${listed(names)} with what you picked:`)}`,
  );
  companions.forEach(({ app, version, why }) =>
    output.line(`      ${app.padEnd(11)}${version.padEnd(10)}${paint("dim", why)}`),
  );
  output.line();
  const versions = companions.map(({ app, version }) => `${app} ${version}`);
  const them = companions.length === 1 ? "it" : "them";
  if (
    await confirm(
      context,
      `Promote ${listed(versions)} too? ${capitalized(previous)} has only run ${them} with ${listed(partners)}.`,
      true,
    )
  ) {
    return new Set([...picked.scope, ...names]);
  }
  const promoted = picked.info
    .filter(({ app }) => partners.includes(app))
    .map(({ app, version }) => `${app} ${version}`);
  output.line(
    paint(
      "dim",
      `  ${listed(names)} ${companions.length === 1 ? "stays" : "stay"} on ${previous}: ${environment} runs ${listed(promoted)} next to the ${listed(names)} it has.`,
    ),
  );
  return picked.scope;
};

/** How each picked unit does on the environment before, said; when one looks unwell, asks before going on. */
const previousLooksWell = async (
  context: ReleaseContext,
  scope: ReadonlySet<string>,
  previous: Environment,
) => {
  const { output, release } = context;
  const at = await checkout(context);
  const reads = await context.progress.during(
    `Reading how ${previous} runs what you picked`,
    "thinking",
    () =>
      Promise.all(
        release.units
          .filter(({ name }) => scope.has(name))
          .map(async (unit) => {
            const target = unitTarget(context, { unit, environment: previous, ...at });
            if (!target?.module.health) return [];
            const health = await target.module
              .health(decideContext(context), target.input)
              .catch(() => null);
            return health ? [{ tag: target.tag, ...health }] : [];
          }),
      ),
  );
  const healths = reads.flat();
  if (healths.length === 0) return true;
  output.line();
  healths.forEach(({ tag, ok, summary }) =>
    output.line(
      `  ${ok ? paint("green", "✓") : paint(["bold", "yellow"], "!")} ${tag.padEnd(18)}${paint("dim", summary)}`,
    ),
  );
  output.line();
  const unwell = healths.filter(({ ok }) => !ok);
  if (unwell.length === 0) return true;
  const reasons = unwell.map(({ tag, why }) => `${tag}: ${why ?? "looks unwell"}`);
  return confirm(context, `Promote anyway? ${reasons.join("; ")}.`, false);
};

/** Where this promote goes: named, the only place, or the person's pick; null when cancelled. */
const promoteTo = async (context: ReleaseContext, named: Environment | undefined) => {
  const [next, ...further] = flowOf(context).path.slice(1);
  if (named !== undefined || next === undefined || further.length === 0)
    return named ?? next ?? null;
  if (!context.prompter.interactive) return next;
  return context.prompter.select(
    "Promote to?",
    [next, ...further].map((name) => ({
      value: name,
      label: name,
      hint: `from what ${previousOf(flowOf(context), name)} runs`,
    })),
    next,
  );
};

/** The next environment, from what the one before runs: every unit picked, each step asked. */
export const promote = async (
  context: ReleaseContext,
  via: DeployPath | undefined,
  named?: Environment,
) => {
  const environment = await promoteTo(context, named);
  const previous = environment && previousOf(flowOf(context), environment);
  if (!environment || !previous) return true;
  context.progress.stage(STAGES, 0);
  const scope = await pickPromotion(context, environment);
  if (!scope) return true;
  if (!(await previousLooksWell(context, scope, previous))) {
    context.output.line(paint("dim", "  Nothing promoted."));
    return true;
  }
  context.progress.stage(STAGES, 1);
  return shipTo(context, environment, { scope, via });
};
