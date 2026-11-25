import { describe, expect, it } from "vitest";

import { CiPipelineFake } from "../../adapters/ci-pipeline/__fakes__/ci-pipeline.fake";
import { ciLabel, pathLabel } from "../askPath";

// A pipeline that names nothing: the core speaks of the port, never of a provider.
const bare = Object.assign(new CiPipelineFake(), { label: undefined });

describe("how a way to ship reads", () => {
  it("given a pipeline with a label, when the CI way is named, then it takes that label", () => {
    expect(pathLabel(new CiPipelineFake(), "ci")).toBe("Fake CI");
  });

  it("given a pipeline without a label, when the CI way is named, then it is just CI", () => {
    expect(ciLabel(bare)).toBe("CI");
    expect(pathLabel(bare, "ci")).toBe("CI");
  });

  it("given the local way, when it is named, then it is this machine whatever the pipeline", () => {
    expect(pathLabel(bare, "local")).toBe("this machine");
  });
});
