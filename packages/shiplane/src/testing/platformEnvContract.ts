import { describe, expect, it } from "vitest";

import type { RecordingShell } from "../adapters/shell/__fakes__/shell.fake";
import type { Environment } from "../domain/environment";
import type { DeliveryAdapter } from "../ports/adapter.port";
import { optionsFor } from "../application/config/optionsFor";
import { isEnvVarName } from "../domain/checkEnvBeforeDeploy";
import { testUnit } from "./releaseContext";

/** One adapter's env, with the shells that answer its listing: one that lists, one that fails. */
export interface PlatformEnvCase {
  adapter: DeliveryAdapter<{ capability: string }>;
  settings: Record<string, unknown>;
  environment: Environment;
  /** A shell whose listing holds `names`. */
  listing: { shell: RecordingShell; names: readonly string[] };
  /** A shell whose listing fails, signed out or offline. */
  failing: RecordingShell;
}

/** What every platform env does, whatever its provider: list names only, and say how to set them. */
export const platformEnvContract = (cases: PlatformEnvCase[]) =>
  describe.each(cases.map((entry) => [entry.adapter.name, entry] as const))(
    "%s, as a platform env",
    (_name, { adapter, settings, environment, listing, failing }) => {
      const unit = testUnit("app", { module: "app", options: settings });
      const options = optionsFor(
        { ...unit, options: adapter.settings.parse(settings) },
        environment,
        [unit],
      );
      const envOn = (shell: RecordingShell) => {
        if (!adapter.env) throw new Error(`${adapter.name} lists no env`);
        return adapter.env({ root: "/repo", shell });
      };

      it("given names set on the platform, when they are listed, then each is there as an env var name", async () => {
        const listed = await envOn(listing.shell).listNames({ unit, environment, options });

        expect([...listed]).toEqual(expect.arrayContaining([...listing.names]));
        expect([...listed].every(isEnvVarName)).toBe(true);
      });

      it("given a listing the platform refuses, when names are listed, then it fails saying why", async () => {
        await expect(envOn(failing).listNames({ unit, environment, options })).rejects.toThrow(
          /\S/,
        );
      });

      it("given names to set, when the person is told how, then the command names each of them", () => {
        const names = listing.names.filter(isEnvVarName);
        const command = envOn(listing.shell).setCommand({ unit, environment, options, names });

        names.forEach((name) => expect(command).toContain(name));
      });
    },
  );
