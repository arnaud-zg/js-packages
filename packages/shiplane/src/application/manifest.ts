import path from "node:path";
import { z } from "zod";

import type { Files } from "../ports/files.port";

const Strings = z.record(z.string(), z.string());

// A field npm would not write reads as absent, as a missing one does.
const lenient = <Schema extends z.ZodType>(schema: Schema) => schema.optional().catch(undefined);

const Fields = z.object({
  name: lenient(z.string()),
  version: lenient(z.string()),
  scripts: lenient(Strings),
  dependencies: lenient(Strings),
  devDependencies: lenient(Strings),
});

/** A package.json: the fields shiplane reads, every other one kept as written, in its order. */
export const PackageJsonSchema = z
  .record(z.string(), z.unknown())
  .transform((json) => ({ ...json, ...Fields.parse(json) }));

export type PackageJson = z.infer<typeof PackageJsonSchema>;

/** A folder's package.json, or null when it has none or holds no object. */
export const readManifest = ({
  files,
  dir,
}: {
  files: Pick<Files, "read">;
  dir: string;
}): PackageJson | null => {
  const text = files.read(path.posix.join(dir, "package.json"));
  if (text === null) return null;
  return PackageJsonSchema.safeParse(JSON.parse(text)).data ?? null;
};
