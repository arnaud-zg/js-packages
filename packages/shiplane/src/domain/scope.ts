import type { Environment } from "./environment";
import { plural } from "./words";

/** A unit whose live state its own platform knows, not GitHub Deployments: EAS for a mobile app. */
export interface DecidedBy {
  /** Who decides, as a person reads it: "EAS". */
  platform: string;
  /** What it decides between: "build or update". */
  choice: string;
  /** The command that shows its state: "shiplane status". */
  check: string;
}

export interface ScopeInfo {
  /** The unit's name. */
  app: string;
  version: string;
  /** Pending changesets naming it. */
  changesets: number;
  /** Its current version has a release tag. */
  tagged: boolean;
  /** A merged release PR brought its current version: untagged, that release is unfinished. */
  versioned: boolean;
  /** No version of it was ever tagged, and a commit brought its version: its first release. */
  firstRelease?: boolean;
  /** GitHub Deployments record that version on the channel being released. */
  onChannel: boolean;
  /** ...and on preview, which production promotes from. */
  onPreview: boolean;
  decidedBy?: DecidedBy;
  /** Nothing deploys it: once tagged, every environment has it. */
  releaseOnly?: boolean;
  /** It has no environment to be on, such as a package: a person reads it as live or not. */
  noEnvironment?: boolean;
}

export interface ScopeChoice {
  app: string;
  /** Something to release: offered and ticked. Otherwise shown greyed, with why. */
  pending: boolean;
  /** What it counts as beside others: `with changesets`, `first release`. */
  kind: string;
  hint: string;
}

const NOTHING = "with nothing to release";
const FIRST_RELEASE = "first release";

const previewChoice = ({
  version,
  changesets,
  tagged,
  versioned,
  firstRelease,
  onChannel,
  decidedBy,
  releaseOnly,
  noEnvironment,
}: ScopeInfo) => {
  const later = decidedBy ? ` · ${decidedBy.platform} decides ${decidedBy.choice} once picked` : "";
  if (changesets > 0)
    return {
      pending: true,
      kind: "with changesets",
      hint: `${plural(changesets, "changeset")}${later}`,
    };
  if (!tagged) {
    if (versioned)
      return {
        pending: true,
        kind: "to finish",
        hint: `${version} versioned, not tagged yet${later}`,
      };
    return firstRelease
      ? { pending: true, kind: FIRST_RELEASE, hint: `${version} first release${later}` }
      : { pending: false, kind: NOTHING, hint: "nothing new" };
  }
  if (releaseOnly)
    return { pending: false, kind: NOTHING, hint: `${version} released, nothing deploys it` };
  // Its builds and updates live on its platform, not in GitHub Deployments: the check reads them.
  if (decidedBy) {
    return onChannel
      ? {
          pending: false,
          kind: NOTHING,
          hint: `${version} released, nothing new (${decidedBy.check} shows its builds)`,
        }
      : {
          pending: true,
          kind: "to retry",
          hint: `${version} tagged, never reached preview: retry`,
        };
  }
  const where = noEnvironment ? "live" : "on preview";
  return onChannel
    ? { pending: false, kind: NOTHING, hint: `${version} is ${where}, nothing new` }
    : { pending: true, kind: "to retry", hint: `${version} released, not ${where} yet` };
};

const productionChoice = ({
  version,
  tagged,
  onChannel,
  onPreview,
  decidedBy,
  releaseOnly,
}: ScopeInfo) => {
  if (!tagged) return { pending: false, kind: NOTHING, hint: "not released yet" };
  if (releaseOnly)
    return { pending: false, kind: NOTHING, hint: `${version} released, nothing deploys it` };
  if (decidedBy) {
    return {
      pending: true,
      kind: "to promote",
      hint: `${version} released, ${decidedBy.platform} decides once picked`,
    };
  }
  if (onChannel)
    return { pending: false, kind: NOTHING, hint: `${version} is on production, nothing new` };
  return onPreview
    ? { pending: true, kind: "to promote", hint: `${version} is on preview, promotes it` }
    : {
        pending: false,
        kind: NOTHING,
        hint: `${version} is not on preview yet: release it there first`,
      };
};

/** The first question: which units have something to release here, and why not the rest. */
export const scopeChoices = (apps: ScopeInfo[], channel: Environment): ScopeChoice[] =>
  apps.map((info) => ({
    app: info.app,
    ...(channel === "production" ? productionChoice(info) : previewChoice(info)),
  }));

/** Units listed flat up to here; past it, by folder. */
const LONGEST_FLAT_LIST = 15;

export const isLong = (choices: readonly ScopeChoice[]) => choices.length > LONGEST_FLAT_LIST;

/** The units of one parent folder, as the first question asks them together. */
export interface ScopeFolder {
  /** `packages/`, from the root; `./` is the root itself. */
  label: string;
  choices: ScopeChoice[];
  /** Shown open: it holds something pending other than first releases. */
  open: boolean;
}

const parentOf = (dir: string) => `${dir.split("/").slice(0, -1).join("/") || "."}/`;

const rank = ({ pending, kind }: ScopeChoice) => {
  if (!pending) return 2;
  return kind === FIRST_RELEASE ? 1 : 0;
};

/** Units by parent folder, folders in the order they come, what is pending first in each. */
export const byFolder = (
  choices: readonly ScopeChoice[],
  dirs: ReadonlyMap<string, string>,
): ScopeFolder[] => {
  const folders = new Map<string, ScopeChoice[]>();
  for (const choice of choices) {
    const label = parentOf(dirs.get(choice.app) ?? "");
    folders.set(label, [...(folders.get(label) ?? []), choice]);
  }
  return [...folders].map(([label, units]) => ({
    label,
    choices: [...units].sort((a, b) => rank(a) - rank(b)),
    open: units.some((choice) => rank(choice) === 0),
  }));
};
