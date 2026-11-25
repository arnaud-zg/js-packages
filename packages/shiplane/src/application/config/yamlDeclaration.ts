import { z } from "zod";

import type { Adapter } from "../../ports/adapter.port";
import type { CatalogEntry, MadeSlots, SlotPort } from "../../ports/catalog.port";
import { comments } from "../../domain/branchRelease";
import { testReleases } from "../../domain/testChannel";
import { ConfigError } from "../../ports/config.port";
import { isRecord } from "./values";

type Path = readonly (string | number)[];

/** The YAML config setup and migrate write. */
export const YAML_CONFIG_FILE = "shiplane.yml";

/** The names a YAML config takes; the first one found is read. */
export const YAML_CONFIG_FILES = [YAML_CONFIG_FILE, "shiplane.yaml"];

/** The flow's ports, in the order a config writes them. */
export const FLOW_SLOTS = ["sourceControl", "codeHost", "ciPipeline", "versioning"] as const;

type FlowAdapters = Readonly<Record<(typeof FLOW_SLOTS)[number], Adapter<unknown>>>;

/** Every key a shiplane.yml holds at its top; each one but `flow` and `modules` is optional. */
export const TOP_KEYS = [
  "flow",
  "modules",
  "features",
  "units",
  "tag",
  "via",
  "environments",
  "channels",
  "display",
  "testComment",
  "testRelease",
  "prepare",
] as const;

/** A local adapter, module or feature: `use: ./shiplane/adapters/my-host.ts`. */
export const isLocal = (use: string) =>
  (use.startsWith("./") || use.startsWith("../")) && /\.(ts|mts|js|mjs)$/.test(use);

/** A port the flow fills: a slot of it may be left out, and takes the flow's adapter. */
export const isFlowPort = (port: SlotPort): port is (typeof FLOW_SLOTS)[number] =>
  (FLOW_SLOTS as readonly string[]).includes(port);

const isAdapter = (value: unknown): value is Adapter<unknown> =>
  isRecord(value) && typeof value.name === "string" && typeof value.create === "function";

const listed = (names: readonly string[]) => names.join(", ") || "none installed";

/** What a slot or a list item says: the entry it names and what goes in `with`. */
const named = (
  value: unknown,
  path: Path,
  what: string,
): { use: string; with: Record<string, unknown>; at: Path } => {
  if (typeof value === "string") return { use: value, with: {}, at: path };
  if (!isRecord(value) || typeof value.use !== "string") {
    throw new ConfigError(`${what} is a name, or use: with with:`, {
      path,
      hint: `such as ${what}: <name>, or use: <name> with with: { <option>: <value> }`,
    });
  }
  const extra = Object.keys(value).filter((key) => key !== "use" && key !== "with");
  if (extra.length > 0) {
    throw new ConfigError(`${what} takes use and with, not ${extra.join(", ")}`, {
      path: [...path, extra[0] ?? ""],
      hint: "move it under with:",
    });
  }
  if (value.with !== undefined && !isRecord(value.with)) {
    throw new ConfigError(`with is a map of options`, { path: [...path, "with"] });
  }
  return { use: value.use, with: value.with ?? {}, at: [...path, "use"] };
};

/** A zod problem as one sentence, its path inside `with`. */
const zodProblem = (error: unknown, path: Path): ConfigError | null => {
  if (!(error instanceof z.ZodError)) return null;
  const [issue] = error.issues;
  const key = issue?.path.join(".") ?? "";
  return new ConfigError(`${key ? `${key}: ` : ""}${issue?.message ?? "not a valid option"}`, {
    path: [...path, ...(issue?.path.filter((part) => typeof part !== "symbol") ?? [])],
  });
};

/**
 * Turns a parsed shiplane.yml into what a shiplane.config.ts declares: the flow, modules and
 * features made from the catalog by name, the rest as written. `loadRelease` checks the result as
 * it checks a TS config's. Throws a ConfigError with the path to the first wrong value.
 */
