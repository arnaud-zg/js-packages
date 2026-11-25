/** Where an app runs, as its repository names it. */
export type Environment = string;

/** An app's way to its users. */
export interface DeployFlow {
  /** The environments in promotion order: a release deploys to the first. */
  path: readonly [Environment, ...Environment[]];
  /** The one users are on: guarded. Null when nothing is promoted to them. */
  users: Environment | null;
}

/** The released packages' channel: tagged, then published under their real dist-tag. */
export const LIVE = "live";

/** A repository that deploys no app: a release is live at once, with nothing to promote. */
export const NO_APPS: DeployFlow = { path: [LIVE], users: null };

/** Where a release deploys. */
export const entryOf = ({ path }: DeployFlow): Environment => path[0];

/** The environment a version runs on before this one, or null for the first. */
export const previousOf = ({ path }: DeployFlow, environment: Environment): Environment | null =>
  path[path.indexOf(environment) - 1] ?? null;

/** Whether users are on it: its name is typed, and --yes refused. */
export const reachesUsers = ({ users }: DeployFlow, environment: Environment) =>
  users === environment;

/** A name at the start of a sentence: `Staging`. */
export const capitalized = (name: string) => `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
