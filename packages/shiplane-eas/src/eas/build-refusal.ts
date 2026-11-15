import type { DecideContext, Decision, Refusal } from "shiplane/plugin";
import { releaseSource } from "shiplane/plugin";

import type { Analysis } from "./analyse";
import type { EasInput } from "./options";
import { needsNewVersion } from "./decide";

export const refuse = (refusal: Refusal): Decision => ({ action: "fail", ...refusal });

/** The checks a new binary passes before EAS builds it: from main, a new version, a clean tree. */
export const buildRefusal = async ({
  context,
  analysis,
  input,
  retry = false,
}: {
  context: DecideContext;
  analysis: Analysis;
  input: EasInput;
  /** A retry finishes a version already built on a platform. */
  retry?: boolean;
}): Promise<Refusal | null> => {
  // A runner checked out at the tag builds exactly what the release named.
  const tagCommit = await context.sourceControl.tagCommit(input.tag);
  const source = releaseSource("build", input.environment, analysis.git, { tagCommit });
  if (!source.allowed) {
    return source.why === "not-main"
      ? {
          title: `Not from ${analysis.git.branch}`,
          detail: "a binary ships what it is built from, so builds start from main.",
          commands: ["git switch main", "git pull", "shiplane ship"],
        }
      : {
          title: "main is behind origin",
          detail: "pull it first, a release ships what is merged.",
          commands: ["git pull"],
        };
  }
  // A retry finishes the version a platform already built from its tag, on the other platform.
  if (!retry && needsNewVersion(analysis.checked.map(({ state }) => state))) {
    return {
      title: `${analysis.version} already has a ${input.environment} binary`,
      detail: "a new native layer needs a new version, or updates would reach both binaries.",
      commands: ["shiplane"],
    };
  }
  if (!(await context.sourceControl.isClean())) {
    return {
      title: "Uncommitted changes",
      detail: "commit or stash them first, a release ships the commit.",
      commands: [],
    };
  }
  return null;
};
