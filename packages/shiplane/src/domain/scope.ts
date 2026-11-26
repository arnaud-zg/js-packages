import type { UnitRef } from "./changes";
import type { DeployFlow, Environment } from "./environment";
import { entryOf, previousOf } from "./environment";
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
  /** ...and on the environment before it, which it is promoted from. */
  onPrevious: boolean;
  decidedBy?: DecidedBy;
  /** Nothing deploys it: once tagged, every environment has it. */
  releaseOnly?: boolean;
  /** It has no environment to be on, such as a package: a person reads it as live or not. */
  noEnvironment?: boolean;
  /** Deployed apps that use it, directly or through other packages: its move may take them along. */
  usedBy?: string[];
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

const releaseChoice = (
  {
    version,
    changesets,
    tagged,
    versioned,
    firstRelease,
    onChannel,
    decidedBy,
    releaseOnly,
    noEnvironment,
  }: ScopeInfo,
  environment: Environment,
) => {
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
          hint: `${version} tagged, never reached ${environment}: retry`,
        };
  }
  const where = noEnvironment ? "live" : `on ${environment}`;
  return onChannel
    ? { pending: false, kind: NOTHING, hint: `${version} is ${where}, nothing new` }
    : { pending: true, kind: "to retry", hint: `${version} released, not ${where} yet` };
};

const promoteChoice = (
  { version, tagged, onChannel, onPrevious, decidedBy, releaseOnly }: ScopeInfo,
  environment: Environment,
  previous: Environment,
) => {
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
    return { pending: false, kind: NOTHING, hint: `${version} is on ${environment}, nothing new` };
  return onPrevious
    ? {
        pending: true,
        kind: "to promote",
        hint: `${version} is on ${previous}, promotes it`,
      }
    : {
        pending: false,
        kind: NOTHING,
        hint: `${version} is not on ${previous} yet: release it there first`,
      };
};

/** The `deployable` units whose package uses `packageName`, directly or through other packages. */
export const deployedUsers = (
  packageName: string,
  dependencies: Record<string, string[]>,
  units: readonly UnitRef[],
  deployable: ReadonlySet<string>,
): string[] => {
  const uses = (from: string, seen: Set<string>): boolean =>
    (dependencies[from] ?? []).some(
      (dependency) =>
        dependency === packageName ||
        (!seen.has(dependency) && uses(dependency, seen.add(dependency))),
    );
  return units
    .filter(({ name, packageName: own }) => own !== packageName && deployable.has(name))
    .filter(({ packageName: own }) => uses(own, new Set([own])))
    .map(({ name }) => name);
};

/** What a pending unit says about the apps that use it: changesets move them with it. */
const goesAlong = (usedBy: readonly string[] = []) =>
  usedBy.length === 0
    ? ""
    : ` · ${usedBy.join(", ")} ${usedBy.length === 1 ? "uses" : "use"} it, may go along`;

/** The first question: which units have something to release here, and why not the rest. */
export const scopeChoices = (
  apps: ScopeInfo[],
  environment: Environment,
  flow: DeployFlow,
): ScopeChoice[] => {
  const previous = previousOf(flow, environment);
  return apps.map((info) => {
    if (previous !== null) return { app: info.app, ...promoteChoice(info, environment, previous) };
    const choice = releaseChoice(info, entryOf(flow));
    const hint = choice.pending ? `${choice.hint}${goesAlong(info.usedBy)}` : choice.hint;
    return { app: info.app, ...choice, hint };
  });
};

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
