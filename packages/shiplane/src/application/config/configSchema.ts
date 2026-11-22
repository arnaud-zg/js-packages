import { z } from "zod";

import type { CatalogEntry, SlotPort } from "../../ports/catalog.port";
import { comments } from "../../domain/branchRelease";
import { TAG_FORMATS } from "../../domain/tags";
import { testReleases } from "../../domain/testChannel";
import { FLOW_SLOTS, isFlowPort } from "./yamlDeclaration";

type JsonSchema = Record<string, unknown>;

/** Where `shiplane schema` writes the schema an editor reads for shiplane.yml. */
export const CONFIG_SCHEMA_FILE = "node_modules/.cache/shiplane/shiplane.schema.json";

/** The first line of a shiplane.yml that points an editor at the schema. */
export const SCHEMA_MODELINE = `# yaml-language-server: $schema=${CONFIG_SCHEMA_FILE}`;

/** An entry's plain options as JSON Schema: the keys of its `with` that are not slots. */
const optionsOf = (entry: CatalogEntry) => {
  // Only the outer schema names its draft; an entry's options sit inside it.
  const schema = Object.fromEntries(
    Object.entries(z.toJSONSchema(entry.options, { io: "input", unrepresentable: "any" })).filter(
      ([key]) => key !== "$schema",
    ),
  );
  const properties =
    "properties" in schema && typeof schema.properties === "object" ? schema.properties : {};
  const required = "required" in schema && Array.isArray(schema.required) ? schema.required : [];
  return {
    properties: { ...properties },
    required: required.filter((key) => typeof key === "string"),
  };
};

const needsWith = (entry: CatalogEntry) =>
  optionsOf(entry).required.length > 0 ||
  Object.values(entry.slots).some(({ port }) => !isFlowPort(port));

/**
 * The JSON Schema of a shiplane.yml for this catalog: each slot offers the adapters of its port by
 * name, and once `use` names one, the keys its `with` takes. Editors complete and check from it.
 */
export const configJsonSchema = (catalog: readonly CatalogEntry[]): JsonSchema => {
  const named = (entries: readonly CatalogEntry[], what: string): JsonSchema => {
    const short = entries
      .filter((entry) => !needsWith(entry))
      .map((entry) => ({ const: entry.name, description: entry.description }));
    const withOf = (entry: CatalogEntry): JsonSchema => {
      const options = optionsOf(entry);
      return {
        type: "object",
        additionalProperties: false,
        properties: {
          ...options.properties,
          ...Object.fromEntries(
            Object.entries(entry.slots).map(([key, slot]) => [key, slotSchema(slot.port)]),
          ),
        },
        required: [
          ...options.required,
          ...Object.entries(entry.slots)
            .filter(([, { port }]) => !isFlowPort(port))
            .map(([key]) => key),
        ],
      };
    };
    // `use` offers every name; once it holds one, `with` takes that entry's keys.
    const long: JsonSchema = {
      type: "object",
      additionalProperties: false,
      required: ["use"],
      properties: {
        use: {
          anyOf: entries.map((entry) => ({ const: entry.name, description: entry.description })),
        },
        with: { type: "object" },
      },
      allOf: entries.map((entry) => ({
        if: { properties: { use: { const: entry.name } }, required: ["use"] },
        then: {
          ...(needsWith(entry) ? { required: ["with"] } : {}),
          properties: { with: withOf(entry) },
        },
      })),
    };
    return {
      description: `${what}: a name, or use: the name with with: its options`,
      anyOf: [...short, ...(entries.length > 0 ? [long] : [])],
    };
  };
  const slotSchema = (port: SlotPort): JsonSchema =>
    named(
      catalog.filter((entry) => entry.kind === "adapter" && entry.port === port),
      `The ${port} adapter`,
    );
  const ofKind = (kind: CatalogEntry["kind"]) => catalog.filter((entry) => entry.kind === kind);
  const strings = { type: "array", items: { type: "string" } };

  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "shiplane.yml",
    description:
      "How a repository releases with shiplane: the flow, the modules in release order, the features.",
    type: "object",
    additionalProperties: false,
    required: ["flow", "modules"],
    properties: {
      flow: {
        description: "How the release itself runs: an adapter per port.",
        type: "object",
        additionalProperties: false,
        required: [...FLOW_SLOTS],
        properties: {
          ...Object.fromEntries(FLOW_SLOTS.map((port) => [port, slotSchema(port)])),
          approval: {
            description:
              '"required" when someone else approves the release PR; "none", the default, merges it here.',
            enum: ["none", "required"],
          },
        },
      },
      modules: {
        description:
          "What gets released, in this order. The first app is the repository's Latest release.",
        type: "array",
        items: named(ofKind("module"), "A module"),
      },
      features: {
        description: "What happens around a release, after the ship, in this order.",
        type: "array",
        items: named(ofKind("feature"), "A feature"),
      },
      units: {
        ...strings,
        description: "Folders to look in, dir/* or exact. Without it, the workspace file decides.",
      },
      tag: {
        description:
          "How a tag names a version: a format's name, or a format of your own naming {version}.",
        anyOf: [{ enum: Object.keys(TAG_FORMATS) }, { type: "string", pattern: "\\{version\\}" }],
      },
      via: {
        description:
          "How a unit ships when both ways can: ci (the flow's CI pipeline) or local (this machine).",
        enum: ["ci", "local"],
      },
      display: {
        description: "How much the release says while it runs; --verbose and --mascot override.",
        type: "object",
        additionalProperties: false,
        properties: {
          verbose: {
            type: "boolean",
            description: "Say each thing it reads and runs, with a progress bar.",
          },
          mascot: {
            description: "The mascot beside what is happening: true, false, or frames per mood.",
            anyOf: [{ type: "boolean" }, { type: "object", additionalProperties: strings }],
          },
        },
      },
      testComment: {
        description:
          "The pull request comment of a test version: a preset's name, or a template with {branch}, {commit}, {table} and {install}.",
        anyOf: [{ enum: Object.keys(comments) }, { type: "string" }],
      },
      testRelease: {
        description:
          "Which channel each branch's test release publishes on: a preset's name, or a map of branch to channel.",
        anyOf: [
          { enum: Object.keys(testReleases) },
          { type: "object", additionalProperties: { type: "string" } },
        ],
      },
      prepare: {
        type: "string",
        description:
          "A shell command run from the root before each unit ships from this machine; {unit} and {dir} are filled.",
      },
    },
  };
};

/** The schema as a file holds it. */
export const configSchemaText = (catalog: readonly CatalogEntry[]) =>
  `${JSON.stringify(configJsonSchema(catalog), null, 2)}\n`;
