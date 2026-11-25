import type {
  CallerNeeds,
  CiPipelinePort,
  Deploy,
  MinutesBlocked,
  ServiceAdapter,
  Shell,
} from "shiplane/plugin";
import { actionsMinutes, billedMinutes, z } from "shiplane/plugin";

import { GH_REQUIREMENT, ghCli, GhError } from "./gh-cli";

const RunsSchema = z.array(
  z.object({ displayTitle: z.string(), status: z.string(), conclusion: z.string().nullish() }),
);
const UsageSummarySchema = z.object({
  usageItems: z.array(
    z.object({ sku: z.string(), grossQuantity: z.number(), unitType: z.string() }),
  ),
});
const OwnerSchema = z.object({ login: z.string(), type: z.string() });
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
const permissionsOf = ({ features, permissions = {} }: CallerNeeds) => {
  const allowed = {
    contents: "read",
    deployments: "write",
    actions: "read",
    ...(features.includes("release-comments") ? { issues: "write", "pull-requests": "write" } : {}),
    ...permissions,
  };
  return ["permissions:", ...Object.entries(allowed).map(([name, level]) => `  ${name}: ${level}`)];
};

/** An npm channel publishes the ref the run is on: its environment's branch rule holds. */
const checkedOut = (apps: readonly string[]) =>
  `\${{ contains(fromJSON('[${apps.map((name) => JSON.stringify(name)).join(", ")}]'), inputs.environment) && inputs.ref || '' }}`;

/** The job: its own environment and permissions, and one step that ships, given secrets by name. */
const shipJob = (pin: string, needs: CallerNeeds) => [
  "    name: Ship to ${{ inputs.environment }}",
  "    runs-on: ubuntu-26.04",
  "    # A dry run names none: naming one records a deployment.",
  "    environment: ${{ !inputs.dry-run && inputs.environment || '' }}",
  "    concurrency:",
  "      group: ship-${{ inputs.environment }}",
  "      cancel-in-progress: false",
  ...(needs.variables
    ? ["    env:", ...needs.variables.map((name) => `      ${name}: \${{ vars.${name} }}`)]
    : []),
  "    steps:",
  "      - uses: actions/checkout@v5",
  "        with:",
  `          ref: ${checkedOut(needs.apps)}`,
  "          fetch-depth: 0",
  `      - uses: ${SHIPLANE_REPO}/.github/actions/ship@${pin}`,
  "        with:",
  "          units: ${{ inputs.units }}",
  "          environment: ${{ inputs.environment }}",
  "          dry-run: ${{ inputs.dry-run }}",
  ...needs.secrets.map((name) => `          ${name}: \${{ secrets.${name} }}`),
];

/** The workflow a repository ships from: a manual run using shiplane, pinned to a commit. */
const callerContent = (sha: string, version: string, needs: CallerNeeds) => {
  const { environments } = needs;
  const pin = `${sha} # shiplane@${version}`;
  return [
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
    `        options: [${environments.join(", ")}]`,
    `        default: ${environments[0]}`,
    "      ref:",
    '        description: "The tag to ship; shiplane sets it (empty: the ref this runs on)"',
    "        type: string",
    '        default: ""',
    "      dry-run:",
    '        description: "Show what would ship, ship nothing"',
    "        type: boolean",
    "        default: false",
    "",
    ...permissionsOf(needs),
    "",
    "jobs:",
    "  ship:",
    ...shipJob(pin, needs),
    "",
  ].join("\n");
};

/** A caller that hands shiplane's workflow the tag to check out, so it can run from main. */
const PASSES_REF = /^[ \t]+ref:[ \t]*\$\{\{[^}]*\binputs\.ref\b[^}]*\}\}/m;

