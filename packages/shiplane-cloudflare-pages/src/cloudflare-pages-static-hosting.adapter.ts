import path from "node:path";
import type {
  AdapterContext,
  DeliveryAdapter,
  DeployFlow,
  PlatformEnvPort,
  StaticHostingPort,
} from "shiplane/plugin";
import {
  defineStaticHosting,
  firstLine,
  isEnvVarName,
  perEnv,
  reachesUsers,
  z,
} from "shiplane/plugin";

const WRANGLER = "wrangler@4.141.0";

const BUILT = /^(vite|astro|next|nuxt|svelte)\.config\.(ts|js|mjs|cjs)$/;

const PagesOptions = z.object({
  project: z.string().describe("The Cloudflare Pages project"),
  dist: z.string().default("dist").describe("What the build writes, relative to the unit's folder"),
  build: z
    .object({
      command: z
        .array(z.string())
        .optional()
        .describe("The build, run from the root; `pnpm turbo run build` of the unit by default"),
      env: z
        .record(z.string(), perEnv(z.string()))
        .optional()
        .describe("Variables the build reads, per environment"),
    })
    .default({}),
  branch: perEnv(z.string())
    .optional()
    .describe("The Pages branch; by default main where users are, else the environment's name"),
  secretsIn: perEnv(z.string())
    .optional()
    .describe("The Cloudflare environment holding its secrets, to check them before a deploy"),
  wrangler: z.string().default(WRANGLER).describe("The wrangler npx runs, pinned"),
});

const SECRET_LINE = /^\s*-\s+([A-Za-z_][A-Za-z0-9_]*):/;

/** Where Cloudflare keeps the environment's secrets, as the unit file says; its names are not ours. */
const secretsIn = (options: z.output<typeof PagesOptions>) => {
  if (typeof options.secretsIn === "string") return options.secretsIn;
  throw new Error("set secretsIn in the unit file: the Cloudflare environment holding its secrets");
};

/** The branch the upload goes to: the project's own branch is where users are. */
const branchOf = ({
  options,
  environment,
  flow,
}: {
  options: { branch?: string | undefined };
  environment: string;
  flow: DeployFlow;
}) => options.branch ?? (reachesUsers(flow, environment) ? "main" : environment);

/** Pages secrets of the environment, plus the variables the unit file gives its build. */
const pagesEnv = ({ shell }: AdapterContext): PlatformEnvPort => ({
  listNames: async ({ options }) => {
    const parsed = PagesOptions.parse(options);
    const { project, wrangler, build } = parsed;
    const held = secretsIn(parsed);
    const result = await shell.capture("npx", [
      "--yes",
      wrangler,
      "pages",
      "secret",
      "list",
      "--project-name",
      project,
      "--env",
      held,
    ]);
    if (result.status !== 0) {
      const reason = firstLine(result.stderr) ?? `exit ${result.status}`;
      throw new Error(`wrangler pages secret list --env ${held}: ${reason}`);
    }
    const secrets = result.stdout.split("\n").flatMap((line) => {
      const name = SECRET_LINE.exec(line)?.[1];
      return name ? [name] : [];
    });
    return new Set([...secrets, ...Object.keys(build.env ?? {})].filter(isEnvVarName));
  },
  setCommand: ({ options, names }) => {
    const parsed = PagesOptions.parse(options);
    const { project, wrangler } = parsed;
    return names
      .map(
        (name) =>
          `npx --yes ${wrangler} pages secret put ${name} --project-name ${project} --env ${secretsIn(parsed)}`,
      )
      .join(" && ");
  },
});

/** A static build on Cloudflare Pages: built against its environment, uploaded with wrangler. */
export type CloudflarePagesStaticHostingAdapter = DeliveryAdapter<StaticHostingPort>;

export const cloudflarePagesStaticHosting = (): CloudflarePagesStaticHostingAdapter =>
  defineStaticHosting({
    name: "cloudflare-pages",
    settings: PagesOptions,
    env: pagesEnv,
    typicalMinutes: 5,
    describe: (input) => `${input.options.project} on Pages (${branchOf(input)})`,
    detect: (folder) => {
      const wrangler = folder.files.find((file) => /^wrangler\.(toml|jsonc?)$/.test(file));
      if (wrangler) {
        const project =
          /^name\s*=\s*"([^"]+)"/m.exec(folder.read(wrangler) ?? "")?.[1] ??
          /"name"\s*:\s*"([^"]+)"/.exec(folder.read(wrangler) ?? "")?.[1];
        return { certainty: "found", reason: wrangler, options: project ? { project } : {} };
      }
      const built = folder.files.find((file) => BUILT.test(file));
      if (!built) return null;
      // A Vite config without an index.html is usually a library, not a site.
      const site = !built.startsWith("vite.") || folder.has("index.html");
      return {
        certainty: site ? "likely" : "possible",
        reason: site && built.startsWith("vite.") ? `${built}, index.html` : built,
        options: {},
      };
    },
    questions: (folder, found, repository) =>
      found.project === undefined
        ? [{ key: "project", message: "Pages project?", initial: `${repository}-${folder.name}` }]
        : [],
    requirements: (unit) => {
      const wrangler = PagesOptions.parse(unit.options).wrangler;
      return [
        {
          label: "wrangler",
          check: { command: "npx", args: ["--yes", wrangler, "whoami"] },
          fix: { command: "npx", args: ["--yes", wrangler, "login"] },
          // npx fetches wrangler itself: nothing to install.
          secrets: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
        },
      ];
    },
    jobs: (input) => {
      const { unit, tag, options, commit } = input;
      const branch = branchOf(input);
      const env = options.build.env;
      return [
        {
          label: `build ${tag} and upload it to ${options.project} (${branch})`,
          local: [
            {
              command: options.build.command?.[0] ?? "pnpm",
              args: options.build.command?.slice(1) ?? [
                "turbo",
                "run",
                "build",
                `--filter=${unit.packageName}`,
              ],
              ...(env && Object.keys(env).length > 0 ? { env } : {}),
            },
            {
              command: "npx",
              args: [
                "--yes",
                options.wrangler,
                "pages",
                "deploy",
                path.posix.join(unit.dir, options.dist),
                `--project-name=${options.project}`,
                // The upload is the deploy: it returns in seconds.
                `--branch=${branch}`,
                `--commit-hash=${commit}`,
                `--commit-message=${tag}`,
              ],
            },
          ],
          ci: { ref: tag },
          record: true,
        },
      ];
    },
  });
