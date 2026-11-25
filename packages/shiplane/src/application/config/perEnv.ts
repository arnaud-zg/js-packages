import { z } from "zod";

import type { Environment } from "../../domain/environment";
import type { PerEnvMap } from "../../ports/delivery.port";

/** Marks the keys of a per-environment map: a config loads its own zod, so a schema is known by what it says. */
export const ENVIRONMENT_KEY = "An environment of deployApps.promote";

/** A value that is the same everywhere, or written once per environment. */
export const perEnv = <Value extends z.ZodType>(value: Value) =>
  z.union([
    value,
    z.record(z.string().describe(ENVIRONMENT_KEY), value) as unknown as z.ZodType<
      PerEnvMap<z.output<Value>>,
      Record<Environment, z.input<Value>>
    >,
  ]);

export type PerEnv<Value> = Value | Record<Environment, Value>;
