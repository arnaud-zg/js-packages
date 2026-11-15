import type { Shell, ShellResult } from "../../ports/shell.port";
import { CommandFailed } from "../../ports/shell.port";

/** The first line of a command's output that has text on it, trimmed. */
export const firstLine = (text: string): string | undefined =>
  text
    .split("\n")
    .find((line) => line.trim())
    ?.trim();

/** Everything a failed command printed, its errors first. */
const printed = ({ stdout, stderr }: ShellResult) =>
  [stderr, stdout]
    .map((text) => text.trim())
    .filter(Boolean)
    .join("\n");

/** A command that exited non-zero, named by `label` and its first error line. */
export const commandFailed = ({ label, result }: { label: string; result: ShellResult }) => {
  const reason = firstLine(result.stderr);
  return new CommandFailed(
    `${label} exited with ${result.status}${reason ? `: ${reason}` : ""}`,
    printed(result),
  );
};

/**
 * Runs a command and returns what it printed; a non-zero exit throws `CommandFailed`, which a
 * failed release step shows in full.
 */
export const mustCapture = async ({
  shell,
  command,
  args,
  cwd,
  env,
  input,
  label,
}: {
  shell: Shell;
  command: string;
  args: readonly string[];
  cwd?: string;
  env?: Record<string, string>;
  input?: string;
  /** How the failure names the command, `git push` by default the command and its first argument. */
  label?: string;
}): Promise<string> => {
  const result = await shell.capture(command, args, { cwd, env, input });
  if (result.status === 0) return result.stdout;
  throw commandFailed({ label: label ?? `${command} ${args[0] ?? ""}`.trim(), result });
};
