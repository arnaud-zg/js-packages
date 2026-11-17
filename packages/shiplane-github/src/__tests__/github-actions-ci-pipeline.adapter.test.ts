import { RecordingShell } from "shiplane/testing";
import { describe, expect, it } from "vitest";

import { gitHubActionsCiPipeline } from "../github-actions-ci-pipeline.adapter";

const pipeline = () =>
  gitHubActionsCiPipeline().create({ root: "/repo", shell: new RecordingShell() });

describe("what the core reads from GitHub Actions through the CI pipeline port", () => {
  it("given the pipeline, when a person reads it, then it is called GitHub Actions", () => {
    expect(pipeline().label).toBe("GitHub Actions");
  });

  it("given a workflow, when the core checks a ref holds it, then it looks under .github/workflows", () => {
    expect(pipeline().workflowFile?.("ship.yml")).toBe(".github/workflows/ship.yml");
  });

  it("given a dispatch, when a dry run prints it, then it is the gh command a person would type", () => {
    expect(
      pipeline().dispatchLine?.("ship.yml", "api@1.0.0", { units: "api", environment: "preview" }),
    ).toBe("gh workflow run ship.yml --ref api@1.0.0 -f units=api -f environment=preview");
  });
});
