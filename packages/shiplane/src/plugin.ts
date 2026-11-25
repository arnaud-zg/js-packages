// What a plugin imports: the config API, then the ports, rules and helpers adapters build on.
export * from "./index";

export type {
  Command,
  DecideContext,
  Decision,
  Health,
  Job,
  JobInput,
  Refusal,
  Requirement,
  Resolved,
  ShipKind,
  VersionChoice,
} from "./ports/delivery.port";
export type { Deploy } from "./ports/code-host.port";
export type { Shell, ShellResult } from "./ports/shell.port";
export { CommandFailed } from "./ports/shell.port";
export { commandFailed, firstLine, mustCapture } from "./adapters/shell/must-capture";
export { retrying } from "./adapters/shell/retrying";
export type { ParsedJson } from "./adapters/parse-json";
export { parseJson } from "./adapters/parse-json";
export type { AfterShipContext, FollowUp, Shipped } from "./modules/module";
export type { CatalogEntry, MadeSlots, Slot, SlotPort } from "./ports/catalog.port";
export {
  adapterEntry,
  deliveryIn,
  featureEntry,
  moduleEntry,
  serviceIn,
} from "./application/config/catalog";
export type { AppBump, BumpLevel, PlannedChangeset, StatusPlan } from "./domain/changes";
export { appBumps } from "./domain/changes";
export type { GitPosition } from "./domain/governance";
export { releaseSource, yesAllowed } from "./domain/governance";
export type { IssueRef, LinkedPr } from "./domain/issues";
export { issueName } from "./domain/issues";
export { actionsMinutes, billedMinutes } from "./domain/budget";
export { capitalized, entryOf, previousOf, reachesUsers } from "./domain/environment";
export type { DeployFlow } from "./domain/environment";
export { deployRunTitle, deployState, onlyVersionFiles } from "./domain/deploys";
export type { RegistryFacts, RegistryShip } from "./domain/registry";
export { registryDecision } from "./domain/registry";
export { progressBar } from "./domain/display";
export {
  DEFAULT_TAG_FORMAT,
  isReleaseSubject,
  previousTag,
  TAG_FORMATS,
  tagName,
} from "./domain/tags";
export type { TagFormatName } from "./domain/tags";
export { compareVersions, nextPatch } from "./domain/versions";
export { expandPatterns, workspacePatterns } from "./application/config/workspaceFolders";
