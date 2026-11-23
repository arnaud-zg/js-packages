import type { ReleaseUnit } from "../domain/unit";
import type { Files } from "../ports/files.port";
import { readManifest } from "./manifest";

/** The package manager this repository runs scripts with. */
export const runner = ({ files }: { files: Pick<Files, "exists"> }) =>
  files.exists("pnpm-lock.yaml")
    ? "pnpm"
    : files.exists("yarn.lock")
      ? "yarn"
      : files.exists("bun.lock") || files.exists("bun.lockb")
        ? "bun"
        : "npm";

/** How a folder builds: its `buildCommand:`, else its package.json "build" script, else nothing. */
export const buildCommandOf = (
  context: { files: Pick<Files, "exists" | "read"> },
  { dir, buildCommand }: Pick<ReleaseUnit, "dir" | "buildCommand">,
) => {
  if (buildCommand) return { command: "sh", args: ["-c", buildCommand], shown: buildCommand };
  if (!readManifest({ files: context.files, dir })?.scripts?.build) return null;
  const pm = runner(context);
  return { command: pm, args: ["run", "build"], shown: `${pm} run build` };
};
