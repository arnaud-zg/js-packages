import type { GitPosition } from "../domain/governance";

/** The repository's history, as a release reads and writes it. */
export interface SourceControlPort {
  /** After fetching the default branch: the branch, its head and the default branch on origin. */
  position: () => Promise<GitPosition>;
  /** The branch releases start from: origin's default, else whichever of main or master exists. */
  defaultBranch: () => Promise<string>;
  /** No tracked file changed. */
  isClean: () => Promise<boolean>;
  tagCommit: (tag: string) => Promise<string | null>;
  /** The commit that brought a version into a folder's manifest. */
  versionCommit: (
    dir: string,
    manifest: string,
    version: string,
  ) => Promise<{ sha: string; subject: string } | null>;
  /** The commits after `from` up to `to`, newest first: each subject and the files it touched. */
  commitsBetween: (from: string, to: string) => Promise<{ subject: string; files: string[] }[]>;
  /** Modified and untracked files, relative to the root. */
  changedFiles: () => Promise<string[]>;
  diffNames: (from: string, to: string) => Promise<string[]>;
  /** The last commit `a` and `b` share, where a branch left the other; null when none. */
  mergeBase?: (a: string, b: string) => Promise<string | null>;
  /** Where origin holds a branch, or null when it was never pushed; unchecked when unset. */
  pushedHead?: (branch: string) => Promise<string | null>;
  fileAt: (ref: string, file: string) => Promise<string | null>;
  tags: () => Promise<Set<string>>;
  /** Untracked files git ignores that match a pattern (`*` stays in its folder), relative to the root. */
  ignoredFiles: (patterns: readonly string[]) => Promise<string[]>;
  /** Checks a ref out, detached, in a new folder outside the repository. */
  addWorktree: (dir: string, ref: string) => Promise<void>;
  /** Removes a worktree `addWorktree` made, whatever it holds. */
  removeWorktree: (dir: string) => Promise<void>;
  createBranch: (name: string) => Promise<void>;
  switchTo: (branch: string) => Promise<void>;
  /** `skipHooks` commits without the repository's hooks: a release title longer than they allow. */
  commit: (
    files: string[],
    title: string,
    body?: string,
    options?: { skipHooks?: boolean },
  ) => Promise<void>;
  push: (branch: string) => Promise<void>;
  pull: () => Promise<void>;
  tag: (name: string, sha: string, message: string) => Promise<void>;
  pushTags: (names: string[]) => Promise<void>;
  /** Puts tracked files back as committed and removes `files` this release created. */
  discard: (files: string[]) => Promise<void>;
  deleteBranch: (name: string) => Promise<void>;
  deleteRemoteBranch: (branch: string) => Promise<void>;
  deleteTag: (name: string) => Promise<void>;
}
