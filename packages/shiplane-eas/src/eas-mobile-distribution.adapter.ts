import path from "node:path";
import type { DeliveryAdapter, MobileDistributionPort } from "shiplane/plugin";
import { defineMobileDistribution, z } from "shiplane/plugin";

import { analyse, analysisJson, updateHealth } from "./eas/analyse";
import { beforeVersion } from "./eas/before-version";
import { clientFor } from "./eas/client";
import { easEnv } from "./eas/env";
import { buildJob, updateJob } from "./eas/jobs";
import { EasOptions } from "./eas/options";
import { previewState } from "./eas/preview-state";
import { previewDecision } from "./eas/preview.decision";
import { productionDecision, productionState } from "./eas/production.decision";
import { binaryVersion } from "./eas/version-file";

/**
 * A mobile app on EAS. The native fingerprint decides between a new binary and an over-the-air
 * update; production ships what preview validated, moving its version by PR first when it must.
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
      const pick = (environment: string) =>
        [`eas:update:${environment}`, `eas:update:${environment}:gated`].find((name) =>
          names.includes(name),
        ) ?? names.find((name) => name.includes("update") && name.includes(environment));
      const [preview, production] = [pick("preview"), pick("production")];
      return {
        certainty: "found",
        reason: "eas.json",
        options: preview && production ? { update: { preview, production } } : {},
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
      input.environment === "preview"
        ? previewDecision({ context, input })
        : productionDecision({ context, input }),
    // A running build counts: a retry would start a second one.
    live: async (context, input) =>
      input.environment === "preview"
        ? ["shipped", "wait"].includes((await previewState({ context, input })).ship)
        : ["shipped", "finish-rollout", "wait"].includes(
            (await productionState({ context, input })).decision,
          ),
    inspect: async (context, input) => {
      const { unit, environment, options } = input;
      const client = clientFor({ context, unit });
      const [analysis, lastUpdate] = await Promise.all([
        analyse({
          client,
          source: context.sourceControl,
          environment,
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
    // Only an update has launch data: a binary preview got for this release reports nothing here.
    health: async (context, { unit, tag }) => {
      const client = clientFor({ context, unit });
      const [last, tagged] = await Promise.all([
        client.lastUpdate("preview"),
        context.sourceControl.tagCommit(tag),
      ]);
      if (!last || !tagged) return null;
      const { commit } = await client.updateOrigin({ group: last.group, environment: "preview" });
      if (!commit || (await context.changedCode(unit, tagged, commit)).length > 0) return null;
      return updateHealth(
        await client.updateLaunches({ group: last.group, environment: "preview" }),
      );
    },
    beforeVersion,
  });
