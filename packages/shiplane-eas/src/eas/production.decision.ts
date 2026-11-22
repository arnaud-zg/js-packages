import path from "node:path";
import type { DecideContext, Decision } from "shiplane/plugin";
import { tagName } from "shiplane/plugin";

import type { EasClient } from "./client";
import type { EasInput } from "./options";
import { analyse, rolloutLines, updateHealth } from "./analyse";
import { buildRefusal, refuse } from "./build-refusal";
import { clientFor } from "./client";
import { productionMobile, ROLLOUT_STEPS, rolloutAdvice } from "./decide";
import { buildJob, rolloutJob, updateJob } from "./jobs";
import { binaryVersion, setBinaryVersion } from "./version-file";
import { fewFiles } from "./wording";

/** Where an update reaching part of the channel stands, and each way it can go from there. */
const rolloutChoice = async ({
  context,
  client,
  input,
  update,
}: {
  context: DecideContext;
  client: EasClient;
  input: EasInput;
  update: { group: string; percentage: number; createdAt: string | null };
}): Promise<Decision> => {
  const { tag, environment } = input;
  const { group, percentage } = update;
  const launches = await client.updateLaunches({ group, environment });
  const hoursOut = update.createdAt
    ? (context.now().getTime() - new Date(update.createdAt).getTime()) / 3_600_000
    : 0;
  const advice = rolloutAdvice({
    percentage,
    launches: launches.reduce((sum, { installs }) => sum + installs, 0),
    crashes: launches.reduce((sum, { failedInstalls }) => sum + failedInstalls, 0),
    hoursOut,
  });
  const suggested = String(advice.suggested);
  const widen = (to: number) =>
    rolloutJob({
      input,
      label: `widen the ${tag} rollout on ${environment}: ${percentage}% → ${to}%`,
      args: ["update:edit", group, "--rollout-percentage", String(to)],
    });
  const options = [
    ...ROLLOUT_STEPS.filter((step) => step > percentage).map((step) => ({
      value: String(step),
      label: step === 100 ? "Everyone" : `${step}% of people`,
      hint: step === 100 ? "finishes the rollout" : undefined,
      jobs: [widen(step)],
    })),
    {
      value: "stay",
      label: `Stay at ${percentage}%`,
      hint: "nothing changes, check again later",
      jobs: [],
    },
    {
      value: "roll-back",
      label: "Roll back",
      hint: "people on it go back to the update before",
      jobs: [
        rolloutJob({
          input,
          label: `roll back the ${tag} rollout on ${environment}`,
          args: ["update:revert-update-rollout", "--group", group],
        }),
      ],
    },
  ].map((option) =>
    option.value === suggested
      ? { ...option, label: `${option.label} (suggested)`, hint: advice.why }
      : option,
  );
  return {
    action: "choose",
    lines: rolloutLines({
      tag,
      environment,
      percentage,
      hoursOut,
      health: updateHealth(launches),
    }),
    question: `How far should ${tag} go on ${environment}?`,
    suggested,
    options,
    held: `${tag} stays at ${percentage}% of people`,
  };
};

