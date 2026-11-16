import type { OpenPr } from "../domain/releasePr";
import type { BranchPlan, Here } from "./branchPublish";
import type { ReleaseContext } from "./context";
import { branchChoice } from "../domain/branchRelease";
import { plural } from "../domain/words";
import { planBranch, publishBranch } from "./branchPublish";
import { releaseToPreview } from "./releaseToPreview";
import { fail, paint } from "./say";
import { runSteps } from "./steps";

/** What `shiplane` does on the default branch: the real release, or, for `shiplane branch`, refuse. */
export type OnDefault = "release" | "refuse";

const whereHere = async ({ services }: ReleaseContext): Promise<Here> => {
  const [{ branch, head }, defaultBranch] = await Promise.all([
    services.sourceControl.position(),
    services.sourceControl.defaultBranch(),
  ]);
  return { branch, head, defaultBranch };
};

const refuseOnDefault = (context: ReleaseContext, { defaultBranch }: Here) => {
  fail(
    context,
    `On ${defaultBranch}`,
    `a branch release publishes a feature branch; on ${defaultBranch}, run the real release.`,
    ["shiplane"],
  );
  return false;
};

const refuseWithoutPr = (context: ReleaseContext, { branch, defaultBranch }: Here) => {
  fail(
    context,
    `No pull request for ${branch}`,
    `open a pull request for ${branch} first, or switch to ${defaultBranch}.`,
    ["gh pr create", `git switch ${defaultBranch}`],
  );
  return false;
};

const refuseDirty = (context: ReleaseContext) => {
  fail(
    context,
    "Uncommitted changes",
    "commit or stash them first, a branch release publishes the commit its pull request shows.",
  );
  return false;
};

const printOthers = ({ output }: ReleaseContext, others: readonly string[]) =>
  others.forEach((name) =>
    output.line(`  ${paint("dim", "–")} ${name}  ${paint("dim", "not part of a branch release")}`),
  );

const nothingToPublish = ({ progress, services }: ReleaseContext, { others }: BranchPlan) => {
  const why =
    others.length > 0
      ? "nothing to publish: no pending unit is an npm package"
      : `nothing to release: add a change with ${paint("cyan", services.versioning.nextChange)}`;
  progress.say("resting", why);
  return true;
};

const whatPublishes = ({ publish }: BranchPlan) => {
  const [only] = publish;
  return publish.length === 1 && only ? only.version : plural(publish.length, "package");
};

/** The person picks a branch release or the real one from the default branch; null on cancel. */
const askHow = ({ prompter }: ReleaseContext, { here, plan }: { here: Here; plan: BranchPlan }) =>
  prompter.select(
    `You're on ${here.branch}, not ${here.defaultBranch}.`,
    [
      {
        value: "publish",
        label: "Publish a branch release",
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

/** A branch with a pull request: plan what it publishes, ask when asked to, then publish. */
const fromBranch = async (
  context: ReleaseContext,
  { here, pr, ask }: { here: Here; pr: OpenPr; ask: boolean },
) => {
  if (!(await context.services.sourceControl.isClean())) return refuseDirty(context);
  const plan = await planBranch(context, here);
  printOthers(context, plan.others);
  if (plan.publish.length === 0) return nothingToPublish(context, plan);
  const answer = ask ? await askHow(context, { here, plan }) : "publish";
  if (answer === "switch") return switchAndRelease(context, here);
  if (answer === null) {
    context.progress.say("resting", paint("dim", "Nothing ran."));
    return true;
  }
  return publishBranch(context, { here, pr, plan });
};

/**
 * `shiplane` where it runs: the real release on the default branch; on another branch with an open
 * pull request, a temporary npm version of the packages it changes, for testers. False when refused
 * or failed.
 */
export const branchRelease = async (
  context: ReleaseContext,
  { onDefault }: { onDefault: OnDefault },
): Promise<boolean> => {
  const here = await whereHere(context);
  const onDefaultBranch = here.branch === here.defaultBranch;
  const pr = onDefaultBranch ? null : await context.services.codeHost.prForBranch(here.branch);
  const choice = branchChoice({
    onDefault: onDefaultBranch,
    pr,
    yes: context.options.yes,
    interactive: context.prompter.interactive,
  });
  if (choice === "release") {
    return onDefault === "release" ? releaseToPreview(context) : refuseOnDefault(context, here);
  }
  if (choice === "no-pr" || !pr) return refuseWithoutPr(context, here);
  return fromBranch(context, { here, pr, ask: choice === "ask" });
};
