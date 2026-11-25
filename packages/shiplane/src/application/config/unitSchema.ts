import { z } from "zod";

import type { Environment } from "../../domain/environment";
import type { ReleaseModule } from "../../modules/module";
import { ENV_VAR_NAME } from "../../domain/checkEnvBeforeDeploy";
import { DEFAULT_FLOW } from "../../domain/environment";

interface Inspectable {
  def: {
    type: string;
    innerType?: z.ZodType;
    defaultValue?: unknown;
    keyType?: z.ZodType;
    valueType?: z.ZodType;
    element?: z.ZodType;
    options?: z.ZodType[];
    shape?: Record<string, z.ZodType>;
  };
  description?: string;
}

// A config loads its own copy of zod, so a schema is read by its shape, never by its class.
const inspect = (schema: z.ZodType): Inspectable => schema;

const definition = (schema: z.ZodType) => inspect(schema).def;

const mapShape = (shape: Record<string, z.ZodType>, map: (schema: z.ZodType) => z.ZodType) =>
  Object.fromEntries(Object.entries(shape).map(([key, value]) => [key, map(value)]));

const DEFAULT_PATH: readonly Environment[] = DEFAULT_FLOW.path;

/** A `perEnv` map, written for the default environments, with a key for each of `path`'s instead. */
const onPath = (shape: Record<string, z.ZodType>, path: readonly Environment[]) => {
  const value = shape[DEFAULT_FLOW.path[0]];
  const perEnv =
    value !== undefined &&
    Object.keys(shape).join() === DEFAULT_PATH.join() &&
    Object.values(shape).every((schema) => schema === value);
  return perEnv ? Object.fromEntries(path.map((environment) => [environment, value])) : shape;
};

/**
 * The same schema, refusing unknown keys at every depth, its per-environment maps keyed by `path`.
 * Read through `def.type` rather than `instanceof`: a config loads its own copy of zod.
 */
export const deepStrict = (
  schema: z.ZodType,
  path: readonly Environment[] = DEFAULT_PATH,
): z.ZodType => {
  const deep = (inner: z.ZodType) => deepStrict(inner, path);
  const def = definition(schema);
  const strict = (): z.ZodType => {
    switch (def.type) {
      case "object":
        return z.strictObject(mapShape(onPath(def.shape ?? {}, path), deep));
      case "optional":
        return def.innerType ? deep(def.innerType).optional() : schema;
      case "nullable":
        return def.innerType ? deep(def.innerType).nullable() : schema;
      case "default":
        return def.innerType ? deep(def.innerType).default(def.defaultValue) : schema;
      case "union":
        return z.union((def.options ?? []).map(deep));
      case "record":
        return def.keyType && def.valueType
          ? z.record(def.keyType as z.ZodString, deep(def.valueType))
          : schema;
      case "array":
        return def.element ? z.array(deep(def.element)) : schema;
      default:
        return schema;
    }
  };
  const result = strict();
  const { description } = inspect(schema);
  return description && result !== schema ? result.describe(description) : result;
};

/** The keys an object schema allows at a path, best effort, for "did you mean". */
export const keysAt = (schema: z.ZodType, at: readonly PropertyKey[]): string[] => {
  const def = definition(schema);
  if (def.type === "optional" || def.type === "nullable" || def.type === "default") {
    return def.innerType ? keysAt(def.innerType, at) : [];
  }
  if (def.type === "union") return (def.options ?? []).flatMap((option) => keysAt(option, at));
  if (def.type === "record" && at.length > 0 && def.valueType) {
    return keysAt(def.valueType, at.slice(1));
  }
  if (def.type !== "object") return [];
  const [first, ...rest] = at;
  if (first === undefined) return Object.keys(def.shape ?? {});
  const child = def.shape?.[String(first)];
  return child ? keysAt(child, rest) : [];
};

const envVarNames = z
  .array(z.string().regex(ENV_VAR_NAME, "an env var name is UPPER_SNAKE, like SENTRY_DSN"))
  .describe("Env var names, one per line");

const onlyOn = (environment: Environment) =>
  envVarNames.optional().describe(`Checked on ${environment} only, on top of all`);

const environmentLists = (path: readonly Environment[]) =>
  Object.fromEntries(path.map((environment) => [environment, onlyOn(environment)]));

/** One list for every environment, or `all` plus a list per environment. */
export const checkEnvBeforeDeploySchema = (path: readonly Environment[] = DEFAULT_PATH) =>
  z
    .union([
      envVarNames,
      z.strictObject({
        all: envVarNames.optional().describe("Checked on every environment, current and future"),
        ...environmentLists(path),
      }),
    ])
    .describe(
      "Before each deploy, shiplane checks these env var names are set on the platform; you set the values",
    );

/** What a unit file naming this module may hold: `module`, then its adapter's settings. */
export const unitSchema = (module: ReleaseModule, path: readonly Environment[] = DEFAULT_PATH) =>
  z.strictObject({
    module: z
      .literal(module.name)
      .describe(`The module that ships this app, with ${module.provider}`),
    buildCommand: z
      .string()
      .optional()
      .describe('How to build this app, when its package.json has no "build" script'),
    checkEnvBeforeDeploy: checkEnvBeforeDeploySchema(path).optional(),
    ...mapShape(module.settings.shape, (schema) => deepStrict(schema, path)),
  });

/** The JSON Schema editors read for `shiplane.unit.yml`: the module an app names picks its keys. */
/** A module's settings with their per-environment maps keyed by `path`, unknown keys kept as it says. */
export const settingsOn = (
  settings: z.ZodObject,
  path: readonly Environment[] = DEFAULT_PATH,
): z.ZodType<Record<string, unknown>> =>
  path.join() === DEFAULT_PATH.join()
    ? settings
    : z.object(mapShape(settings.shape, (schema) => deepStrict(schema, path)));

export const unitJsonSchema = (
  modules: readonly ReleaseModule[],
  path: readonly Environment[] = DEFAULT_PATH,
) =>
  z.toJSONSchema(z.union(modules.map((module) => unitSchema(module, path))), {
    io: "input",
    unrepresentable: "any",
  });
