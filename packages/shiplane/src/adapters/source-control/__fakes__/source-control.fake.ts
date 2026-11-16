import type { GitPosition } from "../../../domain/governance";
import type { ServiceAdapter } from "../../../ports/adapter.port";
import type { SourceControlPort } from "../../../ports/source-control.port";

interface SourceState {
  position: GitPosition;
  /** The branch releases start from. */
  defaultBranch: string;
  clean: boolean;
  /** Tag name → the commit it points at. */
  tags: Record<string, string>;
  /** `<dir>@<version>` → the commit that brought that version. */
  versionCommits: Record<string, { sha: string; subject: string }>;
  /** `<ref>:<file>` → its text at that ref. */
  files: Record<string, string>;
  /** `<from>..<to>` → the files that differ. */
  diffs: Record<string, string[]>;
  /** `<a>...<b>` → the commit they share; unseeded, `a`, as a branch that left it and it never moved. */
  mergeBases: Record<string, string>;
  /** `<from>..<to>` → the commits after `from` up to `to`, newest first. */
  commits: Record<string, { subject: string; files: string[] }[]>;
  changed: string[];
  /** Untracked files git ignores, relative to the root. */
  ignored: string[];
}

export type SourceEvent =
  | { type: "branch"; name: string }
  | { type: "switch"; branch: string }
  | { type: "commit"; files: string[]; title: string; body?: string }
  | { type: "push"; branch: string }
  | { type: "pull" }
  | { type: "tag"; name: string; sha: string; message: string }
  | { type: "push-tags"; names: string[] }
  | { type: "discard"; files: string[] }
  | { type: "delete-branch"; name: string }
  | { type: "delete-remote"; branch: string }
  | { type: "delete-tag"; name: string }
  | { type: "worktree-add"; dir: string; ref: string }
  | { type: "worktree-remove"; dir: string };

/** A repository held in memory: seed what it contains, read back what it received. */
export class SourceControlFake implements SourceControlPort {
  private state: SourceState = {
    position: { branch: "main", head: "head", originMain: "head" },
    defaultBranch: "main",
    clean: true,
    tags: {},
    versionCommits: {},
    files: {},
    diffs: {},
    mergeBases: {},
    commits: {},
    changed: [],
    ignored: [],
  };

  readonly received: SourceEvent[] = [];
  private failures: { type: SourceEvent["type"]; nth: number; error: Error }[] = [];

  seed(state: Partial<SourceState>) {
    this.state = { ...this.state, ...state };
    return this;
  }

  /** The `nth` call of this kind throws `error`, after it is recorded. */
  failAt(type: SourceEvent["type"], nth: number, error: Error) {
    this.failures.push({ type, nth, error });
    return this;
  }

  private record(event: SourceEvent) {
    this.received.push(event);
    const count = this.received.filter(({ type }) => type === event.type).length;
    const failure = this.failures.find(({ type, nth }) => type === event.type && nth === count);
    return failure ? Promise.reject(failure.error) : Promise.resolve();
  }

  position = () => Promise.resolve(this.state.position);
  defaultBranch = () => Promise.resolve(this.state.defaultBranch);
  isClean = () => Promise.resolve(this.state.clean);
  tagCommit = (tag: string) => Promise.resolve(this.state.tags[tag] ?? null);
  versionCommit = (dir: string, _manifest: string, version: string) =>
    Promise.resolve(this.state.versionCommits[`${dir}@${version}`] ?? null);
  changedFiles = () => Promise.resolve(this.state.changed);
  diffNames = (from: string, to: string) =>
    Promise.resolve(this.state.diffs[`${from}..${to}`] ?? []);
  mergeBase = (a: string, b: string) => Promise.resolve(this.state.mergeBases[`${a}...${b}`] ?? a);
  commitsBetween = (from: string, to: string) =>
    Promise.resolve(this.state.commits[`${from}..${to}`] ?? []);
  fileAt = (ref: string, file: string) =>
    Promise.resolve(this.state.files[`${ref}:${file}`] ?? null);
  tags = () => Promise.resolve(new Set(Object.keys(this.state.tags)));
  ignoredFiles = (patterns: readonly string[]) => {
    const matchers = patterns.map(
      (pattern) =>
        new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")}$`),
    );
    return Promise.resolve(
      this.state.ignored.filter((file) => matchers.some((matcher) => matcher.test(file))),
    );
  };

  addWorktree = (dir: string, ref: string) => this.record({ type: "worktree-add", dir, ref });

  removeWorktree = (dir: string) => this.record({ type: "worktree-remove", dir });

  createBranch = async (name: string) => {
    await this.record({ type: "branch", name });
    this.state.position = { ...this.state.position, branch: name };
  };

  switchTo = async (branch: string) => {
    await this.record({ type: "switch", branch });
    this.state.position = { ...this.state.position, branch };
  };

  commit = async (
    files: string[],
    title: string,
    body?: string,
    { skipHooks = false }: { skipHooks?: boolean } = {},
  ) => {
    await this.record({ type: "commit", files, title, body, ...(skipHooks ? { skipHooks } : {}) });
    this.state.changed = this.state.changed.filter((file) => !files.includes(file));
  };

  push = (branch: string) => this.record({ type: "push", branch });

  pull = () => this.record({ type: "pull" });

  tag = async (name: string, sha: string, message: string) => {
    await this.record({ type: "tag", name, sha, message });
    this.state.tags[name] = sha;
  };

  pushTags = (names: string[]) => this.record({ type: "push-tags", names });

  discard = async (files: string[]) => {
    await this.record({ type: "discard", files });
    this.state.changed = this.state.changed.filter((file) => !files.includes(file));
  };

  deleteBranch = (name: string) => this.record({ type: "delete-branch", name });

  deleteRemoteBranch = (branch: string) => this.record({ type: "delete-remote", branch });

  deleteTag = async (name: string) => {
    await this.record({ type: "delete-tag", name });
    this.state.tags = Object.fromEntries(
      Object.entries(this.state.tags).filter(([tag]) => tag !== name),
    );
  };
}

/** The Fake as a config holds an adapter; `.fake` is what a test seeds and reads. */
export const sourceControlFake = (
  fake = new SourceControlFake(),
): ServiceAdapter<SourceControlPort> & { fake: SourceControlFake } => ({
  name: "fake",
  create: () => fake,
  fake,
});
