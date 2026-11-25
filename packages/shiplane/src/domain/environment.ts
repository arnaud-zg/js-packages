/** Where an app runs, as its repository names it. */
export type Environment = string;

/** An app's way to its users. */
export interface DeployFlow {
  /** The environments in promotion order: a release deploys to the first. */
  path: readonly Environment[];
  /** The one users are on: guarded. Null when nothing is promoted to them. */
  users: Environment | null;
}

/** What a repository that says nothing uses. */
export const DEFAULT_FLOW = {
  path: ["preview", "production"],
  users: "production",
} as const satisfies DeployFlow;

/** The released packages' channel: tagged, then published under their real dist-tag. */
export const LIVE = "live";

/** Where a release deploys. */
export const entryOf = ({ path }: DeployFlow): Environment => path[0] ?? DEFAULT_FLOW.path[0];

/** The environment a version runs on before this one, or null for the first. */
export const previousOf = ({ path }: DeployFlow, environment: Environment): Environment | null =>
  path[path.indexOf(environment) - 1] ?? null;

/** Whether users are on it: its name is typed, and --yes refused. */
export const reachesUsers = ({ users }: DeployFlow, environment: Environment) =>
  users === environment;

/** The keys a unit file writes a value per environment under: both defaults when it has only one. */
export const keysOf = ({ path }: DeployFlow): readonly Environment[] =>
  path.every((name) => DEFAULT_FLOW.path.some((known) => known === name))
    ? DEFAULT_FLOW.path
    : path;

/** A name at the start of a sentence: `Preview`. */
export const capitalized = (name: string) => `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
