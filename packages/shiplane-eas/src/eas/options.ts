import type { JobInput, Resolved } from "shiplane/plugin";
import { perEnv, z } from "shiplane/plugin";

export const EasOptions = z.object({
  versionFile: z.string().default("app-version.json").describe("Each environment's binary version"),
  update: perEnv(z.string()).describe(
    "The package script that publishes an update, per environment",
  ),
});

export type Options = Resolved<z.output<typeof EasOptions>>;

/** One tag of the app on one environment, with its settings for that environment. */
export type EasInput = JobInput<Options>;
