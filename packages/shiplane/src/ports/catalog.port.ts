import type { z } from "zod";

import type { ReleaseFlow } from "../modules/module";
import type { Adapter } from "./adapter.port";

/** Every port a YAML config fills by naming an adapter. */
export const SLOT_PORTS = [
  "sourceControl",
  "codeHost",
  "ciPipeline",
  "versioning",
  "serverHosting",
  "staticHosting",
  "mobileDistribution",
  "packageRegistry",
] as const;

export type SlotPort = (typeof SLOT_PORTS)[number];

/** A key of `with` that names an adapter: the port it fills, and whether it may be left out. */
export interface Slot {
  port: SlotPort;
  /** Left out, the entry fills it itself, such as from the flow. */
  optional?: boolean;
}

/** The adapters a config named for an entry's slots, by key; a slot left out is absent. */
export type MadeSlots = Readonly<Partial<Record<string, Adapter<unknown>>>>;

/** What a catalog entry is told when a config makes it: the flow, once it is made. */
export interface MakeContext {
  flow: ReleaseFlow | null;
}

/**
 * One thing a YAML config can name: an adapter, a module or a feature, with what its `with` takes.
 * A plugin exports its entries as `catalog`; shiplane's own modules are in its catalog too.
 */
export interface CatalogEntry {
  readonly kind: "adapter" | "module" | "feature";
  /** What a config names it by: "git", "backend-service", "release-comments". */
  readonly name: string;
  /** The port an adapter fills; unset for a module or a feature. */
  readonly port?: SlotPort;
  /** One line on what it does, shown by editors and the reference. */
  readonly description: string;
  /** The keys of `with` that are plain values: strings, numbers, lists. */
  readonly options: z.ZodObject;
  /** The keys of `with` that name an adapter. */
  readonly slots: Readonly<Record<string, Slot>>;
  /**
   * Makes it from `with`: its options as written, its slots already made into adapters. Throws
   * when an option is wrong, saying which.
   */
  readonly make: (
    options: Record<string, unknown>,
    slots: MadeSlots,
    context: MakeContext,
  ) => unknown;
}
