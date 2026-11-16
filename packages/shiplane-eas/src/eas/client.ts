import path from "node:path";
import type { DecideContext, Environment, ReleaseUnit, Shell } from "shiplane/plugin";
import { z } from "shiplane/plugin";

import type { FailedBuild, Platform, RunningBuild, ShippedBuild, Submission } from "./decide";
import { easCommand } from "./command";

// eas-cli prints notices around its JSON: keep the outermost JSON value only.
const parseEasJson = (output: string): unknown => {
  const start = output.search(/[[{]/);
  const end = Math.max(output.lastIndexOf("]"), output.lastIndexOf("}"));
  return JSON.parse(output.slice(start, end + 1));
};

const SourceSchema = z.object({
  type: z.string(),
  filePath: z.string().optional(),
  id: z.string().optional(),
  hash: z.string().nullish(),
});
const FingerprintSchema = z.object({ hash: z.string(), sources: z.array(SourceSchema) });
const EasBuildSchema = z.object({
  id: z.string(),
  status: z.string(),
  buildProfile: z.string().nullish(),
  isForIosSimulator: z.boolean().nullish(),
  appVersion: z.string().nullish(),
  appBuildVersion: z.string().nullish(),
  gitCommitHash: z.string().nullish(),
  createdAt: z.string(),
  fingerprint: z.object({ hash: z.string() }).nullish(),
});
const UpdateListSchema = z.object({
  currentPage: z.array(
    // EAS lists rolloutPercentage only while a rollout holds the group back from part of the channel.
    z.object({ group: z.string(), rolloutPercentage: z.number().optional() }),
  ),
});
const UpdateViewSchema = z.array(
  z.object({ gitCommitHash: z.string().nullish(), createdAt: z.string().nullish() }),
);
const UpdateInsightsSchema = z.object({
  platforms: z.array(
    z.object({
      platform: z.enum(["ios", "android"]),
      totals: z.object({ installs: z.number(), failedInstalls: z.number() }),
    }),
  ),
});

// The shape `eas submit:list --json` prints is not documented: read the few fields a retry needs,
// whichever of the names eas-cli's submission fragment carries, and skip what does not parse.
const SubmissionSchema = z
  .object({
    id: z.string(),
    status: z.string(),
    createdAt: z.string().nullish(),
    submittedBuild: z.object({ id: z.string() }).loose().nullish(),
    buildId: z.string().nullish(),
  })
  .loose();
const SubmissionListSchema = z.union([
  z.array(z.unknown()),
  z.object({ currentPage: z.array(z.unknown()) }).transform(({ currentPage }) => currentPage),
]);

const RUNNING = new Set(["NEW", "IN_QUEUE", "IN_PROGRESS"]);
const FAILED = new Set(["ERRORED", "CANCELED"]);

const shippedBuild = (build: z.infer<typeof EasBuildSchema>): ShippedBuild => ({
  id: build.id,
  appVersion: build.appVersion ?? null,
  buildNumber: build.appBuildVersion ?? null,
  fingerprint: build.fingerprint?.hash ?? null,
  gitCommit: build.gitCommitHash ?? null,
  createdAt: build.createdAt,
});

const runningBuild = (build: z.infer<typeof EasBuildSchema>): RunningBuild => ({
  id: build.id,
  appVersion: build.appVersion ?? null,
  buildNumber: build.appBuildVersion ?? null,
});

// eas-cli rejects --non-interactive on these commands as a nonexistent flag.
const WITHOUT_NON_INTERACTIVE_FLAG = new Set(["update:view"]);

// The first stderr line is often eas-cli's upgrade notice: report its own error line instead.
const failureReason = (stderr: string): string => {
  const lines = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.find((line) => line.startsWith("Error:")) ?? lines.at(-1) ?? "";
};

/** One platform's builds on one environment's channel. */
interface OnChannel {
  platform: Platform;
  environment: Environment;
}

/** One update group on one environment's channel. */
interface UpdateGroup {
  group: string;
  environment: Environment;
}

/** The eas CLI, run in the app's folder with its environment as APP_VARIANT. */
export const easClient = ({ shell, cwd }: { shell: Shell; cwd: string }) => {
  const eas = async ({
    args,
    environment,
  }: {
    args: string[];
    environment: Environment;
  }): Promise<unknown> => {
    const command = args[0] ?? "";
    const flags = WITHOUT_NON_INTERACTIVE_FLAG.has(command)
      ? ["--json"]
      : ["--json", "--non-interactive"];
    const run = easCommand({ cwd, environment, args: [...args, ...flags] });
    const { status, stdout, stderr } = await shell.capture(run.command, run.args, {
      cwd: run.cwd,
      env: run.env,
    });
    if (status !== 0) {
      throw new Error(`eas ${command} exited with ${status}: ${failureReason(stderr)}`);
    }
    return parseEasJson(stdout);
  };

  // Read once per client: the channel and a retry look at the same list.
  const lists = new Map<string, Promise<z.infer<typeof EasBuildSchema>[]>>();
  const storeBuilds = ({ platform, environment }: OnChannel) => {
    const key = `${platform} ${environment}`;
    const list =
      lists.get(key) ??
      eas({ args: ["build:list", "--platform", platform, "--limit", "30"], environment }).then(
        (output) =>
          z
            .array(EasBuildSchema)
            .parse(output)
            .filter((build) => build.buildProfile === environment && !build.isForIosSimulator),
      );
    lists.set(key, list);
    return list;
  };

  return {
    localFingerprint: async ({ platform, environment }: OnChannel) =>
      FingerprintSchema.parse(
        await eas({ args: ["fingerprint:generate", "--platform", platform], environment }),
      ).hash,

    // The simulator profile shares the preview channel: only the channel's own store profile counts.
    channelBuilds: async (channel: OnChannel) => {
      const builds = await storeBuilds(channel);
      const finished = builds.find((build) => build.status === "FINISHED");
      const running = builds.find((build) => RUNNING.has(build.status));
      return {
        shipped: finished ? shippedBuild(finished) : null,
        running: running ? runningBuild(running) : null,
      };
    },

    /**
     * One version's newest finished and running store builds, and its newest errored or canceled
     * one when no finished build came after it.
     */
    versionBuilds: async ({ version, ...channel }: OnChannel & { version: string }) => {
      const builds = (await storeBuilds(channel)).filter((build) => build.appVersion === version);
      const finished = builds.findIndex((build) => build.status === "FINISHED");
      const failed = builds.findIndex((build) => FAILED.has(build.status));
      const running = builds.find((build) => RUNNING.has(build.status));
      const failure = builds[failed];
      return {
        finished: finished >= 0 && builds[finished] ? shippedBuild(builds[finished]) : null,
        running: running ? runningBuild(running) : null,
        failed:
          failure && (finished < 0 || failed < finished)
            ? ({
                id: failure.id,
                status: failure.status === "CANCELED" ? "canceled" : "errored",
                createdAt: failure.createdAt,
                gitCommit: failure.gitCommitHash ?? null,
              } satisfies FailedBuild)
            : null,
      };
    },

    /** The platform's recent submissions, newest first; null when eas-cli's answer cannot be read. */
    submissions: async ({ platform, environment }: OnChannel) => {
      try {
        const list = SubmissionListSchema.parse(
          await eas({
            args: ["submit:list", "--platform", platform, "--limit", "10"],
            environment,
          }),
        );
        return list.flatMap((entry): Submission[] => {
          const parsed = SubmissionSchema.safeParse(entry);
          if (!parsed.success) return [];
          const { id, status, createdAt, submittedBuild, buildId } = parsed.data;
          return [
            {
              id,
              status: status.toLowerCase().replaceAll("_", "-"),
              createdAt: createdAt ?? null,
              buildId: submittedBuild?.id ?? buildId ?? null,
            },
          ];
        });
      } catch {
        return null;
      }
    },

    // What differs between the last build's native layer and this commit's, for a "native changed".
    nativeChanges: async ({
      buildId,
      environment,
    }: {
      buildId: string;
      environment: Environment;
    }): Promise<string[]> => {
      const { fingerprint1, fingerprint2 } = z
        .object({ fingerprint1: FingerprintSchema, fingerprint2: FingerprintSchema })
        .parse(await eas({ args: ["fingerprint:compare", "--build-id", buildId], environment }));
      type Source = z.infer<typeof SourceSchema>;
      const key = (source: Source) => `${source.type}:${source.filePath ?? source.id ?? ""}`;
      const label = (source: Source) =>
        (source.filePath ?? source.id ?? source.type).replace(/^(\.\.\/)+/, "");
      const before = new Map(fingerprint1.sources.map((source) => [key(source), source]));
      const after = new Map(fingerprint2.sources.map((source) => [key(source), source]));
      return [
        ...[...after].flatMap(([id, source]) => {
          const old = before.get(id);
          if (!old) return [`+ ${label(source)}`];
          return old.hash === source.hash ? [] : [`~ ${label(source)}`];
        }),
        ...[...before].flatMap(([id, source]) => (after.has(id) ? [] : [`- ${label(source)}`])),
      ];
    },

    /** The newest update group on the channel, with the share of people it reaches. */
    lastUpdate: async (
      environment: Environment,
    ): Promise<{ group: string; rolloutPercentage: number } | null> => {
      const { currentPage } = UpdateListSchema.parse(
        await eas({ args: ["update:list", "--branch", environment, "--limit", "1"], environment }),
      );
      const [last] = currentPage;
      return last ? { group: last.group, rolloutPercentage: last.rolloutPercentage ?? 100 } : null;
    },

    /** Each platform's launches of an update group over the last 7 days, and the failed ones. */
    updateLaunches: async ({ group, environment }: UpdateGroup) =>
      UpdateInsightsSchema.parse(
        await eas({ args: ["update:insights", group], environment }),
      ).platforms.map(({ platform, totals }) => ({ platform, ...totals })),

    /** The commit an update group was made from, and when it was published. */
    updateOrigin: async ({ group, environment }: UpdateGroup) => {
      const [first] = UpdateViewSchema.parse(
        await eas({ args: ["update:view", group], environment }),
      );
      return { commit: first?.gitCommitHash ?? null, createdAt: first?.createdAt ?? null };
    },
  };
};

export type EasClient = ReturnType<typeof easClient>;

/** The eas CLI for one app, in its folder. */
export const clientFor = ({ context, unit }: { context: DecideContext; unit: ReleaseUnit }) =>
  easClient({ shell: context.shell, cwd: path.join(context.root, unit.dir) });
