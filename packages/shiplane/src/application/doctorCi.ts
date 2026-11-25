import path from "node:path";
import { z } from "zod";

import type { Requirement } from "../ports/delivery.port";
import type { Release } from "./config/loadRelease";
import type { SetupContext } from "./setupContext";
import { LIVE } from "../domain/environment";
import { channelProblem } from "../domain/testChannel";
import { checkStatus, requirementsOf, signInsOf } from "./requirements";
import { paint } from "./say";
import { commandLine, flowOf } from "./targets";

/** Where every check a runner makes is listed, with what it supports. */
export const WORKFLOW_DOCS =
  "https://github.com/arnaud-zg/js-packages/blob/main/docs/shiplane/reference.md#github-actions-workflow";

/** The units a run names, each one the config's. */
const unitsSchema = (known: readonly string[]) =>
  z.array(z.string()).superRefine((names, context) => {
    const unknown = names.filter((name) => !known.includes(name));
    if (unknown.length > 0) {
      context.addIssue({
        code: "custom",
        message: `unknown units [${unknown.join(", ")}]: known [${known.join(", ")}]`,
      });
    }
  });

const environmentSchema = (path: readonly string[]) =>
  z.string().refine((name) => path.includes(name), {
    error: ({ input }) => `unknown environment "${String(input)}": ${path.join(", ")}`,
  });

const isPackage = (release: Release, module: string) =>
  release.modules.find(({ name }) => name === module)?.capability === "package-registry";

/** The first problem a schema found, as said. */
const problemOf = (error: z.ZodError) => error.issues[0]?.message ?? "invalid";

/** `$NAME` and `${NAME}` read from the environment, such as `$HOME/.fly/bin`. */
const expand = (context: SetupContext, text: string) =>
  text.replace(/\$\{?(\w+)\}?/g, (_, name: string) => context.shell.env(name) ?? "");

/**
 * A missing tool installed, its folder put first on PATH for this run and, through `GITHUB_PATH`,
 * for the steps after it. The problem, or null once it answers.
 */
const install = async (context: SetupContext, requirement: Requirement) => {
  const { shell, files, root } = context;
  const { label, install: how } = requirement;
  if (!how) return `${label} missing and no install for linux`;
  const { command } = how;
  const status = await shell.attach(command.command, command.args, {
    cwd: path.join(root, command.cwd ?? ""),
    env: command.env,
  });
  if (status !== 0) return `${label} install failed: ${commandLine(command)} exited with ${status}`;
  if (how.path !== undefined) {
    const dir = expand(context, how.path);
    shell.prependPath?.(dir);
    const githubPath = shell.env("GITHUB_PATH");
    if (githubPath) files.append(githubPath, `${dir}\n`);
  }
  return (await checkStatus(shell, root, requirement)) === 127
    ? `${label} still missing after ${commandLine(command)}`
    : null;
};

/** Each secret a requirement names that this run does not hold, as said. */
const missing = (context: SetupContext, who: string, requirements: readonly Requirement[]) =>
  requirements.flatMap(({ label, secrets = [] }) =>
    secrets.filter((name) => !context.shell.env(name)).map((name) => ({ who, label, name })),
  );

/** Every secret the picked units and the flow need that this run does not hold, in release order. */
const missingSecrets = (context: SetupContext, release: Release, picked: ReadonlySet<string>) => [
  ...release.units
    .filter(({ name }) => picked.has(name))
    .flatMap((unit) => {
      const provider = release.modules.find(({ name }) => name === unit.module)?.provider;
      return missing(
        context,
        `${unit.name} ships with ${provider ?? unit.module}`,
        signInsOf(release, new Set([unit.name])),
      );
    }),
  ...requirementsOf(release, new Set()).flatMap((requirement) =>
    missing(context, `shiplane needs ${requirement.label}`, [requirement]),
  ),
];

/**
 * `shiplane doctor --ci`: what a runner checks before it ships, in order, stopping at the first
 * problem: the units, the environment, each tool (installed when missing), each secret.
 */
export const doctorCi = async (
  context: SetupContext,
  { units, channel }: { units: readonly string[]; channel: string },
): Promise<boolean> => {
  const { output, shell, root } = context;
  const passed = (check: string, detail: string) =>
    output.line(`${paint("green", "✓")} ${check}  ${paint("dim", detail)}`);
  const stop = (problem: string) => {
    output.line(`${paint("red", "✗")} ${problem}`);
    output.line(`  ${paint("dim", WORKFLOW_DOCS)}`);
    return false;
  };
  const release = await context.load();
  const [problem] = release.problems;
  if (problem) {
    return stop(
      `${problem.line === undefined ? problem.file : `${problem.file}:${problem.line}`}: ${problem.message}`,
    );
  }
  const known = release.units.map(({ name }) => name);
  const packages = release.units
    .filter((unit) => isPackage(release, unit.module))
    .map(({ name }) => name);
  const { path } = flowOf({ release });
  // Anything but an environment publishes packages: live, or a test release's channel.
  const publishes =
    packages.length > 0 &&
    !path.includes(channel) &&
    (channel === LIVE || channelProblem(channel) === null);
  const named = unitsSchema(known).safeParse(
    units.length > 0 ? units : publishes ? packages : known,
  );
  if (!named.success) return stop(problemOf(named.error));
  const apps = publishes ? named.data.filter((name) => !packages.includes(name)) : [];
  if (apps.length > 0) return stop(`${channel} publishes packages only: not ${apps.join(", ")}`);
  passed("units", named.data.join(", "));
  const environment = environmentSchema(path).safeParse(channel);
  if (!publishes && !environment.success) return stop(problemOf(environment.error));
  passed("environment", channel);
  const picked = new Set(named.data);
  for (const requirement of requirementsOf(release, picked)) {
    const found = (await checkStatus(shell, root, requirement)) !== 127;
    const problem = found ? null : await install(context, requirement);
    if (problem) return stop(problem);
    passed(requirement.label, found ? "installed" : "installed now");
  }
  const [absent] = missingSecrets(context, release, picked);
  if (absent) return stop(`${absent.who}: ${absent.name} missing in "${channel}"`);
  const secrets = requirementsOf(release, picked).flatMap(({ secrets = [] }) => secrets);
  passed("secrets", secrets.length > 0 ? [...new Set(secrets)].join(", ") : "none needed");
  return true;
};
