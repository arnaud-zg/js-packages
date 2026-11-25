import type { CatalogEntry, SlotPort } from "../../ports/catalog.port";
import { comments } from "../../domain/branchRelease";
import { testReleases } from "../../domain/testChannel";
import { SCHEMA_MODELINE } from "./configSchema";
import { isRecord } from "./values";
import { FLOW_SLOTS, isFlowPort, isLocal } from "./yamlDeclaration";
import { yamlText } from "./yamlText";

/** The name of what an entry makes with no options, or null when it needs some. */
const madeName = (entry: CatalogEntry) => {
  try {
    const made = entry.make({}, {});
    return isRecord(made) && typeof made.name === "string" ? made.name : null;
  } catch {
    return null;
  }
};

/** Something a TS config holds that YAML cannot, where it is, and what to do about it. */
export interface Unconverted {
  /** Where it is, as shiplane.yml would name it: `flow.versioning`, `modules[1]`. */
  at: string;
  message: string;
  hint: string;
}

/** What `shiplane migrate` makes of a TS config: the YAML, or what stops it, and what to check. */
export interface Migration {
  text: string;
  /** Each value YAML cannot hold. When any is listed, the text is not to be written. */
  unconverted: Unconverted[];
  /** Written, but worth a look: an adapter that does not say which options it was given. */
  check: string[];
}

const isFunctionIn = (value: unknown): boolean =>
  typeof value === "function" ||
  (Array.isArray(value)
    ? value.some(isFunctionIn)
    : isRecord(value) && Object.values(value).some(isFunctionIn));

const sameJson = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/** The name a preset table gives a value, when it holds that value. */
const presetName = (table: Readonly<Record<string, unknown>>, value: unknown) =>
  Object.entries(table).find(([, preset]) => sameJson(preset, value))?.[0];

/**
 * Writes a TS config's declaration as shiplane.yml, naming each adapter, module and feature from
 * the catalog with the options it was given. A function, or anything no catalog names, is listed
 * as unconverted, never left out.
 */
