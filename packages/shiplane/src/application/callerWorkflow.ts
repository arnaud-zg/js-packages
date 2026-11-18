import path from "node:path";

import type { CallerWorkflow } from "../ports/ci-pipeline.port";
import type { Release } from "./config/loadRelease";
import type { SetupContext } from "./setupContext";
import { paint, reasonOf } from "./say";

/** What a workflow calling shiplane's own holds in its `uses:` line. */
const CALLS = "/.github/workflows/shiplane-ship.yml@";
const USES = /^([ \t]*)uses:[ \t]*\S*\/\.github\/workflows\/shiplane-ship\.yml@.*$/m;
const PINNED = /shiplane-ship\.yml@\S+[ \t]+#[ \t]*shiplane@(\S+)/;

/** The workflow a repository ships from, as its CI pipeline writes it; null when it writes none. */
const callerOf = ({ version, root, shell }: SetupContext, release: Release) => {
  const ci = release.flow.ciPipeline.create({ root, shell });
  const file = ci.workflowFile?.(ci.shipWorkflow);
  const make = ci.callerWorkflow;
  if (!version || !file || !make) return null;
  return { file, name: path.posix.basename(file), version, make: () => make(version) };
};

/** The made workflow, or null once why it could not be made is said. */
const madeOrSaid = async (
  { output }: SetupContext,
  make: () => Promise<CallerWorkflow | { error: string }>,
  bar: string,
) => {
  const made = await make().catch((error: unknown) => ({ error: reasonOf(error) }));
  if (!("error" in made)) return made;
  output.line(`${bar}${paint("yellow", "!")} ${paint("dim", made.error)}`);
  return null;
};

/** What setup writes for the caller workflow: nothing when one is there, or none can be made. */
export const callerWrite = async (context: SetupContext, release: Release) => {
  const caller = callerOf(context, release);
  if (!caller || context.files.exists(caller.file)) return null;
  const made = await madeOrSaid(context, caller.make, "  ");
  return made ? { file: made.file, text: made.content, created: true } : null;
};

/** `text` with its `uses:` line pinned as `content`'s is, everything else as the person wrote it. */
const repinned = (text: string, content: string) => {
  const uses = USES.exec(content)?.[0].trim() ?? "";
  return text.replace(USES, (_line, indent: string) => `${indent}${uses}`);
};

/** What is wrong with the caller workflow, its fix, and whether that fix may overwrite a person's. */
const problemOf = (file: string, name: string, version: string, text: string | null) => {
  if (text === null) {
    return { said: `${name} missing`, ask: `Write ${file}?`, fix: (content: string) => content };
  }
  if (!text.includes(CALLS)) {
    return {
      said: `${name} does not call shiplane-ship.yml`,
      ask: `Replace ${file} with one that calls shiplane-ship.yml? Your workflow is lost.`,
      fix: (content: string) => content,
      overwrites: true,
    };
  }
  const pinned = PINNED.exec(text)?.[1];
  if (pinned === version) return null;
  return {
    said: `${name} pins ${pinned ? `shiplane@${pinned}` : "no shiplane version"}, installed ${version}`,
    ask: `Re-pin ${file} to shiplane@${version}?`,
    fix: (content: string) => repinned(text, content),
  };
};

/**
 * Doctor's check of the caller workflow, on a laptop only: there, pinned to the shiplane installed,
 * each problem said with its fix offered. Replacing a person's own workflow is asked, never assumed.
 */
export const checkCallerWorkflow = async (
  context: SetupContext,
  release: Release,
  { yes }: { yes: boolean },
): Promise<boolean> => {
  const { shell, files, output, prompter } = context;
  if (shell.env("GITHUB_ACTIONS") === "true" || shell.env("CI") === "true") return true;
  const caller = callerOf(context, release);
  if (!caller) return true;
  const { file, name, version } = caller;
  const bar = `${paint("dim", "│")}  `;
  const problem = problemOf(file, name, version, files.read(file));
  if (!problem) {
    output.line(`${bar}${paint("green", "✓")} ${name}  ${paint("dim", `shiplane@${version}`)}`);
    return true;
  }
  output.line(`${bar}${paint("red", "✗")} ${problem.said}`);
  const agreed = problem.overwrites
    ? !yes && prompter.interactive && (await prompter.confirm(problem.ask, false))
    : yes || (prompter.interactive && (await prompter.confirm(problem.ask, true)));
  if (!agreed) return false;
  const made = await madeOrSaid(context, caller.make, bar);
  if (!made) return false;
  const created = !files.exists(file);
  files.write(file, problem.fix(made.content));
  output.line(`${bar}${created ? paint("green", "+") : paint("yellow", "~")} ${file}`);
  return true;
};
