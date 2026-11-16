import { expect, it } from "vitest";

import type { ReleaseUnit } from "../domain/unit";
import type { DecideContext, Decision, JobInput } from "../ports/delivery.port";
import { CiPipelineFake } from "../adapters/ci-pipeline/__fakes__/ci-pipeline.fake";
import { CodeHostFake } from "../adapters/code-host/__fakes__/code-host.fake";
import { RecordingShell } from "../adapters/shell/__fakes__/shell.fake";
import { SourceControlFake } from "../adapters/source-control/__fakes__/source-control.fake";
import { DEFAULT_TAG_FORMAT } from "../domain/tags";

type Input = JobInput<Record<string, unknown>>;

/** A port whose own platform decides what ships, such as a registry or a mobile distribution. */
interface Decides {
  decide: (context: DecideContext, input: Input) => Promise<Decision>;
  live?: (context: DecideContext, input: Input) => Promise<boolean>;
}

const ACTIONS: ReadonlySet<Decision["action"]> = new Set([
  "ship",
  "none",
  "choose",
  "fail",
  "pull-request",
]);

export const decides = (port: object): port is Decides =>
  "decide" in port && typeof port.decide === "function";

/** A repository with nothing tagged yet, its tools answering empty, on the contract's fakes. */
const freshContext = (unit: ReleaseUnit): DecideContext => {
  const shell = new RecordingShell();
  return {
    root: "/repo",
    shell,
    sourceControl: new SourceControlFake(),
    codeHost: new CodeHostFake(),
    ciPipeline: new CiPipelineFake(),
    units: [unit],
    tagFormat: DEFAULT_TAG_FORMAT,
    versionFiles: new Set(),
    changedCode: () => Promise.resolve([]),
    now: () => new Date("2026-01-01T00:00:00Z"),
    open: (adapter) => adapter.create({ root: "/repo", shell }),
  };
};

/** What a deciding port does on a repository with nothing tagged: it says so, and nothing is live. */
export const decideContract = ({
  port,
  unit,
  input,
}: {
  port: Decides;
  unit: ReleaseUnit;
  input: Input;
}) => {
  it("given a version never tagged, when the adapter decides, then it answers one of the decisions the release flow knows", async () => {
    const decision = await port.decide(freshContext(unit), input);

    expect(ACTIONS.has(decision.action)).toBe(true);
  });

  it("given a version never tagged, when the adapter says whether it is live, then it is not", async () => {
    expect(await (port.live?.(freshContext(unit), input) ?? false)).toBe(false);
  });
};
