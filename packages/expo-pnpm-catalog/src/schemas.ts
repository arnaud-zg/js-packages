import { z } from "zod";

// YAML reads an unquoted `react: 19` as a number; pnpm treats it as the version "19".
const YamlVersionSchema = z.union([z.string(), z.number()]).transform(String);
const VersionMapSchema = z.record(z.string(), z.string());

export const WorkspaceYamlSchema = z.looseObject({
  packages: z.array(z.string()).optional(),
  catalog: z.record(z.string(), YamlVersionSchema).optional(),
  catalogs: z.record(z.string(), z.record(z.string(), YamlVersionSchema)).optional(),
});

export const PackageJsonSchema = z.looseObject({
  name: z.string().optional(),
  dependencies: VersionMapSchema.optional(),
  devDependencies: VersionMapSchema.optional(),
  expo: z
    .looseObject({
      install: z.looseObject({ exclude: z.array(z.string()).optional() }).optional(),
    })
    .optional(),
});

export type WorkspaceYaml = z.infer<typeof WorkspaceYamlSchema>;
export type PackageJson = z.infer<typeof PackageJsonSchema>;

export function parseOrThrow<Schema extends z.ZodType>({
  schema,
  value,
  source,
}: {
  schema: Schema;
  value: unknown;
  source: string;
}): z.infer<Schema> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new Error(`${source} is malformed:\n${z.prettifyError(result.error)}`);
}
