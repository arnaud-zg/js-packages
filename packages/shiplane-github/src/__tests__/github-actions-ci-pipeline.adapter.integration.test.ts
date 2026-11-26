import { RecordingShell } from "shiplane/testing";
import { describe, expect, it } from "vitest";

import { gitHubActionsCiPipeline } from "../github-actions-ci-pipeline.adapter";
import { fakeGh } from "./gh.fake";

const pipeline = () =>
  gitHubActionsCiPipeline().create({ root: "/repo", shell: new RecordingShell() });

const pipelineOn = (gh: ReturnType<typeof fakeGh>) =>
  gitHubActionsCiPipeline().create({ root: "/repo", shell: gh.shell });

describe("shipping through a GitHub Actions workflow", () => {
  it("given the pipeline, when a person reads it, then it is called GitHub Actions and lists its runs with gh", () => {
    expect(pipeline().label).toBe("GitHub Actions");
    expect(pipeline().runsLine).toBe("gh run list --limit 5");
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
        secrets: ["GH_TOKEN"],
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
  const MAIN_CALLER = [
    "jobs:",
    "  ship:",
    "    uses: arnaud-zg/js-packages/.github/actions/ship@abc # shiplane@1.0.0",
    "    with:",
    "      units: ${{ inputs.units }}",
    "      ref: ${{ inputs.ref }}",
  ].join("\n");
  const runs = (gh: ReturnType<typeof fakeGh>) =>
    gh.args.filter(([command, action]) => command === "workflow" && action === "run");

  it("given main's caller passes the tag on, when a tag is shipped, then the run starts on main with today's workflow and checks out the tag", async () => {
    const gh = fakeGh()
      .seed("repo view", "main\n")
      .seed("api repos/{owner}/{repo}/contents/.github/workflows/ship.yml?ref=main", MAIN_CALLER);

    await pipelineOn(gh).dispatch("ship.yml", "api@1.0.0", {
      units: "api",
      environment: "preview",
    });

    expect(runs(gh)).toEqual([
      [
        "workflow",
        "run",
        "ship.yml",
        "--ref",
        "main",
        "-f",
        "units=api",
        "-f",
        "environment=preview",
        "-f",
        "ref=api@1.0.0",
      ],
    ]);
  });

  it("given main's caller predates the tag input, when a tag is shipped, then gh runs it on that tag with each input", async () => {
    const gh = fakeGh()
      .seed("repo view", "main\n")
      .seed("api repos/", MAIN_CALLER.replace("      ref: ${{ inputs.ref }}", ""));

    await pipelineOn(gh).dispatch("ship.yml", "api@1.0.0", {
      units: "api",
      environment: "preview",
    });

    expect(runs(gh)).toEqual([
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

  it("given GitHub cannot say what main holds, when a tag is shipped, then gh runs it on that tag", async () => {
    const gh = fakeGh().seed("repo view", { status: 1, stderr: "HTTP 404" });

    await pipelineOn(gh).dispatch("ship.yml", "api@1.0.0", { units: "api" });

    expect(runs(gh)).toEqual([
      ["workflow", "run", "ship.yml", "--ref", "api@1.0.0", "-f", "units=api"],
    ]);
  });

  it("given main itself is shipped, when the workflow is dispatched, then it runs on main with no tag to check out", async () => {
    const gh = fakeGh().seed("repo view", "main\n").seed("api repos/", MAIN_CALLER);

    await pipelineOn(gh).dispatch("ship.yml", "main", { units: "api" });

    expect(runs(gh)).toEqual([["workflow", "run", "ship.yml", "--ref", "main", "-f", "units=api"]]);
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
      .seed("api users/{owner} --jq", JSON.stringify({ login: "acme", type: "Organization" }))
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
      ["api", "users/{owner}", "--jq", "{login, type}"],
      ["api", "organizations/{owner}/settings/billing/usage/summary"],
      ["api", "orgs/{owner}", "--jq", ".plan.name"],
    ]);
  });

  const owner = (login: string, type: string) =>
    fakeGh()
      .seed("api users/{owner} --jq", JSON.stringify({ login, type }))
      .seed("api user --jq .login", "ada\n")
      .seed("api user --jq .plan.name", "pro\n");
  const BILLING = "api users/{owner}/settings/billing/usage/summary";
  const ORG_BILLING = "api organizations/{owner}/settings/billing/usage/summary";
  const needing = (scope: string) => ({
    status: 1,
    stderr: `gh: Not Found (HTTP 404)\ngh: This API operation needs the "${scope}" scope. To request it, run:  gh auth refresh -h github.com -s ${scope}\n`,
  });

  it("given a personal account, when the minutes are read, then its own billing is weighed against its plan", async () => {
    const gh = owner("ada", "User").seed(
      BILLING,
      JSON.stringify({
        usageItems: [{ sku: "actions_linux", grossQuantity: 54, unitType: "minutes" }],
      }),
    );

    await expect(pipelineOn(gh).minutes()).resolves.toEqual({
      used: 54,
      included: 3000,
      left: 2946,
    });
  });

  it("given a personal account and a token without its scope, when the minutes are read, then the scope is named with the command that grants it", async () => {
    const gh = owner("ada", "User").seed(BILLING, needing("user"));

    await expect(pipelineOn(gh).minutes()).resolves.toEqual({
      reason: 'gh needs the "user" scope to read them.',
      url: "https://github.com/settings/billing",
      fix: "gh auth refresh -h github.com -s user",
    });
  });

  it("given an organization and a token without its scope, when the minutes are read, then the scope is named with the command that grants it", async () => {
    const gh = owner("acme", "Organization").seed(ORG_BILLING, needing("admin:org"));

    await expect(pipelineOn(gh).minutes()).resolves.toEqual({
      reason: 'gh needs the "admin:org" scope to read them.',
      url: "https://github.com/organizations/acme/settings/billing",
      fix: "gh auth refresh -h github.com -s admin:org",
    });
  });

  it("given an organization whose billing this account may not read, when the minutes are read, then it says so with no command", async () => {
    const gh = owner("acme", "Organization").seed(ORG_BILLING, {
      status: 1,
      stderr: "gh: Forbidden (HTTP 403)",
    });

    await expect(pipelineOn(gh).minutes()).resolves.toEqual({
      reason: "GitHub does not let this account read the billing of acme.",
      url: "https://github.com/organizations/acme/settings/billing",
    });
  });

  it("given someone else's personal account, when the minutes are read, then no scope is asked for", async () => {
    const gh = owner("bob", "User").seed(BILLING, needing("user"));

    await expect(pipelineOn(gh).minutes()).resolves.toBeNull();
  });

  it("given billing failing for another reason, when the minutes are read, then there is no budget and no scope is asked for", async () => {
    const gh = owner("ada", "User").seed(BILLING, { status: 1, stderr: "gh: (HTTP 500)" });

    await expect(pipelineOn(gh).minutes()).resolves.toBeNull();
  });

  it("given GitHub cannot say who owns the repository, when the minutes are read, then there is no budget", async () => {
    const gh = fakeGh().seed("api users/{owner}", { status: 1, stderr: "gh: (HTTP 500)" });

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

const REF = "api repos/arnaud-zg/js-packages/git/ref/tags/shiplane@0.6.0";
const COMMIT = "c0ffee0000000000000000000000000000000000";

/** The ship.yml a repository calls shiplane's workflow from, word for word. */
const CALLER = `# Ships with shiplane: \`pnpm shiplane ship --via ci\`, or Run workflow here.
# Written by \`shiplane setup\`; \`shiplane doctor\` keeps the pin current.
name: Ship
run-name: Ship to \${{ inputs.environment }}\${{ inputs.dry-run && ' (dry run)' || '' }}

on:
  workflow_dispatch:
    inputs:
      units:
        description: "Units to ship, space separated (empty: every unit the environment lacks)"
        type: string
        default: ""
      environment:
        description: "Where to ship the ref this runs on"
        type: choice
        options: [preview, production]
        default: preview
      ref:
        description: "The tag to ship; shiplane sets it (empty: the ref this runs on)"
        type: string
        default: ""
      dry-run:
        description: "Show what would ship, ship nothing"
        type: boolean
        default: false

permissions:
  contents: read
  deployments: write
  actions: read
  issues: write
  pull-requests: write

jobs:
  ship:
    name: Ship to \${{ inputs.environment }}
    runs-on: ubuntu-26.04
    # A dry run reads the environment's secrets and records no deployment.
    environment:
      name: \${{ inputs.environment }}
      deployment: \${{ !inputs.dry-run }}
    concurrency:
      group: ship-\${{ inputs.environment }}
      cancel-in-progress: false
    steps:
      - uses: actions/checkout@v5
        with:
          ref: \${{ contains(fromJSON('["preview", "production"]'), inputs.environment) && inputs.ref || '' }}
          fetch-depth: 0
      - uses: arnaud-zg/js-packages/.github/actions/ship@${COMMIT} # shiplane@0.6.0
        with:
          units: \${{ inputs.units }}
          environment: \${{ inputs.environment }}
          dry-run: \${{ inputs.dry-run }}
          CLOUDFLARE_ACCOUNT_ID: \${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
`;

/** A release shipping to Cloudflare Pages, commenting on what it ships. */
const NEEDS = {
  apps: ["preview", "production"],
  environments: ["preview", "production"],
  secrets: ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"],
  features: ["release-comments"],
};

describe("writing the workflow a repository ships from", () => {
  it("given a lightweight release tag, when the caller workflow is made, then it pins the commit the tag names", async () => {
    const gh = fakeGh().seed(REF, JSON.stringify({ object: { sha: COMMIT, type: "commit" } }));

    const made = await pipelineOn(gh).callerWorkflow?.("0.6.0", NEEDS);

    expect(made).toEqual({ file: ".github/workflows/ship.yml", content: CALLER, pin: COMMIT });
    expect(gh.args).toEqual([REF.split(" ")]);
  });

  it("given an annotated release tag, when the caller workflow is made, then it pins the commit behind the tag object", async () => {
    const gh = fakeGh()
      .seed(REF, JSON.stringify({ object: { sha: "7a90000", type: "tag" } }))
      .seed(
        "api repos/arnaud-zg/js-packages/git/tags/7a90000",
        JSON.stringify({ object: { sha: COMMIT, type: "commit" } }),
      );

    const made = await pipelineOn(gh).callerWorkflow?.("0.6.0", NEEDS);

    expect(made).toEqual({ file: ".github/workflows/ship.yml", content: CALLER, pin: COMMIT });
    expect(gh.args[1]).toEqual(["api", "repos/arnaud-zg/js-packages/git/tags/7a90000"]);
  });

  it("given a release whose adapters read no secret, when the caller workflow is made, then it passes none", async () => {
    const gh = fakeGh().seed(REF, JSON.stringify({ object: { sha: COMMIT, type: "commit" } }));

    const made = await pipelineOn(gh).callerWorkflow?.("0.6.0", { ...NEEDS, secrets: [] });

    expect(made).toMatchObject({
      content: CALLER.slice(0, CALLER.indexOf("          CLOUDFLARE_ACCOUNT_ID")),
    });
    expect(made && "content" in made && made.content).not.toContain("secrets.");
  });

  it("given a release without release comments, when the caller workflow is made, then it may not write to issues or pull requests", async () => {
    const gh = fakeGh().seed(REF, JSON.stringify({ object: { sha: COMMIT, type: "commit" } }));

    const made = await pipelineOn(gh).callerWorkflow?.("0.6.0", { ...NEEDS, features: [] });

    expect(made).toMatchObject({
      content: CALLER.replace("  issues: write\n  pull-requests: write\n", ""),
    });
  });

  it("given a ship workflow named, when the caller workflow is made, then it goes in that file", async () => {
    const gh = fakeGh().seed(REF, JSON.stringify({ object: { sha: COMMIT, type: "commit" } }));
    const port = gitHubActionsCiPipeline({ shipWorkflow: "deploy.yml" }).create({
      root: "/repo",
      shell: gh.shell,
    });

    expect(await port.callerWorkflow?.("0.6.0", NEEDS)).toMatchObject({
      file: ".github/workflows/deploy.yml",
    });
  });

  it("given no release tag for the version, when the caller workflow is made, then it says to pin by hand", async () => {
    const gh = fakeGh().seed(REF, { status: 1, stderr: "gh: Not Found (HTTP 404)\n" });

    expect(await pipelineOn(gh).callerWorkflow?.("0.6.0", NEEDS)).toEqual({
      error: "no release tag shiplane@0.6.0: pin ship.yml by hand",
    });
  });

  it("given a test version, when the caller workflow is made, then it pins the commit its short sha names", async () => {
    const gh = fakeGh().seed(
      "api repos/arnaud-zg/js-packages/commits/329aafb",
      JSON.stringify({ sha: COMMIT }),
    );

    const made = await pipelineOn(gh).callerWorkflow?.("0.6.0-main.329aafb", NEEDS);

    expect(made).toEqual({
      file: ".github/workflows/ship.yml",
      content: CALLER.replace("# shiplane@0.6.0", "# shiplane@0.6.0-main.329aafb"),
      pin: COMMIT,
    });
    expect(gh.args).toEqual([["api", "repos/arnaud-zg/js-packages/commits/329aafb"]]);
  });

  it("given a test version whose short sha reads as a number, when the caller workflow is made, then it looks up the sha without its g", async () => {
    const gh = fakeGh().seed(
      "api repos/arnaud-zg/js-packages/commits/0123456",
      JSON.stringify({ sha: COMMIT }),
    );

    expect(await pipelineOn(gh).callerWorkflow?.("0.6.0-feat-x.g0123456", NEEDS)).toMatchObject({
      pin: COMMIT,
    });
  });

  it("given a test version whose commit GitHub does not know, when the caller workflow is made, then it says to pin by hand", async () => {
    const gh = fakeGh().seed("api repos/arnaud-zg/js-packages/commits/329aafb", {
      status: 1,
      stderr: "gh: No commit found for SHA: 329aafb (HTTP 422)\n",
    });

    expect(await pipelineOn(gh).callerWorkflow?.("0.6.0-main.329aafb", NEEDS)).toEqual({
      error: "no commit 329aafb for shiplane@0.6.0-main.329aafb: pin ship.yml by hand",
    });
  });

  it("given GitHub failing for another reason, when the caller workflow is made, then the failure is raised", async () => {
    const gh = fakeGh().seed(REF, { status: 1, stderr: "gh: Bad credentials (HTTP 401)\n" });

    await expect(pipelineOn(gh).callerWorkflow?.("0.6.0", NEEDS)).rejects.toThrow(
      "exited with 1: gh: Bad credentials (HTTP 401)",
    );
  });
});

describe("what a caller workflow offers", () => {
  it.each([
    ["inline", "options: [snapshot, latest]", true],
    ["one per line", "options:\n  - snapshot\n  - latest\n", true],
    ["only in a comment", "# latest\noptions: [preview]", false],
  ])("given latest %s, when read, then it is offered: %s", (_, content, offered) => {
    expect(pipeline().offers?.(content, "latest")).toBe(offered);
  });
});
