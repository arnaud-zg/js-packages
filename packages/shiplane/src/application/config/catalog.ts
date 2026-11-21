import type { z } from "zod";

import type { Feature, ReleaseModule } from "../../modules/module";
import type { AnyDeliveryAdapter } from "../../modules/suggest";
import type { Adapter, ServiceAdapter } from "../../ports/adapter.port";
import type {
  CatalogEntry,
  MadeSlots,
  MakeContext,
  Slot,
  SlotPort,
} from "../../ports/catalog.port";

/** An adapter a YAML config names, such as `sourceControl: git`: its options are `with`. */
export const adapterEntry = <Options extends z.ZodObject>(entry: {
  name: string;
  port: SlotPort;
  description: string;
  options: Options;
  make: (options: z.output<Options>) => Adapter<unknown>;
}): CatalogEntry => ({
  kind: "adapter",
  name: entry.name,
  port: entry.port,
  description: entry.description,
  options: entry.options,
  slots: {},
  make: (options) => entry.make(entry.options.parse(options)),
});

/** A module a YAML config lists under `modules`, its adapter a slot of `with`. */
export const moduleEntry = <
  Options extends z.ZodObject,
  Slots extends Record<string, Slot>,
>(entry: {
  name: string;
  description: string;
  options: Options;
  slots: Slots;
  make: (options: z.output<Options>, slots: MadeSlots) => ReleaseModule;
}): CatalogEntry => ({
  kind: "module",
  name: entry.name,
  description: entry.description,
  options: entry.options,
  slots: entry.slots,
  make: (options, slots) => entry.make(entry.options.parse(options), slots),
});

/** A feature a YAML config lists under `features`; a slot left out may come from the flow. */
export const featureEntry = <
  Options extends z.ZodObject,
  Slots extends Record<string, Slot>,
>(entry: {
  name: string;
  description: string;
  options: Options;
  slots: Slots;
  make: (options: z.output<Options>, slots: MadeSlots, context: MakeContext) => Feature;
}): CatalogEntry => ({
  kind: "feature",
  name: entry.name,
  description: entry.description,
  options: entry.options,
  slots: entry.slots,
  make: (options, slots, context) => entry.make(entry.options.parse(options), slots, context),
});

type Capability = AnyDeliveryAdapter["capability"];

const delivers = <C extends Capability>(
  adapter: Adapter<unknown> | undefined,
  capability: C,
): adapter is Extract<AnyDeliveryAdapter, { capability: C }> =>
  adapter !== undefined && "capability" in adapter && adapter.capability === capability;

/** The delivery adapter a module's slot holds, checked to do the module's kind of delivery. */
export const deliveryIn = <C extends Capability>(
  adapter: Adapter<unknown> | undefined,
  capability: C,
): Extract<AnyDeliveryAdapter, { capability: C }> => {
  if (!delivers(adapter, capability)) {
    throw new Error(`its adapter does not do ${capability}: name one that does`);
  }
  return adapter;
};

/**
 * The service adapter a slot holds. The loader only fills a slot with an entry of the slot's port,
 * so the port type is known here, and only here, without being checked again.
 */
export const serviceIn = <Port>(adapter: Adapter<unknown>): ServiceAdapter<Port> =>
  adapter as ServiceAdapter<Port>;
