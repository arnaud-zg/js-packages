import type { TaggedVersion } from "../domain/snapshotTags";
import type { ReleaseContext } from "./context";
import { ageProblem, DEFAULT_AGE_DAYS, staleSnapshotTags } from "../domain/snapshotTags";
import { plural } from "../domain/words";
import { padded } from "./branchPublish";
import { fail, paint, reasonOf } from "./say";
import { checkout, decideContext, entry as firstOf, runHere, unitTarget } from "./targets";

type Target = NonNullable<ReturnType<typeof unitTarget>>;

/** One old snapshot tag on one package, and the unit that package ships from. */
interface Stale extends TaggedVersion {
  name: string;
  days: number;
  target: Target;
}

/** Every package's snapshot tags at least `olderThanDays` old, as each registry lists them. */
const staleTags = async (context: ReleaseContext, olderThanDays: number): Promise<Stale[]> => {
  const at = await checkout(context);
  const decide = decideContext(context);
  const now = context.clock.now();
  const perUnit = await Promise.all(
    context.release.units.map(async (unit) => {
      const target = unitTarget(context, { unit, environment: firstOf(context), ...at });
      const read = target?.module.tags;
      if (!target || !read) return [];
      const name = target.module.publishedName?.(decide, target.input) ?? unit.packageName;
      const tags = await read(decide, target.input);
      return staleSnapshotTags({ tags, now, olderThanDays }).map((stale) => ({
        ...stale,
        name,
        target,
      }));
    }),
  );
  return perUnit.flat();
};

const printTable = ({ output }: ReleaseContext, stale: readonly Stale[]) => {
  const [header = "", ...rows] = padded([
    ["Package", "Tag", "Version", "Published"],
    ...stale.map(({ name, tag, version, days }) => [name, tag, version, `${days} days ago`]),
  ]);
  output.line(paint("dim", `  ${header}`));
  rows.forEach((row) => output.line(`  ${row}`));
};

/** Yes from the person in a terminal, or --yes anywhere: removing tags is never done unasked. */
const agreed = async (context: ReleaseContext, count: number) => {
  if (context.options.yes) return true;
  if (!context.prompter.interactive) {
    fail(context, "Not removed", "add --yes to remove them without a terminal to ask in.");
    return false;
  }
  return context.prompter.confirm(
    `Remove ${plural(count, "tag")}? Each version stays installable by its number.`,
  );
};

/** The code passed with --otp, or one asked for in a terminal; none when the account needs none. */
const firstCode = async ({ prompter }: ReleaseContext, otp: string | undefined) => {
  if (otp !== undefined || !prompter.interactive) return otp;
  const typed = await prompter.text(
    "npm one-time code, if your account asks for one (Enter: none)",
  );
  return typed?.trim() || undefined;
};

/**
 * Removes each tag in turn, with one code for all. A failure in a terminal asks for a fresh code
 * and retries, since a code lasts about 30 seconds; anywhere else it stops, and a rerun picks up
 * the tags still there. False when it stopped.
 */
const removeAll = async (context: ReleaseContext, stale: readonly Stale[], otp?: string) => {
  const decide = decideContext(context);
  let code = otp;
  for (const [index, entry] of stale.entries()) {
    for (;;) {
      const job = entry.target.module.untagJob?.(decide, entry.target.input, entry.tag, code);
      if (!job) break;
      try {
        await context.progress.during(
          job.label,
          "working",
          () => runHere(context, job, { tag: entry.target.tag, environment: firstOf(context) }),
          { index, total: stale.length },
        );
        break;
      } catch (error) {
        const fresh = context.prompter.interactive
          ? await context.prompter.text(
              `${job.label} failed: a fresh npm one-time code to retry (Enter: stop)`,
            )
          : null;
        if (!fresh?.trim()) {
          fail(
            context,
            `${job.label} failed`,
            `${reasonOf(error)}; ${plural(index, "tag")} of ${stale.length} removed. A one-time code lasts about 30 seconds: run it again with a fresh --otp, it picks up the tags still there.`,
          );
          return false;
        }
        code = fresh.trim();
      }
    }
  }
  return true;
};

/**
 * `shiplane prune-snapshots`: removes the npm tags old snapshots left, those of a version published
 * `olderThanDays` ago or more (30 by default, never under 7). Only tags a shiplane snapshot gives
 * are touched, never `latest` nor a numbered channel's; the versions stay installable by their
 * number. False when refused or stopped.
 */
export const pruneSnapshots = async (
  context: ReleaseContext,
  {
    olderThanDays = DEFAULT_AGE_DAYS,
    otp,
    dryRun = false,
  }: { olderThanDays?: number; otp?: string; dryRun?: boolean },
): Promise<boolean> => {
  const problem = ageProblem(olderThanDays);
  if (problem) {
    fail(context, "Not an age", problem);
    return false;
  }
  const stale = await staleTags(context, olderThanDays);
  if (stale.length === 0) {
    context.progress.say("resting", `No snapshot tag older than ${olderThanDays} days.`);
    return true;
  }
  context.progress.say(
    "resting",
    `${plural(stale.length, "snapshot tag")} older than ${olderThanDays} days${dryRun ? " (dry run)" : ""}`,
  );
  printTable(context, stale);
  if (dryRun) {
    context.output.line(paint("dim", "  Nothing removed."));
    return true;
  }
  if (!(await agreed(context, stale.length))) return false;
  if (!(await removeAll(context, stale, await firstCode(context, otp)))) return false;
  context.progress.say("happy", `${paint("green", "✓")} Removed ${plural(stale.length, "tag")}`);
  return true;
};
