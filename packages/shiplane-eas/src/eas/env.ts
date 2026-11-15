import path from "node:path";
import type { AdapterContext, PlatformEnvPort } from "shiplane/plugin";
import { firstLine, isEnvVarName } from "shiplane/plugin";

import { easCommand } from "./command";

const NAME_LINE = /^([A-Za-z_][A-Za-z0-9_]*)=/;

/** The names of an EAS environment's variables; only names are kept, never values. */
export const easEnv = ({ root, shell }: AdapterContext): PlatformEnvPort => ({
  listNames: async ({ unit, environment }) => {
    const { command, args, cwd, env } = easCommand({
      cwd: path.join(root, unit.dir),
      environment,
      args: ["env:list", environment, "--format", "short"],
    });
    const result = await shell.capture(command, args, { cwd, env });
    if (result.status !== 0) {
      const reason = firstLine(result.stderr) ?? `exit ${result.status}`;
      throw new Error(`eas env:list ${environment}: ${reason}`);
    }
    return new Set(
      result.stdout.split("\n").flatMap((line) => {
        const name = NAME_LINE.exec(line)?.[1];
        return name && isEnvVarName(name) ? [name] : [];
      }),
    );
  },
  setCommand: ({ unit, environment, names }) =>
    [
      `cd ${unit.dir}`,
      ...names.map(
        (name) =>
          `pnpm exec eas env:create --environment ${environment} --name ${name} --value ... --visibility secret`,
      ),
    ].join(" && "),
});
