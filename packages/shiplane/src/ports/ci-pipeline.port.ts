import type { ActionsMinutes } from "../domain/budget";
import type { Deploy } from "./code-host.port";

/** The workflow a repository ships from, calling shiplane's own, pinned to one shiplane release. */
export interface CallerWorkflow {
  /** Where it goes, as `workflowFile` places `shipWorkflow`. */
  file: string;
  content: string;
  /** The commit the release's tag points at, which its `uses:` line pins. */
  pin: string;
}

/** What the release a caller workflow ships needs from it. */
export interface CallerNeeds {
  /** The secrets its adapters read on a runner, by name, sorted; never `GH_TOKEN`. */
  secrets: readonly string[];
  /** The names of its features, such as `release-comments`. */
  features: readonly string[];
  /** What the runner's token must be allowed, on top of what every ship needs. */
  permissions?: Readonly<Record<string, "read" | "write">>;
  /** The file already there calls shiplane's reusable workflow: made the same way. */
  reusable?: boolean;
  /** Where its runs ship to, when it publishes packages; preview and production when absent. */
  environments?: readonly string[];
  /** The variables a ship reads from the CI's settings, by name, sorted. */
  variables?: readonly string[];
}

/** Why a pipeline won't say its minutes, where to read them, and what shows them next time. */
export interface MinutesBlocked {
  reason: string;
  /** The page that shows the numbers. */
  url: string;
  /** The command that grants the right; unset when only someone else can. */
  fix?: string;
}

/** Where workflows run: dispatched on a ref, their runs read back, the minutes they cost. */
export interface CiPipelinePort {
  /** The one workflow that ships on CI: `shiplane ship` on a runner, given units and an environment. */
  readonly shipWorkflow: string;
  /** A workflow's runs, each titled `Deploy <tag> to <environment>` when it deploys. */
  workflowRuns: (workflow: string) => Promise<Deploy[]>;
  /** `direct` runs it on the ref itself, never on the default branch checking the ref out. */
  dispatch: (
    workflow: string,
    ref: string,
    inputs: Record<string, string>,
    options?: { direct?: boolean },
  ) => Promise<void>;
  /** Whether a workflow file's `content` offers the environment; packages ship here when unset. */
  offers?: (content: string, environment: string) => boolean;
  /** This month's minutes, why they cannot be read, or null when the pipeline won't say. */
  minutes: () => Promise<ActionsMinutes | MinutesBlocked | null>;
  /** Billed minutes of a workflow's last successful runs. */
  measuredMinutes: (workflow: string) => Promise<number[]>;
  /** What a person calls this pipeline, such as `GitHub Actions`; `CI` when unset. */
  readonly label?: string;
  /** The command that lists its latest runs, as a person would type it; not shown when unset. */
  readonly runsLine?: string;
  /** Where a ref holds a workflow's file, checked before dispatching on it; unchecked when unset. */
  workflowFile?: (workflow: string) => string;
  /** The command a dry run prints for a dispatch, as a person would type it. */
  dispatchLine?: (workflow: string, ref: string, inputs: Record<string, string>) => string;
  /**
   * The caller workflow for shiplane `version`, passing only the secrets and permissions `needs`
   * says, or why there is none; unwritten when unset.
   */
  callerWorkflow?: (
    version: string,
    needs: CallerNeeds,
  ) => Promise<CallerWorkflow | { error: string }>;
}