/** Whether one of the workflow's choice inputs lists the environment, inline or one per line. */
const offers = (content: string, environment: string) => {
  const inline = [...content.matchAll(/options:[ \t]*\[([^\]]*)\]/g)].flatMap(([, list = ""]) =>
    list.split(","),
  );
  const listed = [...content.matchAll(/^[ \t]*-[ \t]+(\S+)[ \t]*$/gm)].map(([, item = ""]) => item);
  return [...inline, ...listed].some(
    (item) => item.trim().replace(/^["']|["']$/g, "") === environment,
  );
};

/** gh names the scope a call lacks, and the command that grants it. */
const SCOPE_HINT = /needs the "([^"]+)" scope\.[^\n]*?run:\s+(gh auth refresh [^\n]+)/;

/** GitHub answers a billing page one may not read as forbidden, or as missing. */
const REFUSED = /HTTP 40[34]/;

/** What a refused billing call is missing: a scope gh can grant, or a right the owner gives. */
const blockedBy = (
  error: unknown,
  { login, type }: z.infer<typeof OwnerSchema>,
): MinutesBlocked | null => {
  if (!(error instanceof GhError) || !REFUSED.test(error.stderr)) return null;
  const url =
    type === "User"
      ? "https://github.com/settings/billing"
      : `https://github.com/organizations/${login}/settings/billing`;
  const [, scope, fix] = SCOPE_HINT.exec(error.stderr) ?? [];
  return scope && fix
    ? { reason: `gh needs the "${scope}" scope to read them.`, url, fix: fix.trim() }
    : { reason: `GitHub does not let this account read the billing of ${login}.`, url };
};

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

  /** The default branch, when its caller passes `ref` and it is not `ref` itself; else null. */
  const fromMain = async (workflow: string, ref: string) => {
    try {
      const main = (
        await must(["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"])
      ).trim();
      if (!main || main === ref) return null;
      const caller = await must([
        "api",
        `repos/{owner}/{repo}/contents/.github/workflows/${workflow}?ref=${encodeURIComponent(main)}`,
        "-H",
        "Accept: application/vnd.github.raw",
      ]);
      return PASSES_REF.test(caller) ? main : null;
    } catch {
      return null;
    }
  };

  /** The account's plan and usage: GitHub bills a person and an organization at different addresses. */
  const billing = async (personal: boolean) => {
    const usage = await json([
      "api",
      `${personal ? "users" : "organizations"}/{owner}/settings/billing/usage/summary`,
    ]);
    const plan = await must(["api", personal ? "user" : "orgs/{owner}", "--jq", ".plan.name"]);
    return actionsMinutes(plan.trim(), UsageSummarySchema.parse(usage).usageItems);
  };

  return {
    shipWorkflow,
    label: "GitHub Actions",
    runsLine: "gh run list --limit 5",
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
          return { error: `no commit ${short} for ${tag}: pin ship.yml by hand` };
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
      if (ref === null) return { error: `no release tag ${tag}: pin ship.yml by hand` };
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
    // A tag holds the workflow of its day: when main's caller passes `ref`, the run starts on main,
    // with today's workflow, and checks out the tag. An older caller still runs on the tag.
    offers,
    dispatch: async (workflow, ref, inputs, { direct = false } = {}) => {
      const main = direct ? null : await fromMain(workflow, ref);
      const run = main ? { ref: main, inputs: { ...inputs, ref } } : { ref, inputs };
      await must([
        "workflow",
        "run",
        workflow,
        "--ref",
        run.ref,
        ...Object.entries(run.inputs).flatMap(([key, value]) => ["-f", `${key}=${value}`]),
      ]);
    },
    minutes: async () => {
      try {
        const owner = OwnerSchema.parse(
          await json(["api", "users/{owner}", "--jq", "{login, type}"]),
        );
        const personal = owner.type === "User";
        // Only that person reads their billing: no scope helps anyone else.
        if (personal && (await must(["api", "user", "--jq", ".login"])).trim() !== owner.login) {
          return null;
        }
        return await billing(personal).catch((error: unknown) => blockedBy(error, owner));
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
