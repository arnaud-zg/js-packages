import type { OnDefault } from "../domain/branchRelease";
import type { OpenPr } from "../domain/releasePr";
import type { Channel } from "../domain/testChannel";
import type { BranchPlan, Here } from "./branchPublish";
import type { ReleaseContext } from "./context";
import { branchChoice } from "../domain/branchRelease";
import { channelFor, channelProblem } from "../domain/testChannel";
import { plural } from "../domain/words";
import { planBranch, printPlan, publishBranch } from "./branchPublish";
import { releaseToPreview } from "./releaseToPreview";
import { fail, paint, reasonOf } from "./say";
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
    output.line(
      `  ${paint("dim", "–")} ${name}  ${paint("dim", "test release not available yet: npm packages only")}`,
    ),
  );

const nothingToPublish = ({ progress, services }: ReleaseContext, plan: BranchPlan) => {
  const why =
    plan.others.length > 0
      ? "nothing to publish: no pending unit is an npm package"
      : `nothing pending: a test release publishes what the changesets release, add one with ${services.versioning.nextChange}`;
  progress.say("resting", why);
  return true;
};

/**
 * In a terminal, with more than one package pending, the person keeps the ones to test, all
 * offered; null on cancel. Otherwise the plan as it is.
 */
const pickPackages = async (
  { prompter }: ReleaseContext,
  plan: BranchPlan,
): Promise<BranchPlan | null> => {
  if (plan.publish.length < 2) return plan;
  const names = plan.publish.map(({ unit }) => unit.name);
  const kept = await prompter.multiselect(
    "Which pending packages get a test release?",
    plan.publish.map(({ unit, version }) => ({
      value: unit.name,
      label: unit.name,
      hint: version,
    })),
    names,
  );
  if (kept === null || kept.length === 0) return null;
  return { ...plan, publish: plan.publish.filter(({ unit }) => kept.includes(unit.name)) };
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

/** What the test version publishes on the channel; null, said, when its registry cannot say. */
const planOn = async (context: ReleaseContext, here: Here, channel: Channel) => {
  try {
    return await planBranch(context, { here, channel });
  } catch (error) {
    fail(context, `Cannot number ${channel}`, reasonOf(error));
    return null;
  }
};

/** Plans what the test version publishes, asks when asked to, then publishes it or only shows it. */
const publishTest = async (
  context: ReleaseContext,
  {
    here,
    pr,
    ask,
    pick,
    channel,
    dryRun,
  }: {
    here: Here;
    pr: OpenPr | null;
    ask: boolean;
    /** Ask which pending packages to keep. */
    pick: boolean;
    channel: Channel;
    dryRun: boolean;
  },
) => {
  if (!dryRun && !(await context.services.sourceControl.isClean())) return refuseDirty(context);
  const plan = await planOn(context, here, channel);
  if (!plan) return false;
  printOthers(context, plan.others);
  if (plan.publish.length === 0) return nothingToPublish(context, plan);
  if (dryRun) return printPlan(context, plan);
  const answer = ask ? await askHow(context, { here, plan }) : "publish";
  if (answer === "switch") return switchAndRelease(context, here);
  const picked = answer === null ? null : pick ? await pickPackages(context, plan) : plan;
  if (picked === null) {
    context.progress.say("resting", paint("dim", "Nothing ran."));
    return true;
  }
  return publishBranch(context, { here, pr, plan: picked });
};

/**
 * `shiplane` where it runs: on the default branch, the real release; elsewhere, or for `shiplane
 * test-release`, a test version of the npm packages the pending changesets release, on the branch's
 * channel (a snapshot unless `testRelease` says otherwise), commented on its pull request when it
 * has one. False when refused or failed.
 */
export const branchRelease = async (
  context: ReleaseContext,
  {
    onDefault,
    channel: picked,
    dryRun = false,
  }: {
    onDefault: OnDefault;
    /** The channel for this run, over the one `testRelease` gives the branch. */
    channel?: string;
    /** Show what would publish, at which versions and tag, and publish nothing. */
    dryRun?: boolean;
  },
): Promise<boolean> => {
  const problem = picked === undefined ? null : channelProblem(picked);
  if (problem) {
    fail(context, "Not a channel", problem);
    return false;
  }
  const here = await whereHere(context);
  const choice = branchChoice({
    onDefaultBranch: here.branch === here.defaultBranch,
    onDefault,
    yes: context.options.yes,
    interactive: context.prompter.interactive,
  });
  if (choice === "release") return releaseToPreview(context);
  const channel = picked ?? channelFor(here.branch, context.release.testRelease);
  const pr = dryRun ? null : await context.services.codeHost.prForBranch(here.branch);
  // A channel named on the command line is the answer: nothing left to ask.
  const ask = choice === "ask" && picked === undefined && !dryRun;
  const pick = context.prompter.interactive && !context.options.yes && !dryRun;
  return publishTest(context, { here, pr, ask, pick, channel, dryRun });
};
