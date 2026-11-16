import fs from "node:fs";
import path from "node:path";
import type { ServiceAdapter, Shell, VersioningPort } from "shiplane/plugin";
import { isReleaseSubject, z } from "shiplane/plugin";

import type { ChangesetsOptions } from "./changesets-versioning.adapter";
import { changesetText } from "./changeset-text";
import { changesetsVersioning } from "./changesets-versioning.adapter";
import { changesetsFrom } from "./conventional";

const UNIT_FILES = ["shiplane.unit.yml", "release.unit.yml"];

const Manifest = z.object({ version: z.string() });
const Config = z.object({ ignore: z.array(z.string()).optional() });

const readJson = (file: string): unknown =>
  fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};

/** Changesets versioning fed by commits: what a person would write is written from the history. */
const commitsFiles = ({
  root,
  shell,
  options,
}: {
  root: string;
  shell: Shell;
  options: ChangesetsOptions;
}): VersioningPort => {
  const files = changesetsVersioning(options).create({ root, shell });
  const git = async (args: string[]) => {
    const { status, stdout } = await shell.capture("git", args, { cwd: root });
    return status === 0 ? stdout.trim() : "";
  };

  /** The subjects since the commit that brought a version, a release's own aside. */
  const subjectsSince = async (folder: string, version: string) => {
    const since = await git([
      "log",
      "-1",
      "--format=%H",
      "-S",
      `"version": "${version}"`,
      "--",
      path.posix.join(folder, "package.json"),
    ]);
    if (!since) return [];
    const log = await git([
      "log",
      "--format=%s",
      `${since}..HEAD`,
      "--",
      folder,
      ...UNIT_FILES.map((file) => `:(exclude)${path.posix.join(folder, file)}`),
    ]);
    return log.split("\n").filter((subject) => subject && !isReleaseSubject(subject));
  };

  /** A pending changeset naming a package takes over from its commits. */
  const fromCommits = async () => {
    const [folders, written] = await Promise.all([files.folders(), files.pending()]);
    const config = Config.safeParse(readJson(path.join(root, ".changeset", "config.json")));
    const ignored = new Set(config.success ? config.data.ignore : []);
    const packages = Object.entries(folders);
    // The root's folder holds every commit: beside other packages, it is not one of them.
    const moving = packages.filter(
      ([name, folder]) =>
        !(folder === "." && packages.length > 1) &&
        !ignored.has(name) &&
        !written.some(({ text }) => text.includes(`"${name}":`)),
    );
    const found = await Promise.all(
      moving.map(async ([name, folder]) => {
        const manifest = Manifest.safeParse(readJson(path.join(root, folder, "package.json")));
        if (!manifest.success) return [];
        const { version } = manifest.data;
        return changesetsFrom({ name, version, subjects: await subjectsSince(folder, version) });
      }),
    );
    return found.flat();
  };

  return {
    ...files,
    nextChange: "a commit in the package",
    pending: async () => [
      ...(await files.pending()),
      ...(await fromCommits()).map((changeset) => ({
        id: changeset.id,
        text: changesetText(changeset),
      })),
    ],
    plan: async (added, held, ceiling) =>
      files.plan([...(await fromCommits()), ...added], held, ceiling),
    apply: async (added, held, ceiling) => {
      const commits = await fromCommits();
      await files.apply([...commits, ...added], held, ceiling);
      // A held unit's commits are still there next time: no file keeps them.
      commits.forEach(({ id }) =>
        fs.rmSync(path.join(root, files.changesetFile(id)), { force: true }),
      );
    },
  };
};

export type CommitsVersioningAdapter = ServiceAdapter<VersioningPort>;

/**
 * Versioning from Conventional Commits, with no changeset to write: the commits since each
 * package's version become the changesets of the release, and changesets does the rest. A pending
 * changeset naming a package still takes over from its commits.
 */
export const commitsVersioning = (options: ChangesetsOptions = {}): CommitsVersioningAdapter => ({
  name: "commits",
  create: ({ root, shell }) => commitsFiles({ root, shell, options }),
});