export const yamlFromDeclaration = (
  declared: unknown,
  catalog: readonly CatalogEntry[],
): Migration => {
  const unconverted: Unconverted[] = [];
  const check: string[] = [];
  const cannot = (at: string, message: string, hint: string) => {
    unconverted.push({ at, message, hint });
    return null;
  };

  // A name, or use with with: the options the adapter, module or feature recorded.
  const named = (
    entry: CatalogEntry,
    options: unknown,
    slots: Record<string, unknown>,
    at: string,
  ) => {
    if (options !== undefined && !isRecord(options))
      return cannot(at, "its options are not a map", "");
    if (options === undefined && Object.keys(entry.options.shape).length > 0) {
      check.push(
        `${at}: ${entry.name} does not say which options it was given; add any to its with:`,
      );
    }
    const plain = options ?? {};
    const fn = Object.keys(plain).find((key) => isFunctionIn(plain[key]));
    if (fn !== undefined) {
      return cannot(
        `${at}.with.${fn}`,
        "is a function: YAML holds values only",
        "give it a value, or keep shiplane.config.ts",
      );
    }
    if (!entry.options.safeParse(plain).success) {
      return cannot(
        at,
        `${entry.name} was given options its catalog does not take`,
        "check them against shiplane docs or the schema",
      );
    }
    const given = { ...plain, ...slots };
    return Object.keys(given).length === 0 ? entry.name : { use: entry.name, with: given };
  };

  const slotOf = (adapter: unknown, port: SlotPort, at: string): unknown => {
    if (!isRecord(adapter) || typeof adapter.name !== "string")
      return cannot(at, "is not an adapter", "");
    // A local file's entries go by the file's path: they match by the adapter they make.
    const entry = catalog.find(
      (candidate) =>
        candidate.kind === "adapter" &&
        candidate.port === port &&
        (candidate.name === adapter.name ||
          (isLocal(candidate.name) && madeName(candidate) === adapter.name)),
    );
    if (!entry) {
      return cannot(
        at,
        `the ${port} adapter "${adapter.name}" is in no catalog`,
        "export a catalog from its file (adapterEntry from shiplane/plugin), then name it by its path in shiplane.yml",
      );
    }
    return named(entry, adapter.options, {}, at);
  };

  if (!isRecord(declared)) {
    return {
      text: "",
      unconverted: [
        {
          at: "shiplane.config.ts",
          message: "its default export is not defineRelease({ ... })",
          hint: "",
        },
      ],
      check,
    };
  }
  const flow = isRecord(declared.flow) ? declared.flow : {};
  const yamlFlow: Record<string, unknown> = Object.fromEntries(
    FLOW_SLOTS.map((port) => [port, slotOf(flow[port], port, `flow.${port}`)]),
  );
  if (flow.approval === "required") yamlFlow.approval = "required";

  const listOf = (key: "modules" | "features") => {
    const items = Array.isArray(declared[key]) ? declared[key] : [];
    return items.map((item: unknown, index) => {
      const at = `${key}[${index}]`;
      if (!isRecord(item)) return cannot(at, "is not a module or a feature", "");
      const kind = key === "modules" ? "module" : "feature";
      const name = typeof item.kind === "string" ? item.kind : item.name;
      const entry = catalog.find((candidate) => candidate.kind === kind && candidate.name === name);
      if (!entry) {
        return cannot(
          at,
          `the ${kind} "${String(name)}" is in no catalog`,
          "export a catalog from its file, then name it by its path in shiplane.yml",
        );
      }
      const adapters = Array.isArray(item.adapters) ? item.adapters : [];
      const slots: Record<string, unknown> = {};
      Object.entries(entry.slots).forEach(([slot, { port }], position) => {
        const adapter: unknown = adapters[position];
        // A slot on the flow's own adapter is left out: it takes the flow's.
        if (isFlowPort(port) && (adapter === undefined || adapter === flow[port])) return;
        slots[slot] = slotOf(adapter, port, `${at}.with.${slot}`);
      });
      const own = kind === "module" && item.name !== item.kind ? { name: item.name } : undefined;
      const options = kind === "module" ? own : item.options;
      return named(entry, options, slots, at);
    });
  };

  const display = isRecord(declared.display) ? declared.display : undefined;
  if (display && typeof display.mascot === "function") {
    cannot(
      "display.mascot",
      "is a function: YAML holds values only",
      "use true, false, frames per mood, or keep shiplane.config.ts",
    );
  }
  const document: Record<string, unknown> = {
    flow: yamlFlow,
    ...(declared.units === undefined ? {} : { units: declared.units }),
    modules: listOf("modules"),
    ...(declared.features === undefined ? {} : { features: listOf("features") }),
    ...(declared.tag === undefined ? {} : { tag: declared.tag }),
    ...(declared.via === undefined ? {} : { via: declared.via }),
    ...(declared.environments === undefined ? {} : { environments: declared.environments }),
    ...(declared.channels === undefined ? {} : { channels: declared.channels }),
    ...(display === undefined ? {} : { display }),
    ...(declared.testComment === undefined
      ? {}
      : { testComment: presetName(comments, declared.testComment) ?? declared.testComment }),
    ...(declared.testRelease === undefined
      ? {}
      : { testRelease: presetName(testReleases, declared.testRelease) ?? declared.testRelease }),
    ...(declared.prepare === undefined ? {} : { prepare: declared.prepare }),
  };
  // What YAML cannot hold stops the migration: no text is made of it.
  if (unconverted.length > 0) return { text: "", unconverted, check };
  const text = [
    SCHEMA_MODELINE,
    "# How this repository releases, written by shiplane migrate from shiplane.config.ts.",
    yamlText(document),
  ].join("\n");
  return { text, unconverted, check };
};
