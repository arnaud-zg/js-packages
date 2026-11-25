import path from "node:path";
import type { DecideContext, Decision } from "shiplane/plugin";
import { capitalized, entryOf, tagName } from "shiplane/plugin";

import type { EasClient } from "./client";
import type { EasInput } from "./options";
import { analyse, rolloutLines, updateHealth } from "./analyse";
import { buildRefusal, refuse } from "./build-refusal";
import { clientFor } from "./client";
import { ROLLOUT_STEPS, rolloutAdvice, usersMobile } from "./decide";
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
      health: updateHealth(launches, environment),
    }),
    question: `How far should ${tag} go on ${environment}?`,
    suggested,
    options,
    held: `${tag} stays at ${percentage}% of people`,
  };
};

/** What users still need to run the version the environment before validated. */
export const usersState = async ({
  context,
  input,
}: {
  context: DecideContext;
  input: EasInput;
}) => {
  const { unit, options, environment, flow } = input;
  const client = clientFor({ context, unit });
  const usersVersion = binaryVersion({
    root: context.root,
    unit,
    options,
    environment,
  });
  const analysis = await analyse({
    client,
    source: context.sourceControl,
    environment,
    flow,
    version: usersVersion,
    unit: unit.name,
  });
  const version = unit.version;
  const tag = await context.sourceControl.tagCommit(tagName(unit.name, version, context.tagFormat));
  const codeSince = (commit: string) => (tag ? context.changedCode(unit, tag, commit) : []);
  const sinceTag = async (commit: string | null) =>
    tag !== null && commit !== null && (await codeSince(commit)).length === 0;
  const action = analysis.plan.action;
  const lastUpdate = tag && action === "update" ? await client.lastUpdate(environment) : null;
  const origin = lastUpdate
    ? await client.updateOrigin({ group: lastUpdate.group, environment })
    : null;
  const updateCommit = origin?.commit ?? null;
  const shippedCommits = [
    ...analysis.checked.map(({ state }) => state.shipped?.gitCommit ?? null),
    updateCommit,
  ];
  const builtVersion = analysis.checked[0]?.state.shipped?.appVersion ?? null;
  const shippedAny = (await Promise.all(shippedCommits.map(sinceTag))).some(Boolean);
  const rollout = lastUpdate?.rolloutPercentage ?? 100;
  const decision = usersMobile(action, {
    tagged: tag !== null,
    sinceTagOnlyVersionFiles: await sinceTag(analysis.git.head),
    expoVersion: version,
    usersVersion,
    codeShipped: action === "submit" || shippedAny,
    builtVersion,
    partialRollout: rollout < 100 && (await sinceTag(updateCommit)),
  });
  return {
    analysis,
    client,
    codeSince,
    usersVersion,
    builtVersion,
    lastUpdate,
    origin,
    rollout,
    decision,
  };
};

/** The PR that moves users' binary version to the one validated before them. */
const promotion = ({ context, input }: { context: DecideContext; input: EasInput }): Decision => {
  const { unit, options, environment } = input;
  const first = entryOf(input.flow);
  const version = unit.version;
  return {
    action: "pull-request",
    question: `Open the PR that moves ${environment} to ${unit.name} ${version}?`,
    branch: `chore/promote-${unit.name}-${version}`,
    title: `chore(release): ${environment} builds ${unit.name} ${version}`,
    body: [
      "## 🎯 What & why",
      "",
      `${capitalized(environment)} builds ${unit.name} ${version}, the version ${first} validated: \`${path.posix.join(unit.dir, options.versionFile)}\` ${environment} moves to it, the runtime version ${environment} updates target. Merge it, then \`release --channel ${environment}\` builds.`,
      "",
      "## ✅ Testing",
      "",
      "Version file only. No UI change.",
    ].join("\n"),
    changesets: [],
    write: () =>
      Promise.resolve([
        setBinaryVersion({ root: context.root, unit, options, environment, version }),
      ]),
  };
};

export const usersDecision = async ({
  context,
  input,
}: {
  context: DecideContext;
  input: EasInput;
}): Promise<Decision> => {
  const { unit, environment } = input;
  const first = entryOf(input.flow);
  const version = unit.version;
  const state = await usersState({ context, input });
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
        status: `${unit.name} ${state.usersVersion} is building on EAS, submitted to the stores when done`,
      };
    case "shipped":
      return {
        action: "none",
        status: `${unit.name} ${state.builtVersion ?? version} is live`,
      };
    case "nothing":
      return {
        action: "none",
        status: `No ${unit.name} release to promote yet: release to ${first} first.`,
      };
    case "behind":
      return refuse({
        title: "main is behind",
        detail: `the last ${environment} build carries a newer version.`,
        commands: ["git pull"],
      });
    case "moved-past":
      return refuse({
        title: `main moved past ${tagName(unit.name, version, context.tagFormat)}`,
        detail: `${environment} ships what ${first} validated, and ${fewFiles(await codeSince(analysis.git.head))} changed since, code ${first} never ran: release it to ${first} first.`,
        commands: ["pnpm changeset", "shiplane"],
      });
  }
};
