import path from "node:path";
import type { DecideContext, Decision, ReleaseUnit } from "shiplane/plugin";

import type { EasClient } from "./client";
import type { RetryStep } from "./decide";
import type { EasInput } from "./options";
import type { PreviewState } from "./preview-state";
import { PLATFORMS } from "./analyse";
import { buildRefusal, refuse } from "./build-refusal";
import { retryStep } from "./decide";
import { retryJobs, updateJob } from "./jobs";
import { binaryVersion, previewVersionIn } from "./version-file";
import { fewFiles, retryFailure, retryLine } from "./wording";

/**
 * What the release at the tag named: a build moves the preview binary version to the tagged
 * version, an update leaves it on the binary it targets. Read at the tag, not at HEAD.
 */
const namedAtTag = async ({
  context,
  input: { unit, options, tag },
}: {
  context: DecideContext;
  input: EasInput;
}): Promise<{ ships: "build" | "update"; binary: string }> => {
  const text = await context.sourceControl.fileAt(
    tag,
    path.posix.join(unit.dir, options.versionFile),
  );
  const binary =
    previewVersionIn(text) ??
    binaryVersion({ root: context.root, unit, options, environment: "preview" });
  return { ships: binary === unit.version ? "build" : "update", binary };
};

/** Each platform's step for a binary version the tag named, from its builds and submissions. */
const retrySteps = async ({
  client,
  sinceTag,
  binary,
}: {
  client: EasClient;
  sinceTag: PreviewState["sinceTag"];
  binary: string;
}): Promise<RetryStep[]> =>
  Promise.all(
    PLATFORMS.map(async (platform) => {
      const builds = await client.versionBuilds({
        platform,
        environment: "preview",
        version: binary,
      });
      const finishedFromTag = await sinceTag(builds.finished?.gitCommit ?? null);
      const submissions =
        builds.finished && finishedFromTag && !builds.running
          ? await client.submissions({ platform, environment: "preview" })
          : [];
      return retryStep({ platform, ...builds, finishedFromTag, submissions });
    }),
  );

/** Nothing left to retry: every platform done, or the rest still building. */
const settled = ({
  unit,
  steps,
}: {
  unit: ReleaseUnit;
  steps: readonly RetryStep[];
}): Decision | null => {
  if (steps.every(({ action }) => action === "done")) {
    return { action: "none", status: `${unit.name} ${unit.version} is on preview` };
  }
  if (steps.every(({ action }) => action === "done" || action === "running")) {
    return {
      action: "none",
      status: `${unit.name} ${unit.version} is building on EAS, submitted when done`,
    };
  }
  return null;
};

const NEW_CODE = ["pnpm changeset", "pnpm shiplane"];

/**
 * Main moved past a version that never reached preview: the person picks between retrying the
 * tagged version as released and releasing the new code. With nobody to ask, it refuses and says
 * what a terminal run offers.
 */
export const retryChoice = async ({
  context,
  input,
  state,
  seenShipped = false,
}: {
  context: DecideContext;
  input: EasInput;
  state: PreviewState;
  /** Preview already runs the tagged code: offer a retry only when a platform still misses it. */
  seenShipped?: boolean;
}): Promise<Decision | null> => {
  const { unit, tag } = input;
  const version = unit.version;
  const { client, codeSince, sinceTag, analysis } = state;
  const named = await namedAtTag({ context, input });
  // An update the tag named is checked by preview's last update, which a retry would repeat.
  if (named.ships === "update" && (seenShipped || state.updatedFromTag)) {
    return seenShipped ? null : { action: "none", status: `${unit.name} ${version} is on preview` };
  }
  const steps =
    named.ships === "build" ? await retrySteps({ client, sinceTag, binary: named.binary }) : [];
  const done = named.ships === "build" ? settled({ unit, steps }) : null;
  if (done) return seenShipped ? null : done;
  const [changed, commits, notes] = await Promise.all([
    codeSince(analysis.git.head),
    context.sourceControl.commitsBetween(state.tag ?? tag, analysis.git.head),
    context.codeHost
      .releasedTags()
      .then((tags) => tags.has(tag))
      .catch(() => null),
  ]);
  const files = fewFiles(changed);
  const moved = `main has ${commits.length} ${commits.length === 1 ? "commit" : "commits"} since its tag (${files}).`;
  const failure = retryFailure({ steps, now: context.now() });
  const jobs =
    named.ships === "build"
      ? retryJobs({ input, steps, fromTag: true })
      : [{ ...updateJob(input), from: tag }];
  const line =
    named.ships === "build"
      ? retryLine({ steps, notes })
      : `tag ✓${notes === null ? "" : `, release notes ${notes ? "✓" : "✗"}`} → publish the preview update from ${tag}`;
  // With no failure to show, the question asks whether there was one: the options answer it.
  const [retry, newCode] = failure ? ["Retry", "Release"] : ["Yes, retry", "No, release"];
  return {
    action: "choose",
    lines: [
      failure
        ? `${unit.name} ${version} didn't reach preview: ${failure.short}.`
        : `${unit.name} ${version} is tagged, but nothing for it reached preview.`,
      moved,
    ],
    question: failure
      ? "What should ship?"
      : `Did the last attempt to ship ${version} fail before it got this far?`,
    suggested: "retry",
    options: [
      {
        value: "retry",
        label: `${retry} ${version} exactly as released`,
        jobs,
        then: [line],
      },
      {
        value: "new-code",
        label: `${newCode} the new code instead (pnpm changeset, then shiplane)`,
        jobs: [],
        then: NEW_CODE,
      },
      { value: "cancel", label: "Cancel", jobs: [] },
    ],
    held: "nothing shipped",
    kind:
      named.ships === "update"
        ? "update"
        : steps.some(({ action }) => action === "build")
          ? "build"
          : "submit",
    confirmed: true,
    unattended: {
      title: `main moved past ${tag}`,
      detail: failure
        ? `The last ${failure.platform} ${failure.what} of ${version} ${failure.verb} ${failure.when}: run it from a terminal to retry ${version} as released.`
        : `nothing for ${version} reached preview, and ${files} changed since: run it from a terminal to retry ${version} as released.`,
      commands: [`pnpm shiplane ship ${unit.name}`, "pnpm changeset"],
    },
  };
};

/**
 * HEAD carries the tagged code and the release named a build: a platform that already built it
 * from the tag is left alone or only submitted, the others build.
 */
export const finishFromTag = async ({
  context,
  input,
  state,
}: {
  context: DecideContext;
  input: EasInput;
  state: PreviewState;
}): Promise<Decision | null> => {
  const named = await namedAtTag({ context, input });
  if (named.ships !== "build") return null;
  const steps = await retrySteps({
    client: state.client,
    sinceTag: state.sinceTag,
    binary: named.binary,
  });
  if (steps.every(({ action }) => action === "build")) return null;
  const done = settled({ unit: input.unit, steps });
  if (done) return done;
  const refusal = await buildRefusal({ context, analysis: state.analysis, input, retry: true });
  if (refusal) return refuse(refusal);
  const jobs = retryJobs({ input, steps, fromTag: false });
  const builds = steps.some(({ action }) => action === "build");
  return { action: "ship", kind: builds ? "build" : "submit", jobs };
};
