import type { ActionsMinutes } from "../../../domain/budget";
import type { ServiceAdapter } from "../../../ports/adapter.port";
import type { CiPipelinePort, MinutesBlocked, PipelineRun } from "../../../ports/ci-pipeline.port";
import type { Deploy } from "../../../ports/code-host.port";

interface PipelineState {
  workflowRuns: Record<string, Deploy[]>;
  minutes: ActionsMinutes | MinutesBlocked | null;
  measured: Record<string, number[]>;
  /** Whether each run a dispatch starts shows up to watch; true unless seeded. */
  showsRuns: boolean;
  /** How each watched run ends, by id; succeeded unless seeded. */
  outcomes: Record<string, boolean>;
}

export interface Dispatched {
  type: "dispatch";
  workflow: string;
  ref: string;
  inputs: Record<string, string>;
}

/** A CI pipeline held in memory: seed its runs and minutes, read back what was dispatched. */
export class CiPipelineFake implements CiPipelinePort {
  private state: PipelineState = {
    workflowRuns: {},
    minutes: null,
    measured: {},
    showsRuns: true,
    outcomes: {},
  };

  readonly received: Dispatched[] = [];
  /** The runs followed live, by id, in order. */
  readonly watched: string[] = [];

  constructor(readonly shipWorkflow = "ship.yml") {}

  // Names no provider: what the core says comes from the port, whatever the pipeline.
  readonly label = "Fake CI";
  readonly runsLine = "fake-ci runs";
  offers = (content: string, environment: string) => content.split(" ").includes(environment);
  workflowFile = (workflow: string) => `ci/${workflow}`;
  dispatchLine = (workflow: string, ref: string, inputs: Record<string, string>) =>
    [
      `fake-ci run ${workflow} --ref ${ref}`,
      ...Object.entries(inputs).map(([key, value]) => `-f ${key}=${value}`),
    ].join(" ");

  seed(state: Partial<PipelineState>) {
    this.state = { ...this.state, ...state };
    return this;
  }

  workflowRuns = (workflow: string) => Promise.resolve(this.state.workflowRuns[workflow] ?? []);

  dispatch = (workflow: string, ref: string, inputs: Record<string, string>) => {
    this.received.push({ type: "dispatch", workflow, ref, inputs });
    return Promise.resolve();
  };

  /** Each dispatch starts run `run-<n>`, titled after its inputs; the clock is not read. */
  startedRuns = (workflow: string): Promise<PipelineRun[]> =>
    Promise.resolve(
      this.state.showsRuns
        ? this.received.flatMap((dispatched, index) =>
            dispatched.workflow === workflow
              ? [
                  {
                    id: `run-${index + 1}`,
                    title: `Ship ${dispatched.inputs.units ?? ""} to ${dispatched.inputs.environment ?? ""}`,
                    url: `https://ci.example/runs/${index + 1}`,
                  },
                ]
              : [],
          )
        : [],
    );

  watch = (run: PipelineRun) => {
    this.watched.push(run.id);
    return Promise.resolve(this.state.outcomes[run.id] ?? true);
  };

  watchLine = (run: PipelineRun) => `fake-ci watch ${run.id}`;

  minutes = () => Promise.resolve(this.state.minutes);
  measuredMinutes = (workflow: string) => Promise.resolve(this.state.measured[workflow] ?? []);
}

/** The Fake as a config holds an adapter; `.fake` is what a test seeds and reads. */
export const ciPipelineFake = (
  fake = new CiPipelineFake(),
): ServiceAdapter<CiPipelinePort> & { fake: CiPipelineFake } => ({
  name: "fake",
  create: () => fake,
  fake,
});