export const yamlDeclaration = (
  document: unknown,
  catalog: readonly CatalogEntry[],
): Record<string, unknown> => {
  if (!isRecord(document)) {
    throw new ConfigError("shiplane.yml is a map of keys, such as flow: and modules:", {
      hint: "shiplane setup --format yaml writes one",
    });
  }
  const unknown = Object.keys(document).find(
    (key) => !(TOP_KEYS as readonly string[]).includes(key),
  );
  if (unknown !== undefined) {
    throw new ConfigError(`${unknown} is not a key of shiplane.yml`, {
      path: [unknown],
      hint: `the keys are ${TOP_KEYS.join(", ")}`,
    });
  }

  const entryFor = (
    use: string,
    kind: CatalogEntry["kind"],
    port: SlotPort | undefined,
    at: Path,
  ) => {
    const fits = catalog.filter((entry) => entry.kind === kind && entry.port === port);
    const found = fits.find((entry) => entry.name === use);
    if (found) return found;
    const what = kind === "adapter" ? `${port ?? ""} adapter` : kind;
    throw new ConfigError(`no ${what} named "${use}"`, {
      path: at,
      hint: isLocal(use)
        ? `${use} exports no ${what} in its catalog`
        : `name one of: ${listed(fits.map(({ name }) => name))}; a plugin installed adds its own`,
    });
  };

  // Makes what an entry names: its slots first, each an adapter of the slot's port, or the flow's.
  const make = (
    entry: CatalogEntry,
    options: Record<string, unknown>,
    path: Path,
    flow: FlowAdapters | null,
  ): unknown => {
    const slots: Record<string, Adapter<unknown>> = {};
    const plain: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(options)) {
      const slot = entry.slots[key];
      if (slot) slots[key] = adapterAt(value, slot.port, [...path, key]);
      else plain[key] = value;
    }
    for (const [key, { port }] of Object.entries(entry.slots)) {
      const own = flow && isFlowPort(port) ? flow[port] : undefined;
      if (!(key in slots) && own) slots[key] = own;
    }
    const missing = Object.entries(entry.slots).find(([key]) => !(key in slots));
    if (missing) {
      throw new ConfigError(
        `${entry.name} needs ${missing[0]}: the ${missing[1].port} adapter it ships with`,
        {
          path,
          hint: `such as with: { ${missing[0]}: <name> }`,
        },
      );
    }
    const unknownKey = Object.keys(plain).find((key) => !(key in entry.options.shape));
    if (unknownKey !== undefined) {
      const keys = [...Object.keys(entry.options.shape), ...Object.keys(entry.slots)];
      throw new ConfigError(`${entry.name} takes no ${unknownKey}`, {
        path: [...path, unknownKey],
        hint: keys.length > 0 ? `it takes ${keys.join(", ")}` : "it takes no options",
      });
    }
    try {
      return entry.make(plain, slots satisfies MadeSlots);
    } catch (error) {
      throw zodProblem(error, path) ?? error;
    }
  };

  const adapterAt = (value: unknown, port: SlotPort, path: Path): Adapter<unknown> => {
    const { use, with: options, at } = named(value, path, `${port}`);
    const entry = entryFor(use, "adapter", port, at);
    const made = make(entry, options, [...path, "with"], null);
    if (!isAdapter(made)) throw new ConfigError(`${use} made no adapter`, { path: at });
    return made;
  };

  if (document.flow === undefined) {
    throw new ConfigError("flow is missing: an adapter per port the release runs on", {
      hint: "such as flow: { sourceControl: git, codeHost: github, ciPipeline: github-actions, versioning: changesets }",
    });
  }
  const flow = makeFlow(document.flow, adapterAt) ?? null;
  const listOf = (key: "modules" | "features", kind: "module" | "feature") => {
    const value = document[key];
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) {
      throw new ConfigError(`${key} is a list`, {
        path: [key],
        hint: `such as ${key}:\n  - internal-tool`,
      });
    }
    return value.map((item: unknown, index) => {
      const { use, with: options, at } = named(item, [key, index], `${kind}`);
      return make(entryFor(use, kind, undefined, at), options, [key, index, "with"], flow);
    });
  };

  // The keys written as values pass as they are; the flow, modules and features are made.
  return {
    ...document,
    flow,
    ...(document.modules === undefined ? {} : { modules: listOf("modules", "module") }),
    ...(document.features === undefined ? {} : { features: listOf("features", "feature") }),
    ...presetsOf(document),
  };
};

const makeFlow = (
  value: unknown,
  adapterAt: (value: unknown, port: SlotPort, path: Path) => Adapter<unknown>,
): (FlowAdapters & { type: "flow"; approval: string }) | undefined => {
  if (value === undefined) return undefined;
  if (!isRecord(value))
    throw new ConfigError("flow is a map of an adapter per port", { path: ["flow"] });
  const keys = [...FLOW_SLOTS, "approval"];
  const unknown = Object.keys(value).find((key) => !keys.includes(key));
  if (unknown !== undefined) {
    throw new ConfigError(`flow takes no ${unknown}`, {
      path: ["flow", unknown],
      hint: `it takes ${keys.join(", ")}`,
    });
  }
  const missing = FLOW_SLOTS.find((port) => value[port] === undefined);
  if (missing) {
    throw new ConfigError(`flow needs ${missing}`, {
      path: ["flow"],
      hint: "such as sourceControl: git, codeHost: github, ciPipeline: github-actions, versioning: changesets",
    });
  }
  const approval = value.approval ?? "none";
  if (approval !== "none" && approval !== "required") {
    throw new ConfigError('approval is "none" or "required"', { path: ["flow", "approval"] });
  }
  const at = (port: (typeof FLOW_SLOTS)[number]) => adapterAt(value[port], port, ["flow", port]);
  // The same shape releaseFlow() gives; loadRelease checks it as it checks a TS config's.
  return {
    type: "flow",
    sourceControl: at("sourceControl"),
    codeHost: at("codeHost"),
    ciPipeline: at("ciPipeline"),
    versioning: at("versioning"),
    approval,
  };
};

const COMMENTS = new Map<string, string>(Object.entries(comments));
const TEST_RELEASES = new Map<string, unknown>(Object.entries(testReleases));

/** `testComment: compact` and `testRelease: gitflow` name the presets a TS config imports. */
const presetsOf = (document: Record<string, unknown>) => {
  const { testComment, testRelease } = document;
  return {
    ...(typeof testComment === "string"
      ? { testComment: COMMENTS.get(testComment) ?? testComment }
      : {}),
    ...(typeof testRelease === "string"
      ? (() => {
          const preset = TEST_RELEASES.get(testRelease);
          if (preset === undefined) {
            throw new ConfigError(`no testRelease preset named "${testRelease}"`, {
              path: ["testRelease"],
              hint: `name one of: ${[...TEST_RELEASES.keys()].join(", ")}, or map each branch to a channel`,
            });
          }
          return { testRelease: preset };
        })()
      : {}),
  };
};
