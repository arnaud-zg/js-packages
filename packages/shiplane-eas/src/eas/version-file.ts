import fs from "node:fs";
import path from "node:path";
import type { Environment, ReleaseUnit } from "shiplane/plugin";
import { parseJson, z } from "shiplane/plugin";

import type { Options } from "./options";

const VersionsSchema = z.record(z.string(), z.object({ version: z.string() }).loose());

const readJson = (file: string): Record<string, unknown> =>
  z.record(z.string(), z.unknown()).parse(JSON.parse(fs.readFileSync(file, "utf8")));

const writeJson = (file: string, value: unknown) =>
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

interface VersionFile {
  root: string;
  unit: ReleaseUnit;
  options: Options;
}

/** The file holding each environment's binary version. */
const versionFileOf = ({ root, unit, options }: VersionFile) =>
  path.join(root, unit.dir, options.versionFile);

/** The binary version an environment carries; the app's own version when the file names none. */
export const binaryVersion = ({
  environment,
  ...file
}: VersionFile & { environment: Environment }) =>
  VersionsSchema.parse(readJson(versionFileOf(file)))[environment]?.version ?? file.unit.version;

/** Moves an environment's binary version; returns the file it wrote, relative to the root. */
export const setBinaryVersion = ({
  environment,
  version,
  ...file
}: VersionFile & { environment: Environment; version: string }) => {
  const written = versionFileOf(file);
  const versions = VersionsSchema.parse(readJson(written));
  writeJson(written, { ...versions, [environment]: { ...versions[environment], version } });
  return path.relative(file.root, written);
};

/** The binary version of an environment a version file's text names, or nothing when it names none. */
export const versionIn = (text: string | null, environment: Environment): string | undefined => {
  if (!text) return undefined;
  const parsed = parseJson({ text, schema: VersionsSchema });
  return parsed.success ? parsed.data[environment]?.version : undefined;
};
