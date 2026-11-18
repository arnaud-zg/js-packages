import { RecordingShell } from "shiplane/testing";
import { describe, expect, it } from "vitest";

import { gitHubActionsCiPipeline } from "../github-actions-ci-pipeline.adapter";
import { fakeGh } from "./gh.fake";

const pipeline = () =>
  gitHubActionsCiPipeline().create({ root: "/repo", shell: new RecordingShell() });

const pipelineOn = (gh: ReturnType<typeof fakeGh>) =>
  gitHubActionsCiPipeline().create({ root: "/repo", shell: gh.shell });

describe("shipping through a GitHub Actions workflow", () => {
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

  it("given no ship workflow named, when a project ships through GitHub Actions, then it uses ship.yml and doctor asks for gh to be signed in", () => {
    const adapter = gitHubActionsCiPipeline();

    expect(adapter.name).toBe("github-actions");
    expect(adapter.create({ root: "/repo", shell: new RecordingShell() }).shipWorkflow).toBe(
      "ship.yml",
    );
    expect(adapter.requirements?.()).toEqual([
      {
        label: "gh",
        check: { command: "gh", args: ["auth", "status"] },
        fix: { command: "gh", args: ["auth", "login"] },
      },
    ]);
  });

  it("given a ship workflow named, when a project ships through GitHub Actions, then it uses that one", () => {
    const port = gitHubActionsCiPipeline({ shipWorkflow: "deploy.yml" }).create({
      root: "/repo",
      shell: new RecordingShell(),
    });

    expect(port.shipWorkflow).toBe("deploy.yml");
  });
});

describe("knowing which versions a workflow already deployed", () => {
  it("given runs that succeeded, failed and are still going, when past deploys are read, then each counts as done, not shipped or running", async () => {
    const gh = fakeGh().seed(
      "run list",
      JSON.stringify([
        { displayTitle: "Deploy api@1.0.0 to preview", status: "completed", conclusion: "success" },
        { displayTitle: "Deploy api@1.0.1 to preview", status: "completed", conclusion: "failure" },
        { displayTitle: "Deploy api@1.0.2 to preview", status: "in_progress", conclusion: null },
        { displayTitle: "Deploy api@1.0.3 to preview", status: "queued", conclusion: "success" },
      ]),
    );

    await expect(pipelineOn(gh).workflowRuns("ship.yml")).resolves.toEqual([
      { title: "Deploy api@1.0.0 to preview", state: "done" },
      { title: "Deploy api@1.0.1 to preview", state: "none" },
      { title: "Deploy api@1.0.2 to preview", state: "running" },
      { title: "Deploy api@1.0.3 to preview", state: "running" },
    ]);
    expect(gh.calls).toEqual([
      {
        how: "capture",
        command: "gh",
        args: [
          "run",
          "list",
          "--workflow",
          "ship.yml",
          "--limit",
          "100",
          "--json",
          "displayTitle,status,conclusion",
        ],
        cwd: "/repo",
        input: undefined,
      },
    ]);
  });

  it("given a workflow not on the default branch yet, when past deploys are read, then there are none instead of an error", async () => {
    const gh = fakeGh().seed("run list", {
      status: 1,
      stderr: "could not find any workflows named ship.yml",
    });

    await expect(pipelineOn(gh).workflowRuns("ship.yml")).resolves.toEqual([]);
  });
});

describe("dispatching a workflow", () => {
  it("given a version to ship, when the workflow is dispatched, then gh runs it on that tag with each input", async () => {
    const gh = fakeGh();

    await pipelineOn(gh).dispatch("ship.yml", "api@1.0.0", {
      units: "api",
      environment: "preview",
    });

    expect(gh.args).toEqual([
      [
        "workflow",
        "run",
        "ship.yml",
        "--ref",
        "api@1.0.0",
        "-f",
        "units=api",
        "-f",
        "environment=preview",
      ],
    ]);
  });

  it("given GitHub refuses the dispatch, when the workflow is dispatched, then the ship fails saying why", async () => {
    const gh = fakeGh().seed("workflow run", { status: 1, stderr: "HTTP 422: no ref" });

    await expect(pipelineOn(gh).dispatch("ship.yml", "nope", {})).rejects.toThrow(
      "gh workflow run exited with 1: HTTP 422: no ref",
    );
  });
});

describe("checking a ship fits the GitHub Actions minutes budget", () => {
  it("given an organization on the team plan, when the minutes are read, then the month's usage is weighed against its allowance", async () => {
    const gh = fakeGh()
      .seed("api orgs/{owner}", "team\n")
      .seed(
        "api organizations/{owner}/settings/billing/usage/summary",
        JSON.stringify({
          usageItems: [
            { sku: "actions_linux", grossQuantity: 100, unitType: "minutes" },
            { sku: "actions_macos", grossQuantity: 10, unitType: "minutes" },
          ],
        }),
      );

    await expect(pipelineOn(gh).minutes()).resolves.toEqual({
      used: 200,
      included: 3000,
      left: 2800,
    });
    expect(gh.args).toEqual([
      ["api", "orgs/{owner}", "--jq", ".plan.name"],
      ["api", "organizations/{owner}/settings/billing/usage/summary"],
    ]);
  });

  it("given a personal account whose billing gh cannot read, when the minutes are read, then there is no budget", async () => {
    const gh = fakeGh().seed("api orgs/{owner}", { status: 1, stderr: "HTTP 404: Not Found" });

    await expect(pipelineOn(gh).minutes()).resolves.toBeNull();
  });

  it("given recent successful runs, when a ship's cost is measured, then each run bills its jobs rounded up to the minute", async () => {
    const gh = fakeGh()
      .seed("run list", '[{"databaseId":1},{"databaseId":2}]')
      .seed(
        "api repos/{owner}/{repo}/actions/runs/1/jobs",
        JSON.stringify([
          { startedAt: "2026-01-01T00:00:00Z", completedAt: "2026-01-01T00:02:30Z" },
          { startedAt: "2026-01-01T00:00:00Z", completedAt: "2026-01-01T00:00:10Z" },
        ]),
      )
      .seed(
        "api repos/{owner}/{repo}/actions/runs/2/jobs",
        JSON.stringify([{ startedAt: null, completedAt: null }]),
      );

    await expect(pipelineOn(gh).measuredMinutes("ship.yml")).resolves.toEqual([4, 0]);
    expect(gh.args).toEqual([
      [
        "run",
        "list",
        "--workflow",
        "ship.yml",
        "--status",
        "success",
        "--limit",
        "3",
        "--json",
        "databaseId",
      ],
      [
        "api",
        "repos/{owner}/{repo}/actions/runs/1/jobs",
        "--jq",
        "[.jobs[] | {startedAt: .started_at, completedAt: .completed_at}]",
      ],
      [
        "api",
        "repos/{owner}/{repo}/actions/runs/2/jobs",
        "--jq",
        "[.jobs[] | {startedAt: .started_at, completedAt: .completed_at}]",
      ],
    ]);
  });

  it("given runs gh cannot list, when a ship's cost is measured, then nothing is measured instead of failing", async () => {
    const gh = fakeGh().seed("run list", { status: 1, stderr: "HTTP 500" });

    await expect(pipelineOn(gh).measuredMinutes("ship.yml")).resolves.toEqual([]);
  });
});
