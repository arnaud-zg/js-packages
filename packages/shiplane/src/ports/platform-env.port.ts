import type { EnvVarName } from "../domain/checkEnvBeforeDeploy";
import type { DeployFlow, Environment } from "../domain/environment";
import type { ReleaseUnit } from "../domain/unit";

/** Where an app's env lives on its platform, read by name only: values are never read or written. */
export interface PlatformEnvPort {
  /** Every env var name the platform holds for this app on this environment. */
  listNames: (input: {
    unit: ReleaseUnit;
    environment: Environment;
    /** The way to users it is on; preview then production when absent. */
    flow?: DeployFlow;
    /** The unit's settings for that environment, as its jobs receive them. */
    options: Record<string, unknown>;
  }) => Promise<ReadonlySet<EnvVarName>>;
  /** The command a person runs to set these names, with `...` where each value goes. */
  setCommand: (input: {
    unit: ReleaseUnit;
    environment: Environment;
    /** The way to users it is on; preview then production when absent. */
    flow?: DeployFlow;
    options: Record<string, unknown>;
    names: readonly EnvVarName[];
  }) => string;
}
