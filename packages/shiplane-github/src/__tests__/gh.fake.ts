import type { Shell, ShellResult } from "shiplane/plugin";

export interface GhCall {
  how: "capture" | "attach";
  command: string;
  args: string[];
  cwd?: string;
  input?: string;
}

const answer = (result: Partial<ShellResult> | string): ShellResult =>
  typeof result === "string"
    ? { status: 0, stdout: result, stderr: "" }
    : { status: 0, stdout: "", stderr: "", ...result };

/**
 * A gh CLI that answers each call by the first seeded args prefix it starts with, and records
 * every call: its args, folder and standard input. Unseeded calls succeed with no output.
 */
export const fakeGh = () => {
  const calls: GhCall[] = [];
  const answers: { prefix: string; result: ShellResult }[] = [];
  const reply = (how: GhCall["how"], command: string, args: readonly string[], options = {}) => {
    const { cwd, input } = options as { cwd?: string; input?: string };
    calls.push({ how, command, args: [...args], cwd, input });
    const line = args.join(" ");
    return answers.find(({ prefix }) => line.startsWith(prefix))?.result ?? answer("");
  };
  const shell: Shell = {
    capture: (command, args, options) => Promise.resolve(reply("capture", command, args, options)),
    attach: (command, args, options) =>
      Promise.resolve(reply("attach", command, args, options).status),
    env: () => undefined,
  };
  return {
    shell,
    calls,
    /** Answers calls whose args start with `prefix`: a string is a successful stdout. */
    seed(prefix: string, result: Partial<ShellResult> | string) {
      answers.push({ prefix, result: answer(result) });
      return this;
    },
    /** The args of every call, in order. */
    get args() {
      return calls.map(({ args }) => args);
    },
  };
};
