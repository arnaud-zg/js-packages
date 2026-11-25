import path from "node:path";
import type { DeliveryAdapter, MobileDistributionPort } from "shiplane/plugin";
import { defineMobileDistribution, entryOf, z } from "shiplane/plugin";

import { analyse, analysisJson, updateHealth } from "./eas/analyse";
import { beforeVersion } from "./eas/before-version";
import { clientFor } from "./eas/client";
import { entryState } from "./eas/entry-state";
import { entryDecision } from "./eas/entry.decision";
import { easEnv } from "./eas/env";
import { buildJob, updateJob } from "./eas/jobs";
import { EasOptions } from "./eas/options";
import { usersDecision, usersState } from "./eas/users.decision";
import { binaryVersion } from "./eas/version-file";

/** The environment an update script names, and whether a check runs first: `eas:update:<name>:gated`. */
const UPDATE_SCRIPT = /update[:-]([a-z][a-z0-9-]*)(:gated)?$/;

/** The script publishing each environment's update, the one with no check first when there are both. */
const updateScripts = (names: readonly string[]) => {
  const updates: Record<string, { script: string; gated: boolean }> = {};
  for (const script of names) {
    const [, environment, gate] = UPDATE_SCRIPT.exec(script) ?? [];
    if (!environment) continue;
    const gated = gate !== undefined;
    if (!updates[environment] || (updates[environment].gated && !gated)) {
      updates[environment] = { script, gated };
    }
  }
  return Object.fromEntries(
    Object.entries(updates).map(([environment, { script }]) => [environment, script]),
  );
};

/**
 * A mobile app on EAS. The native fingerprint decides between a new binary and an over-the-air
 * update; where users are ships what the environment before validated, moving its version by PR first when it must.
 */
export type EasMobileDistributionAdapter = DeliveryAdapter<MobileDistributionPort>;

export const easMobileDistribution = (): EasMobileDistributionAdapter =>
  defineMobileDistribution({
    name: "eas",
    settings: EasOptions,
    decidedBy: { platform: "EAS", choice: "build or update", check: "shiplane status --json" },
    typicalMinutes: 8,
    // The binary versions move after a tag; the code does not.
    versionFiles: (unit) => [path.posix.join(unit.dir, EasOptions.parse(unit.options).versionFile)],
    describe: ({ environment }) => `EAS ${environment}, iOS and Android`,
    detect: (folder) => {
      if (!folder.has("eas.json")) return null;
      const scripts = z
        .object({ scripts: z.record(z.string(), z.string()).default({}) })
        .safeParse(JSON.parse(folder.read("package.json") ?? "{}"));
      const names = scripts.success ? Object.keys(scripts.data.scripts) : [];
      const updates = updateScripts(names);
      const environments = Object.keys(updates);
      return {
        certainty: "found",
        reason: "eas.json",
        ...(environments.length > 0 ? { environments } : {}),
        options: environments.length === 2 ? { update: updates } : {},
      };
    },
    questions: (_folder, found) =>
      found.update === undefined
        ? [
            {
              key: "update",
              message: "Package script that publishes an update?",
              initial: "eas:update",
            },
          ]
        : [],
    requirements: (unit) => [
      {
        label: "eas",
        check: { command: "pnpm", args: ["exec", "eas", "whoami"], cwd: unit.dir },
        fix: { command: "pnpm", args: ["exec", "eas", "login"], cwd: unit.dir },
        secrets: ["EXPO_TOKEN"],
      },
    ],
    env: easEnv,
    jobs: (input) => [buildJob(input), updateJob(input)],
    decide: (context, input) =>
      input.environment === entryOf(input.flow)
        ? entryDecision({ context, input })
        : usersDecision({ context, input }),
    // A running build counts: a retry would start a second one.
    live: async (context, input) =>
      input.environment === entryOf(input.flow)
        ? ["shipped", "wait"].includes((await entryState({ context, input })).ship)
        : ["shipped", "finish-rollout", "wait"].includes(
            (await usersState({ context, input })).decision,
          ),
    inspect: async (context, input) => {
      const { unit, environment, options } = input;
      const client = clientFor({ context, unit });
      const [analysis, lastUpdate] = await Promise.all([
        analyse({
          client,
          source: context.sourceControl,
          environment,
          flow: input.flow,
          version: binaryVersion({ root: context.root, unit, options, environment }),
          unit: unit.name,
        }),
        client.lastUpdate(environment),
      ]);
      const rollout = lastUpdate?.rolloutPercentage ?? 100;
      return {
        ...analysisJson(analysis),
        ...(rollout < 100 ? { rolloutPercentage: rollout } : {}),
      };
    },
    // Only an update has launch data: a binary got for this release reports nothing here.
    health: async (context, { unit, tag, environment }) => {
      const client = clientFor({ context, unit });
      const [last, tagged] = await Promise.all([
        client.lastUpdate(environment),
        context.sourceControl.tagCommit(tag),
      ]);
      if (!last || !tagged) return null;
      const { commit } = await client.updateOrigin({ group: last.group, environment });
      if (!commit || (await context.changedCode(unit, tagged, commit)).length > 0) return null;
      return updateHealth(
        await client.updateLaunches({ group: last.group, environment }),
        environment,
      );
    },
    beforeVersion,
  });
