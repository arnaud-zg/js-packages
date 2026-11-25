import type { DecideContext, Decision } from "shiplane/plugin";
import { tagName } from "shiplane/plugin";

import type { EntryState } from "./entry-state";
import type { EasInput } from "./options";
import { buildRefusal, refuse } from "./build-refusal";
import { entryState } from "./entry-state";
import { buildJob, updateJob } from "./jobs";
import { finishFromTag, retryChoice } from "./retry.decision";
import { fewFiles } from "./wording";

/** A version the first environment did not fully get, a retry of it first, or a platform still missing it. */
const retried = async ({
  context,
  input,
  state,
}: {
  context: DecideContext;
  input: EasInput;
  state: EntryState;
}): Promise<Decision | null> => {
  const { analysis, ship } = state;
  // Main moved past a version it never fully got: retry the tag, or release the new code.
  if (ship === "moved-past" && analysis.plan.action === "build") {
    const retry = await retryChoice({ context, input, state });
    if (retry) return retry;
  }
  // It runs the tagged code, yet a platform may still miss it, such as a failed submission.
  if (ship === "shipped" && state.tag && !state.atTag && !state.updatedFromTag) {
    const retry = await retryChoice({ context, input, state, seenShipped: true });
    if (retry) return retry;
  }
  const finishes =
    state.atTag && (ship === "build" || (ship === "shipped" && analysis.plan.action === "submit"));
  return finishes ? finishFromTag({ context, input, state }) : null;
};

export const entryDecision = async ({
  context,
  input,
}: {
  context: DecideContext;
  input: EasInput;
}): Promise<Decision> => {
  const { unit, environment } = input;
  const version = unit.version;
  const state = await entryState({ context, input });
  const retry = await retried({ context, input, state });
  if (retry) return retry;
  const { analysis, codeSince, ship } = state;
  // Main moved past the tag: GitHub Actions still ships the tag, this machine only its checkout.
  const movedPast = ship === "moved-past";
  const kind = analysis.plan.action === "build" ? "build" : "update";
  // On CI an update still ships its tag; this machine would ship code no release named.
  const named = movedPast ? await codeSince(analysis.git.head) : [];
  const notLocal = movedPast
    ? { notLocal: `main moved past it (${fewFiles(named)} changed since)` }
    : {};
  switch (movedPast && kind === "update" ? kind : ship) {
    case "build": {
      const refusal = await buildRefusal({ context, analysis, input });
      return refusal
        ? refuse(refusal)
        : { action: "ship", kind: "build", jobs: [buildJob(input)], ...notLocal };
    }
    case "update":
      return {
        action: "ship",
        kind: "update",
        jobs: [updateJob(input, context.root)],
        ...notLocal,
      };
    case "wait":
      return {
        action: "none",
        status: `${unit.name} ${version} is building on EAS, submitted when done`,
      };
    case "shipped":
      return { action: "none", status: `${unit.name} ${version} is on ${environment}` };
    case "nothing":
      return {
        action: "none",
        status: `No ${unit.name} version to ship: add a changeset, then release.`,
      };
    case "behind":
      return refuse({
        title: "main is behind",
        detail: `the last ${environment} build carries a newer version.`,
        commands: ["git pull"],
      });
    case "moved-past":
      return refuse({
        title: `main moved past ${tagName(unit.name, version, context.tagFormat)}`,
        detail: `a binary or an update ships its commit, and ${fewFiles(await codeSince(analysis.git.head))} changed since, code no release named.`,
        commands: ["pnpm changeset", "shiplane"],
      });
  }
};
