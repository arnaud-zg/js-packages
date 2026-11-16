import type { Command, Environment } from "shiplane/plugin";

/**
 * One eas command, run in the app's folder: eas reads app.config, which may branch on APP_VARIANT,
 * so the environment rides along as APP_VARIANT.
 */
export const easCommand = ({
  cwd,
  environment,
  args,
  env = {},
}: {
  cwd: string;
  environment: Environment;
  args: string[];
  env?: Record<string, string>;
}): Command & { cwd: string; env: Record<string, string> } => ({
  command: "pnpm",
  args: ["exec", "eas", ...args],
  cwd,
  env: { ...env, APP_VARIANT: environment },
});
