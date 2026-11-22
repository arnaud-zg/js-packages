import type { ServiceAdapter, Shell, SourceControlPort } from "shiplane/plugin";
import { commandFailed, mustCapture, retrying } from "shiplane/plugin";

export interface GitOptions {
  /** The branch releases start from; origin's default branch, main or master, when absent. */
  main?: string;
  /** Run on the files of a commit before it is made, such as a formatter. */
  format?: string[];
  /** How long to wait before each new try of a push the network dropped, in ms. */
  retryDelays?: number[];
}

// The network let go; a rejection or a missing right fails the same way on every try.
const DROPPED =
  /closed by remote host|connection (reset|refused|timed out)|could not resolve host|operation timed out|early eof|rpc failed|remote end hung up|unexpected disconnect|broken pipe|kex_exchange_identification/i;

// What a release pushes is versions, changelogs and tags of code main already checked. The
// pre-push checks would redo minutes of work with the connection open, until GitHub drops it.
const PUSH = ["push", "--no-verify", "--quiet"];

const gitSource = ({
  root,
  shell,
  options,
}: {
  root: string;
  shell: Shell;
  options: GitOptions;
}): SourceControlPort => {
  const run = (args: string[]) => shell.capture("git", args, { cwd: root });
  const must = async (args: string[]) =>
    (await mustCapture({ shell, command: "git", args, cwd: root })).trim();
  const network = async (args: string[]) => {
    const result = await retrying({
      run: () => run(args),
      retryable: ({ status, stderr }) => status !== 0 && DROPPED.test(stderr),
      delays: options.retryDelays ?? [2_000, 10_000],
    });
    if (result.status !== 0) throw commandFailed({ label: `git ${args[0] ?? ""}`, result });
  };
  const maybe = async (args: string[]) => {
    const result = await run(args);
    return result.status === 0 ? result.stdout.trim() : null;
  };
  const lines = (text: string | null) => (text ?? "").split("\n").filter(Boolean);
  const exists = async (ref: string) =>
    (await maybe(["rev-parse", "--verify", "--quiet", ref])) !== null;
  const detected = async () => {
    // A clone knows origin's default; a repository made with `git init` and a remote may not.
    const head = await maybe(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
    if (head) return head.replace(/^origin\//, "");
    for (const name of ["main", "master"]) {
      if ((await exists(`refs/heads/${name}`)) || (await exists(`refs/remotes/origin/${name}`))) {
        return name;
      }
    }
    return "main";
  };
  // Read once per port: every unit a run looks at asks for it.
  let known: Promise<string> | null = null;
  const defaultBranch = () => (known ??= options.main ? Promise.resolve(options.main) : detected());

  return {
    defaultBranch,
    position: async () => {
      const main = await defaultBranch();
      // Offline, the last fetched origin/<default> still says whether it moved.
      await run(["fetch", "--quiet", "origin", main]);
      return {
        branch: await must(["rev-parse", "--abbrev-ref", "HEAD"]),
        head: await must(["rev-parse", "HEAD"]),
        originMain: await must(["rev-parse", `origin/${main}`]),
      };
    },
    isClean: async () => (await must(["status", "--porcelain", "--untracked-files=no"])) === "",
    tagCommit: (tag) => maybe(["rev-parse", "--verify", "--quiet", `${tag}^{commit}`]),
    versionCommit: async (dir, manifest, version) => {
      const found = await maybe([
        "log",
        "-1",
        "--format=%H%x00%s",
        "-S",
        `"version": "${version}"`,
        "--",
        `${dir}/${manifest}`,
      ]);
      const [sha = "", subject = ""] = (found ?? "").split("\0");
      return sha ? { sha, subject } : null;
    },
    commitsBetween: async (from, to) =>
      (await must(["log", "--format=%x00%s", "--name-only", `${from}..${to}`]))
        .split("\0")
        .filter(Boolean)
        .map((entry) => {
          const [subject = "", ...files] = lines(entry);
          return { subject, files };
        }),
    changedFiles: async () => [
      ...lines(await maybe(["diff", "--name-only"])),
      ...lines(await maybe(["ls-files", "--others", "--exclude-standard"])),
    ],
    diffNames: async (from, to) => lines(await maybe(["diff", "--name-only", from, to])),
    mergeBase: (a, b) => maybe(["merge-base", a, b]),
    fileAt: (ref, file) => maybe(["show", `${ref}:${file}`]),
    tags: async () => {
      // Offline, the tags fetched last still say what is tagged.
      await run(["fetch", "--quiet", "--tags", "origin"]);
      return new Set(lines(await maybe(["tag", "--list"])));
    },
    ignoredFiles: async (patterns) =>
      lines(
        await maybe([
          "ls-files",
          "--others",
          "--ignored",
          "--exclude-standard",
          "--",
          ...patterns.map((pattern) => `:(glob)${pattern}`),
        ]),
      ),
    addWorktree: async (dir, ref) => {
      await must(["worktree", "add", "--quiet", "--detach", dir, ref]);
    },
    removeWorktree: async (dir) => {
      await must(["worktree", "remove", "--force", dir]);
    },
    createBranch: async (name) => {
      await must(["switch", "--quiet", "-c", name]);
    },
    switchTo: async (branch) => {
      await must(["switch", "--quiet", branch]);
    },
    commit: async (files, title, body, { skipHooks = false } = {}) => {
      const [command, ...args] = options.format ?? [];
      if (command && files.length > 0) {
        await shell.capture(command, [...args, ...files], { cwd: root });
      }
      await must(["add", "--", ...files]);
      await must([
        "commit",
        "--quiet",
        ...(skipHooks ? ["--no-verify"] : []),
        "-m",
        title,
        ...(body ? ["-m", body] : []),
      ]);
    },
    push: async (branch) => {
      await network([...PUSH, "-u", "origin", branch]);
    },
    pull: async () => {
      await network(["pull", "--quiet", "--ff-only"]);
    },
    tag: async (name, sha, message) => {
      // GitHub shows an unsigned tag as Unverified even when the commit it names is signed.
      const signed = (await maybe(["config", "--type=bool", "--get", "commit.gpgsign"])) === "true";
      await must(["tag", signed ? "-s" : "-a", name, sha, "-m", message]);
    },
    pushTags: async (names) => {
      await network([...PUSH, "origin", ...names.map((name) => `refs/tags/${name}`)]);
    },
    discard: async (files) => {
      await must(["reset", "--quiet", "--hard", "HEAD"]);
      if (files.length > 0) await must(["clean", "--quiet", "--force", "--", ...files]);
    },
    deleteBranch: async (name) => {
      await must(["branch", "--quiet", "-D", name]);
    },
    deleteRemoteBranch: async (branch) => {
      await network([...PUSH, "origin", "--delete", branch]);
    },
    deleteTag: async (name) => {
      await must(["tag", "--delete", name]);
    },
  };
};

export type GitSourceControlAdapter = ServiceAdapter<SourceControlPort>;

/** The repository through the git CLI. */
export const gitSourceControl = (options: GitOptions = {}): GitSourceControlAdapter => ({
  name: "git",
  options,
  requirements: () => [{ label: "git", check: { command: "git", args: ["--version"] } }],
  create: ({ root, shell }) => gitSource({ root, shell, options }),
});
