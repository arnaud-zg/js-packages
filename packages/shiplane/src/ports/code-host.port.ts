import type { DeployState } from "../domain/deploys";
import type { Environment } from "../domain/environment";
import type { IssueRef, LinkedPr } from "../domain/issues";
import type { MergeMethod, MergeMethods, OpenPr } from "../domain/releasePr";

export interface Deploy {
  /** The run title every deploy records: `Deploy <tag> to <environment>`. */
  title: string;
  state: DeployState;
}

/** Where pull requests, comments, release notes and deploy records live. */
export interface CodeHostPort {
  /** What a person calls this host, such as `GitHub`; `the code host` when unset. */
  readonly label?: string;
  /** The command that closes a pull request, as a person would type it. */
  closeLine?: (pr: OpenPr) => string;
  /** Open pull requests whose branch starts with the prefix, oldest first. */
  openPrsFrom: (branchPrefix: string) => Promise<OpenPr[]>;
  createPr: (pr: {
    base: string;
    head: string;
    title: string;
    body: string;
    label: string;
  }) => Promise<OpenPr>;
  prState: (pr: OpenPr) => Promise<"OPEN" | "MERGED" | "CLOSED">;
  closePr: (pr: OpenPr, comment: string) => Promise<void>;
  mergeMethods: () => Promise<MergeMethods>;
  merge: (pr: OpenPr, method: MergeMethod) => Promise<void>;
  showDiff: (pr: OpenPr) => Promise<void>;
  openInBrowser: (pr: OpenPr) => Promise<void>;
  /** Tags that already have release notes. */
  releasedTags: () => Promise<Set<string>>;
  /** Publishes a tag's notes; with the tag before it, they end on a link comparing the two. */
  createRelease: (tag: string, notes: string, latest: boolean, previous?: string) => Promise<void>;
  /** Every deploy recorded for a tag, by a workflow or by this machine. */
  deployments: (environments: readonly Environment[]) => Promise<Deploy[]>;
  recordDeployment: (ref: string, environment: Environment) => Promise<void>;
  /** Each pull request's body and the issues it closes, in the order asked, read in one go. */
  pullRequests: (numbers: readonly number[]) => Promise<LinkedPr[]>;
  /** The recent comments of each issue or pull request, in the order asked, read in one go. */
  comments: (on: readonly IssueRef[]) => Promise<string[][]>;
  /** Posts a comment on an issue or a pull request, paced so a burst stays under the host's limits. */
  comment: (on: IssueRef, body: string) => Promise<void>;
  /** The open pull request whose head is this branch, or null when it has none. */
  prForBranch: (branch: string) => Promise<OpenPr | null>;
  /** Edits the pull request's comment holding `marker`, or posts `body` when none does. */
  upsertComment: (comment: { on: OpenPr; marker: string; body: string }) => Promise<void>;
}
