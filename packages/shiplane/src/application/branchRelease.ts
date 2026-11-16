import type { OnDefault } from "../domain/branchRelease";
import type { OpenPr } from "../domain/releasePr";
import type { BranchPlan, Here } from "./branchPublish";
import type { ReleaseContext } from "./context";
import { branchChoice } from "../domain/branchRelease";
import { plural } from "../domain/words";
import { planBranch, publishBranch } from "./branchPublish";
import { releaseToPreview } from "./releaseToPreview";
import { fail, paint } from "./say";
import { runSteps } from "./steps";

const whereHere = async ({ services }: ReleaseContext): Promise<Here> => {
  const [{ branch, head, originMain }, defaultBranch] = await Promise.all([
    services.sourceControl.position(),
    services.sourceControl.defaultBranch(),
  ]);
  return { branch, head, defaultBranch, originMain };
};

const refuseDirty = (context: ReleaseContext) => {
  fail(
    context,
    "Uncommitted changes",
    "commit or stash them first, a test version publishes the commit you are on.",
  );
  return false;
};

const printOthers = ({ output }: ReleaseContext, others: readonly string[]) =>
  others.forEach((name) =>
    output.line(`  ${paint("dim", "–")} ${name}  ${paint("dim", "not part of a test release")}`),
  );

const nothingToPublish = (
  { progress }: ReleaseContext,
  { here, plan }: { here: Here; plan: BranchPlan },
) => {
  const nothing =
    here.branch === here.defaultBranch
      ? "nothing to publish: the next release ships no change"
      : `nothing changed since ${here.defaultBranch}`;
  const why =
    plan.others.length > 0 ? "nothing to publish: no changed unit is an npm package" : nothing;
  progress.say("resting", why);
  return true;
};

const whatPublishes = ({ publish }: BranchPlan) => {
  const [only] = publish;
  return publish.length === 1 && only ? only.version : plural(publish.length, "package");
};

/** The person picks a test release or the real one from the default branch; null on cancel. */
const askHow = ({ prompter }: ReleaseContext, { here, plan }: { here: Here; plan: BranchPlan }) =>
  prompter.select(
    `You're on ${here.branch}, not ${here.defaultBranch}.`,
    [
      {
        value: "publish",
        label: "Publish a test release",
        hint: `${whatPublishes(plan)} → npm tag ${plan.tag}`,
      },
      {
        value: "switch",
        label: `Switch to ${here.defaultBranch}`,
        hint: `git switch ${here.defaultBranch} && git pull, then the real release`,
      },
    ],
    "publish",
  );

/** Switches to the default branch, pulls it, then runs the real release from there. */
const switchAndRelease = async (context: ReleaseContext, { defaultBranch }: Here) => {
  const { sourceControl } = context.services;
  const pulled = await runSteps(context, [
    { label: `switch to ${defaultBranch}`, run: () => sourceControl.switchTo(defaultBranch) },
    { label: `pull ${defaultBranch}`, run: () => sourceControl.pull() },
  ]);
  if (!pulled) return false;
  return releaseToPreview({ ...context, release: await context.load() });
};

/** Plans what the test version publishes, asks when asked to, then publishes it. */
const publishTest = async (
  context: ReleaseContext,
  { here, pr, ask }: { here: Here; pr: OpenPr | null; ask: boolean },
) => {
  if (!(await context.services.sourceControl.isClean())) return refuseDirty(context);
  const plan = await planBranch(context, here);
  printOthers(context, plan.others);
  if (plan.publish.length === 0) return nothingToPublish(context, { here, plan });
  const answer = ask ? await askHow(context, { here, plan }) : "publish";
  if (answer === "switch") return switchAndRelease(context, here);
  if (answer === null) {
    context.progress.say("resting", paint("dim", "Nothing ran."));
    return true;
  }
  return publishBranch(context, { here, pr, plan });
};

/**
 * `shiplane` where it runs: on the default branch, the real release (or, for `shiplane branch`, a
 * test version of what the next release ships); on another branch, a temporary npm version of the
 * packages it changes, for testers, commented on its pull request when it has one. False when
 * refused or failed.
 */
export const branchRelease = async (
  context: ReleaseContext,
  { onDefault }: { onDefault: OnDefault },
): Promise<boolean> => {
  const here = await whereHere(context);
  const choice = branchChoice({
    onDefaultBranch: here.branch === here.defaultBranch,
    onDefault,
    yes: context.options.yes,
    interactive: context.prompter.interactive,
  });
  if (choice === "release") return releaseToPreview(context);
  const pr = await context.services.codeHost.prForBranch(here.branch);
  return publishTest(context, { here, pr, ask: choice === "ask" });
};