/** What production still needs to run the version preview validated. */
export const productionState = async ({
  context,
  input,
}: {
  context: DecideContext;
  input: EasInput;
}) => {
  const { unit, options } = input;
  const client = clientFor({ context, unit });
  const productionVersion = binaryVersion({
    root: context.root,
    unit,
    options,
    environment: "production",
  });
  const analysis = await analyse({
    client,
    source: context.sourceControl,
    environment: "production",
    version: productionVersion,
    unit: unit.name,
  });
  const version = unit.version;
  const tag = await context.sourceControl.tagCommit(tagName(unit.name, version, context.tagFormat));
  const codeSince = (commit: string) => (tag ? context.changedCode(unit, tag, commit) : []);
  const sinceTag = async (commit: string | null) =>
    tag !== null && commit !== null && (await codeSince(commit)).length === 0;
  const action = analysis.plan.action;
  const lastUpdate = tag && action === "update" ? await client.lastUpdate("production") : null;
  const origin = lastUpdate
    ? await client.updateOrigin({ group: lastUpdate.group, environment: "production" })
    : null;
  const updateCommit = origin?.commit ?? null;
  const shippedCommits = [
    ...analysis.checked.map(({ state }) => state.shipped?.gitCommit ?? null),
    updateCommit,
  ];
  const builtVersion = analysis.checked[0]?.state.shipped?.appVersion ?? null;
  const shippedAny = (await Promise.all(shippedCommits.map(sinceTag))).some(Boolean);
  const rollout = lastUpdate?.rolloutPercentage ?? 100;
  const decision = productionMobile(action, {
    tagged: tag !== null,
    sinceTagOnlyVersionFiles: await sinceTag(analysis.git.head),
    expoVersion: version,
    productionVersion,
    codeShipped: action === "submit" || shippedAny,
    builtVersion,
    partialRollout: rollout < 100 && (await sinceTag(updateCommit)),
  });
  return {
    analysis,
    client,
    codeSince,
    productionVersion,
    builtVersion,
    lastUpdate,
    origin,
    rollout,
    decision,
  };
};

/** The PR that moves production's binary version to the one preview validated. */
const promotion = ({ context, input }: { context: DecideContext; input: EasInput }): Decision => {
  const { unit, options } = input;
  const version = unit.version;
  return {
    action: "pull-request",
    question: `Open the PR that moves production to ${unit.name} ${version}?`,
    branch: `chore/promote-${unit.name}-${version}`,
    title: `chore(release): production builds ${unit.name} ${version}`,
    body: [
      "## 🎯 What & why",
      "",
      `Production builds ${unit.name} ${version}, the version preview validated: \`${path.posix.join(unit.dir, options.versionFile)}\` production moves to it, the runtime version production updates target. Merge it, then \`release --channel production\` builds.`,
      "",
      "## ✅ Testing",
      "",
      "Version file only. No UI change.",
    ].join("\n"),
    changesets: [],
    write: () =>
      Promise.resolve([
        setBinaryVersion({ root: context.root, unit, options, environment: "production", version }),
      ]),
  };
};

export const productionDecision = async ({
  context,
  input,
}: {
  context: DecideContext;
  input: EasInput;
}): Promise<Decision> => {
  const { unit } = input;
  const version = unit.version;
  const state = await productionState({ context, input });
  const { analysis, client, codeSince, lastUpdate, rollout } = state;
  switch (state.decision) {
    case "finish-rollout":
      return lastUpdate
        ? rolloutChoice({
            context,
            client,
            input,
            update: {
              group: lastUpdate.group,
              percentage: rollout,
              createdAt: state.origin?.createdAt ?? null,
            },
          })
        : { action: "none", status: `${unit.name} ${version} is live` };
    case "promote":
      return promotion({ context, input });
    case "update":
      return { action: "ship", kind: "update", jobs: [updateJob(input, context.root)] };
    case "build": {
      const refusal = await buildRefusal({ context, analysis, input });
      return refusal ? refuse(refusal) : { action: "ship", kind: "build", jobs: [buildJob(input)] };
    }
    case "wait":
      return {
        action: "none",
        status: `${unit.name} ${state.productionVersion} is building on EAS, submitted to the stores when done`,
      };
    case "shipped":
      return {
        action: "none",
        status: `${unit.name} ${state.builtVersion ?? version} is live`,
      };
    case "nothing":
      return {
        action: "none",
        status: `No ${unit.name} release to promote yet: release to preview first.`,
      };
    case "behind":
      return refuse({
        title: "main is behind",
        detail: "the last production build carries a newer version.",
        commands: ["git pull"],
      });
    case "moved-past":
      return refuse({
        title: `main moved past ${tagName(unit.name, version, context.tagFormat)}`,
        detail: `production ships what preview validated, and ${fewFiles(await codeSince(analysis.git.head))} changed since, code preview never ran: release it to preview first.`,
        commands: ["pnpm changeset", "shiplane"],
      });
  }
};
