import fs from "node:fs";
import path from "node:path";
import type { Job } from "shiplane/plugin";
import { entryOf, z } from "shiplane/plugin";

import type { Platform, RetryStep } from "./decide";
import type { EasInput } from "./options";
import { easCommand } from "./command";
import { PLATFORM_NAME } from "./wording";

// The first environment's update ships what its tag named; users get the default branch.
const updateRef = ({ tag, environment, flow, defaultBranch }: EasInput) =>
  environment === entryOf(flow) ? tag : defaultBranch;

/** A build of the platforms on EAS, submitted to the stores when done. */
const easBuild = ({
  input: { unit, environment },
  platform,
}: {
  input: EasInput;
  platform: Platform | "all";
}) =>
  easCommand({
    cwd: unit.dir,
    environment,
    args: ["build", "--profile", environment, "--platform", platform, "--auto-submit", "--no-wait"],
    env: { EXPO_ATLAS: "false" },
  });

export const buildJob = (input: EasInput): Job => ({
  label: `build iOS and Android on EAS ${input.environment}, submitted when done`,
  local: [easBuild({ input, platform: "all" })],
});

const Scripts = z.object({ scripts: z.record(z.string(), z.string()).default({}) });
/** A script that names its update itself: `--message`, `-m` or `--auto`. */
const NAMES_UPDATE = /(^|\s)(--message|-m|--auto)(?=[\s=]|$)/;

/** The update script's command, as the unit's package.json holds it; null when it cannot be read. */
const scriptOf = (root: string, { unit, options }: EasInput) => {
  try {
    const file = path.join(root, unit.dir, "package.json");
    return Scripts.parse(JSON.parse(fs.readFileSync(file, "utf8"))).scripts[options.update] ?? null;
  } catch {
    return null;
  }
};

/**
 * Publishes the environment's update through its package script. Off a terminal, `eas update`
 * needs a message: the tag, unless the script names the update itself. With no `root` to read the
 * script from, it runs as written. No `--` before it: pnpm passes that on to the script, and eas
 * reads what follows as unexpected arguments.
 */
export const updateJob = (input: EasInput, root?: string): Job => {
  const { unit, environment, options, tag } = input;
  const script = root === undefined ? null : scriptOf(root, input);
  const message = script !== null && !NAMES_UPDATE.test(script) ? ["--message", tag] : [];
  return {
    label: `publish the ${environment} update`,
    local: [
      {
        command: "pnpm",
        args: ["run", options.update, ...message],
        cwd: unit.dir,
        env: { APP_VARIANT: environment },
      },
    ],
    ci: { ref: updateRef(input) },
  };
};

/** One eas command on a rollout; no workflow moves a rollout, so it runs here. */
export const rolloutJob = ({
  input: { unit, environment },
  label,
  args,
}: {
  input: EasInput;
  label: string;
  args: string[];
}): Job => ({
  label,
  local: [easCommand({ cwd: unit.dir, environment, args: [...args, "--non-interactive"] })],
});

/** What a retry runs from: the tag on CI and in a worktree here, or this checkout. */
const fromTagged = ({ input, fromTag }: { input: EasInput; fromTag: boolean }) =>
  fromTag ? { ci: { ref: input.tag }, from: input.tag } : {};

/** A build of the platforms a retry still needs, submitted when done; from the tag when given. */
const retryBuildJob = ({
  input,
  platforms,
  fromTag,
}: {
  input: EasInput;
  platforms: Platform[];
  fromTag: boolean;
}): Job => ({
  label: `build ${platforms.map((platform) => PLATFORM_NAME[platform]).join(" and ")} ${input.unit.version} on EAS ${input.environment}, submitted when done`,
  local: [
    easBuild({ input, platform: platforms.length === 1 && platforms[0] ? platforms[0] : "all" }),
  ],
  ...fromTagged({ input, fromTag }),
});

/** Submits a build EAS already finished, to the store its environment's profile names. */
const submitJob = ({
  input,
  step,
  fromTag,
}: {
  input: EasInput;
  step: Extract<RetryStep, { action: "submit" }>;
  fromTag: boolean;
}): Job => {
  const { unit, environment } = input;
  return {
    label: `submit ${PLATFORM_NAME[step.platform]} build ${step.build.buildNumber ?? step.build.id} to ${environment}`,
    local: [
      easCommand({
        cwd: unit.dir,
        environment,
        args: [
          "submit",
          "--platform",
          step.platform,
          "--id",
          step.build.id,
          "--profile",
          environment,
          "--non-interactive",
        ],
      }),
    ],
    ...fromTagged({ input, fromTag }),
  };
};

/** What finishes a version on each platform: one build for those with none, a submit for the rest. */
export const retryJobs = ({
  input,
  steps,
  fromTag,
}: {
  input: EasInput;
  steps: readonly RetryStep[];
  fromTag: boolean;
}) => {
  const platforms = steps
    .filter(({ action }) => action === "build")
    .map(({ platform }) => platform);
  return [
    ...(platforms.length > 0 ? [retryBuildJob({ input, platforms, fromTag })] : []),
    ...steps.flatMap((step) =>
      step.action === "submit" ? [submitJob({ input, step, fromTag })] : [],
    ),
  ];
};
