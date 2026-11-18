import type { CiPipelinePort, Deploy, ServiceAdapter, Shell } from "shiplane/plugin";
import { actionsMinutes, billedMinutes, z } from "shiplane/plugin";

import { GH_REQUIREMENT, ghCli } from "./gh-cli";

const RunsSchema = z.array(
  z.object({ displayTitle: z.string(), status: z.string(), conclusion: z.string().nullish() }),
);
const UsageSummarySchema = z.object({
  usageItems: z.array(
    z.object({ sku: z.string(), grossQuantity: z.number(), unitType: z.string() }),
  ),
});
const JobsSchema = z.array(
  z.object({ startedAt: z.string().nullable(), completedAt: z.string().nullable() }),
);

const RefSchema = z.object({ object: z.object({ sha: z.string(), type: z.string() }) });

/** Where shiplane's own workflow and its release tags live. */
const SHIPLANE_REPO = "arnaud-zg/js-packages";

/** The workflow a repository ships from: a manual run calling shiplane's, pinned to a commit. */
const callerContent = (sha: string, version: string) =>
  [
    "# Ships with shiplane: `pnpm shiplane ship --via ci`, or Run workflow here.",
    "# Written by `shiplane setup`; `shiplane doctor` keeps the pin current.",
    "name: Ship",
    "run-name: Ship ${{ inputs.units || 'every released unit' }} to ${{ inputs.environment }}",
    "",
    "on:",
    "  workflow_dispatch:",
    "    inputs:",
    "      units:",
    '        description: "Units to ship, space separated (empty: every unit the environment lacks)"',
    "        type: string",
    '        default: ""',
    "      environment:",
    '        description: "Where to ship the ref this runs on"',
    "        type: choice",
    "        options: [preview, production]",
    "        default: preview",
    "",
    "permissions:",
    "  contents: read",
    "  deployments: write",
    "  actions: read",
    "  issues: write",
    "  pull-requests: write",
    "",
    "jobs:",
    "  ship:",
    `    uses: ${SHIPLANE_REPO}/.github/workflows/shiplane-ship.yml@${sha} # shiplane@${version}`,
    "    with:",
    "      units: ${{ inputs.units }}",
    "      environment: ${{ inputs.environment }}",
    "    secrets: inherit",
    "",
  ].join("\n");

type Run = z.infer<typeof RunsSchema>[number];

/** A workflow run as a deploy record: still going, succeeded, or anything else. */
const runState = ({ status, conclusion }: Pick<Run, "status" | "conclusion">): Deploy["state"] => {
  if (status !== "completed") return "running";
  return conclusion === "success" ? "done" : "none";
};

/** Workflow runs, dispatches and the Actions minutes budget through the gh CLI. */
const githubActions = (root: string, shell: Shell, shipWorkflow: string): CiPipelinePort => {
  const { must, json } = ghCli({ root, shell });
  const runs = async (workflow: string): Promise<Deploy[]> => {
    // A workflow not on the default branch yet has no runs, which gh reports as an error.
    const listed = await json([
      "run",
      "list",
      "--workflow",
      workflow,
      "--limit",
      "100",
      "--json",
      "displayTitle,status,conclusion",
    ]).catch(() => []);
    return RunsSchema.parse(listed).map((run) => ({
      title: run.displayTitle,
      state: runState(run),
    }));
  };

  return {
    shipWorkflow,
    label: "GitHub Actions",
    // GitHub runs the workflow file the ref holds.
    workflowFile: (workflow) => `.github/workflows/${workflow}`,
    dispatchLine: (workflow, ref, inputs) =>
      [
        `gh workflow run ${workflow} --ref ${ref}`,
        ...Object.entries(inputs).map(([key, value]) => `-f ${key}=${value}`),
      ].join(" "),
    workflowRuns: runs,
    callerWorkflow: async (version) => {
      const tag = `shiplane@${version}`;
      const ref = await json(["api", `repos/${SHIPLANE_REPO}/git/ref/tags/${tag}`]).catch(
        (error: unknown) => {
          if (error instanceof Error && /HTTP 404|Not Found/.test(error.message)) return null;
          throw error;
        },
      );
      if (ref === null) return { error: `no release tag ${tag}: pin shiplane-ship.yml by hand` };
      const { object } = RefSchema.parse(ref);
      // An annotated tag points at a tag object, which points at the commit.
      const sha =
        object.type === "tag"
          ? RefSchema.parse(await json(["api", `repos/${SHIPLANE_REPO}/git/tags/${object.sha}`]))
              .object.sha
          : object.sha;
      return {
        file: `.github/workflows/${shipWorkflow}`,
        content: callerContent(sha, version),
        pin: sha,
      };
    },
    dispatch: async (workflow, ref, inputs) => {
      await must([
        "workflow",
        "run",
        workflow,
        "--ref",
        ref,
        ...Object.entries(inputs).flatMap(([key, value]) => ["-f", `${key}=${value}`]),
      ]);
    },
    minutes: async () => {
      try {
        const [plan, summary] = await Promise.all([
          must(["api", "orgs/{owner}", "--jq", ".plan.name"]),
          json(["api", "organizations/{owner}/settings/billing/usage/summary"]),
        ]);
        return actionsMinutes(plan.trim(), UsageSummarySchema.parse(summary).usageItems);
      } catch {
        return null;
      }
    },
    measuredMinutes: async (workflow) => {
      try {
        const ids = z
          .array(z.object({ databaseId: z.number() }))
          .parse(
            await json([
              "run",
              "list",
              "--workflow",
              workflow,
              "--status",
              "success",
              "--limit",
              "3",
              "--json",
              "databaseId",
            ]),
          );
        return await Promise.all(
          ids.map(async ({ databaseId }) =>
            billedMinutes(
              JobsSchema.parse(
                await json([
                  "api",
                  `repos/{owner}/{repo}/actions/runs/${databaseId}/jobs`,
                  "--jq",
                  "[.jobs[] | {startedAt: .started_at, completedAt: .completed_at}]",
                ]),
              ),
            ),
          ),
        );
      } catch {
        return [];
      }
    },
  };
};

export type GitHubActionsCiPipelineAdapter = ServiceAdapter<CiPipelinePort>;

/**
 * Workflow runs, dispatches and the minutes budget on GitHub Actions, through the gh CLI. Shipping
 * through it dispatches `shipWorkflow` (default `ship.yml`) with `units` and `environment`.
 */
export const gitHubActionsCiPipeline = ({
  shipWorkflow = "ship.yml",
}: { shipWorkflow?: string } = {}): GitHubActionsCiPipelineAdapter => ({
  name: "github-actions",
  requirements: () => [GH_REQUIREMENT],
  create: ({ root, shell }) => githubActions(root, shell, shipWorkflow),
});
