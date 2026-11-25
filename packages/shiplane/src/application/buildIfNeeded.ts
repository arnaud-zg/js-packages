import path from "node:path";

import type { ReleaseUnit } from "../domain/unit";
import type { Job } from "../ports/delivery.port";
import type { ReleaseContext } from "./context";
import type { PackageJson } from "./manifest";
import { buildCommandOf } from "./buildCommand";
import { readManifest } from "./manifest";
import { paint } from "./say";

type Folder = Pick<ReleaseUnit, "dir" | "buildCommand">;

/** Folders no build reads its sources from. */
const NOT_SOURCES = new Set(["node_modules", ".git", ".turbo", ".cache"]);

/** Fields whose paths are files a package publishes. */
const ENTRY_FIELDS = ["main", "module", "types", "typings", "bin", "exports"];

/** Every path a manifest field holds, at any depth; a `*` pattern names no one file. */
const pathsIn = (value: unknown): string[] => {
  if (typeof value === "string") return value.includes("*") ? [] : [value];
  return typeof value === "object" && value !== null ? Object.values(value).flatMap(pathsIn) : [];
};

/** The files a package.json says it publishes; its `publishConfig` replaces a field, as pnpm does. */
const entriesOf = (dir: string, manifest: PackageJson | null) => {
  const fields: Record<string, unknown> = { ...manifest };
  const { publishConfig } = fields;
  const published: Record<string, unknown> =
    typeof publishConfig === "object" && publishConfig !== null ? { ...publishConfig } : {};
  const paths = ENTRY_FIELDS.flatMap((field) => pathsIn(published[field] ?? fields[field]));
  return [...new Set(paths.map((entry) => path.posix.join(dir, entry)))];
};

/** What a folder builds, as its manifest and git say it: an entry git ignores is built. */
const builtFiles = async ({ files, services }: ReleaseContext, dir: string) => {
  const entries = entriesOf(dir, readManifest({ files, dir }));
  const there = entries.filter((file) => files.exists(file));
  return {
    missing: entries.filter((file) => !files.exists(file)),
    // Git reads no path as every path.
    built: there.length === 0 ? [] : await services.sourceControl.ignoredFiles(there),
  };
};

/** What a folder's build writes: a built entry's top folder, or the entry itself beside the manifest. */
const outputsOf = (dir: string, entries: readonly string[]) =>
  new Set(
    entries.map((file) => {
      const [first = ""] = path.posix.relative(dir, file).split("/");
      return path.posix.join(dir, first);
    }),
  );

/** When the newest file under a folder changed, its subfolders included; `skip` leaves paths out. */
const newestIn = (
  { files }: Pick<ReleaseContext, "files">,
  dir: string,
  skip: ReadonlySet<string> = new Set(),
): number => {
  const subfolders = new Set(files.folders(dir));
  return Math.max(
    0,
    ...files.list(dir).map((name) => {
      const at = path.posix.join(dir, name);
      if (NOT_SOURCES.has(name) || skip.has(at)) return 0;
      const changed = files.modifiedAt(at) ?? 0;
      // A folder's own time moves when a file in it is removed or renamed.
      return subfolders.has(name) ? Math.max(changed, newestIn({ files }, at, skip)) : changed;
    }),
  );
};

/** When a file at the root, such as the lockfile or a shared tsconfig, last changed. */
const newestAtRoot = ({ files }: ReleaseContext) => {
  const folders = new Set(files.folders("."));
  const times = files
    .list(".")
    .filter((name) => !folders.has(name))
    .map((name) => files.modifiedAt(name) ?? 0);
  return Math.max(0, ...times);
};

