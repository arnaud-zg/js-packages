import type { CallerNeeds, CiPipelinePort, Deploy, ServiceAdapter, Shell } from "shiplane/plugin";
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
const CommitSchema = z.object({ sha: z.string() });

/** A test version, `<version>-<branch>.<short sha>`, ends on the commit it was built from. */
const TEST_VERSION = /^\d+\.\d+\.\d+-[0-9a-z-]+\.g?([0-9a-f]{7,40})$/;

const isMissing = (error: unknown) =>
  error instanceof Error && /HTTP 404|HTTP 422|Not Found|No commit found/.test(error.message);

/** Where shiplane's own workflow and its release tags live. */
const SHIPLANE_REPO = "arnaud-zg/js-packages";

/** What shiplane's workflow may do: comment on PRs and issues only with release comments. */
const permissionsOf = ({ features }: CallerNeeds) => [
  "permissions:",
  "  contents: read",
  "  deployments: write",
  "  actions: read",
  ...(features.includes("release-comments") ? ["  issues: write", "  pull-requests: write"] : []),
];

/** Each secret its adapters read, passed by name: GitHub hands a called workflow no other. */
const secretsOf = ({ secrets }: CallerNeeds) =>
  secrets.length === 0
    ? []
    : ["    secrets:", ...secrets.map((name) => `      ${name}: \${{ secrets.${name} }}`)];

/** The workflow a repository ships from: a manual run calling shiplane's, pinned to a commit. */
const callerContent = (sha: string, version: string, needs: CallerNeeds) =>
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
    ...permissionsOf(needs),
    "",
    "jobs:",
    "  ship:",
    `    uses: ${SHIPLANE_REPO}/.github/workflows/shiplane-ship.yml@${sha} # shiplane@${version}`,
    "    with:",
    "      units: ${{ inputs.units }}",
    "      environment: ${{ inputs.environment }}",
    ...secretsOf(needs),
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
    callerWorkflow: async (version, needs) => {
      const tag = `shiplane@${version}`;
      const orMissing = (error: unknown) => {
        if (isMissing(error)) return null;
        throw error;
      };
      // A test version has no release tag: it pins the commit its short sha names.
      const short = TEST_VERSION.exec(version)?.[1];
      if (short) {
        const commit = await json(["api", `repos/${SHIPLANE_REPO}/commits/${short}`]).catch(
          orMissing,
        );
        if (commit === null) {
          return { error: `no commit ${short} for ${tag}: pin shiplane-ship.yml by hand` };
        }
        const { sha } = CommitSchema.parse(commit);
        return {
          file: `.github/workflows/${shipWorkflow}`,
          content: callerContent(sha, version, needs),
          pin: sha,
        };
      }
      const ref = await json(["api", `repos/${SHIPLANE_REPO}/git/ref/tags/${tag}`]).catch(
        orMissing,
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
        content: callerContent(sha, version, needs),
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
export const gitHubActionsCiPipeline = (
  options: { shipWorkflow?: string } = {},
): GitHubActionsCiPipelineAdapter => ({
  name: "github-actions",
  options,
  requirements: () => [GH_REQUIREMENT],
  create: ({ root, shell }) => githubActions(root, shell, options.shipWorkflow ?? "ship.yml"),
});
