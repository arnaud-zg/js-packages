import type { DecideContext } from "shiplane/plugin";
import { tagName } from "shiplane/plugin";

import type { EasInput } from "./options";
import { analyse } from "./analyse";
import { clientFor } from "./client";
import { mobileShip } from "./decide";
import { binaryVersion } from "./version-file";

/** What preview still needs for the tagged version, from its builds and last update. */
export const previewState = async ({
  context,
  input,
}: {
  context: DecideContext;
  input: EasInput;
}) => {
  const { unit, options } = input;
  const client = clientFor({ context, unit });
  const analysis = await analyse({
    client,
    source: context.sourceControl,
    environment: "preview",
    version: binaryVersion({ root: context.root, unit, options, environment: "preview" }),
    unit: unit.name,
  });
  const version = unit.version;
  const tag = await context.sourceControl.tagCommit(tagName(unit.name, version, context.tagFormat));
  const codeSince = (commit: string) => (tag ? context.changedCode(unit, tag, commit) : []);
  const sinceTag = async (commit: string | null) =>
    tag !== null && commit !== null && (await codeSince(commit)).length === 0;
  const builtFrom = analysis.checked.map(({ state }) => state.shipped?.gitCommit ?? null);
  const lastBuildCommit = builtFrom.every((commit) => commit === builtFrom[0])
    ? (builtFrom[0] ?? null)
    : null;
  const atTag = await sinceTag(analysis.git.head);
  // Once main moved on, whether the tag's update already went out decides a retry too.
  const lastUpdate =
    tag && (analysis.plan.action === "update" || !atTag)
      ? await client.lastUpdate("preview")
      : null;
  const lastUpdateCommit = lastUpdate
    ? (await client.updateOrigin({ group: lastUpdate.group, environment: "preview" })).commit
    : null;
  const updatedFromTag = await sinceTag(lastUpdateCommit);
  const ship = mobileShip(analysis.plan.action, {
    tagged: tag !== null,
    codeSinceTag: tag !== null && !atTag,
    codeShipped:
      analysis.plan.action === "update" && ((await sinceTag(lastBuildCommit)) || updatedFromTag),
  });
  return { analysis, client, codeSince, sinceTag, ship, tag, atTag, updatedFromTag };
};

export type PreviewState = Awaited<ReturnType<typeof previewState>>;