/** The workspace packages a folder builds with, development ones too: a bundler may inline them. */
const workspaceDependencies = async (
  { files, services, release }: ReleaseContext,
  dir: string,
): Promise<Folder[]> => {
  const folders = await services.versioning.folders();
  const manifest = readManifest({ files, dir });
  const names = Object.keys({ ...manifest?.dependencies, ...manifest?.devDependencies });
  return names.flatMap((name) => {
    const folder = folders[name];
    if (folder === undefined) return [];
    return [release.units.find((unit) => unit.dir === folder) ?? { dir: folder }];
  });
};

/** Why a folder has to build, or null when what it built is newer than all it is built from. */
const whyBuild = async (
  context: ReleaseContext,
  { dir, changed }: { dir: string; changed: number },
): Promise<string | null> => {
  const { missing, built } = await builtFiles(context, dir);
  const [first] = missing;
  if (first) return `${first} is missing`;
  if (built.length === 0) return "its package.json names no built file to check";
  const oldest = Math.min(...built.map((file) => context.files.modifiedAt(file) ?? 0));
  const sources = newestIn(context, dir, outputsOf(dir, built));
  return Math.max(sources, changed) > oldest ? "its sources are newer than its build" : null;
};

/** One build command, run in a folder; throws when it fails. */
type RunBuild = (
  command: NonNullable<ReturnType<typeof buildCommandOf>>,
  dir: string,
) => Promise<void>;

const inTerminal =
  ({ shell, release }: ReleaseContext): RunBuild =>
  async ({ command, args, shown }, dir) => {
    const status = await shell.attach(command, args, { cwd: path.join(release.root, dir) });
    if (status !== 0) throw new Error(`${shown} in ${dir} exited with ${status}`);
  };

interface Building {
  folder: Folder;
  /** Folders already looked at: each is built once. */
  seen: Set<string>;
  /** Folders built even when their build looks current. */
  always?: ReadonlySet<string>;
  run: RunBuild;
}

/** Builds a folder, the workspace packages it uses first; when anything it is built from changed. */
export const build = async (
  context: ReleaseContext,
  { folder, seen, always, run }: Building,
): Promise<number> => {
  const { files, output } = context;
  const { dir } = folder;
  if (seen.has(dir)) return newestIn(context, dir);
  seen.add(dir);
  let changed = newestAtRoot(context);
  for (const dependency of await workspaceDependencies(context, dir)) {
    changed = Math.max(changed, await build(context, { folder: dependency, seen, always, run }));
  }
  const command = buildCommandOf({ files }, folder);
  if (command) {
    const why = always?.has(dir) ? "picked" : await whyBuild(context, { dir, changed });
    if (why === null) {
      output.line(`  ${paint("dim", `· ${dir}: build up to date`)}`);
    } else {
      output.line(`  ${paint("dim", `· ${dir}: ${why}, running ${command.shown}`)}`);
      await run(command, dir);
    }
  }
  // What depends on it is built from its sources, its build, and all it is built from.
  return Math.max(changed, newestIn(context, dir));
};

/** Whether a job publishes what this checkout built: one run from a tag's worktree does not. */
const publishesBuild = ({ needsBuild, from }: Job) => needsBuild === true && from === undefined;

/** The build a unit's jobs need when the config has no `prepare`; null when there is none. */
export const neededBuild = (context: ReleaseContext, unit: ReleaseUnit, jobs: readonly Job[]) => {
  if (context.release.prepare !== undefined || !jobs.some(publishesBuild)) return null;
  return buildCommandOf(context, unit);
};

/**
 * Builds a unit when its build is missing or older than its sources, the workspace packages it uses
 * first, as a step run right before its jobs; null when nothing needs one.
 */
export const buildingIfNeeded = (
  context: ReleaseContext,
  { unit, tag, jobs }: { unit: ReleaseUnit; tag: string; jobs: readonly Job[] },
) => {
  if (neededBuild(context, unit, jobs) === null) return null;
  return {
    label: `build ${tag} if needed`,
    run: async () => {
      await build(context, { folder: unit, seen: new Set(), run: inTerminal(context) });
    },
  };
};
