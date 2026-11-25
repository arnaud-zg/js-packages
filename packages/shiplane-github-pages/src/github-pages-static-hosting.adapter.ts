import path from "node:path";
import type { Command, DeliveryAdapter, DeployFlow, StaticHostingPort } from "shiplane/plugin";
import { DEFAULT_FLOW, defineStaticHosting, perEnv, reachesUsers, z } from "shiplane/plugin";

const GH_PAGES = "gh-pages@6.3.0";

/** The folder of the branch an environment lives in; users' is the rest of it. */
const folderOf = (flow: DeployFlow, environment: string) =>
  reachesUsers(flow, environment) ? null : environment;

/** Everything at the branch root but CNAME and the other environments' folders, as a glob. It starts
 * with a brace where it is used: a leading `!` would negate the whole pattern. */
const keptBy = ({ path: names, users }: DeployFlow) =>
  `!(${["CNAME", ...names.filter((name) => name !== users)].join("|")})`;

const BUILT = /^(vite|astro|next|nuxt|svelte)\.config\.(ts|js|mjs|cjs)$/;

const GithubPagesOptions = z.object({
  url: z
    .string()
    .regex(/^https?:\/\/[^/]+/, "the site's address, like https://acme.github.io/site/")
    .describe("The site's address; its path is given to the build as BASE_PATH"),
  branch: z.string().default("gh-pages").describe("The branch Pages serves"),
  dist: z.string().default("dist").describe("What the build writes, relative to the unit's folder"),
  domain: z.string().optional().describe("A custom domain, written as CNAME"),
  env: z
    .record(z.string(), perEnv(z.string()))
    .optional()
    .describe("Variables the build reads, per environment"),
  variables: z
    .array(z.string().regex(/^[A-Z][A-Z0-9_]*$/, "a variable name is UPPER_SNAKE, like SITE_KEY"))
    .default([])
    .describe("Variables the build reads from this machine or, on CI, from GitHub's variables"),
});

const addressOf = (url: string, flow: DeployFlow, environment: string) => {
  const root = url.endsWith("/") ? url : `${url}/`;
  const folder = folderOf(flow, environment);
  return folder === null ? root : `${root}${folder}/`;
};

/** Where GitHub serves a repository's site: a user's or organisation's is named by its address. */
const siteOf = (remote: string) => {
  const [owner = "", name = ""] = remote.split("/");
  return name.endsWith(".github.io") ? `https://${name}/` : `https://${owner}.github.io/${name}/`;
};

// On a branch that does not exist, gh-pages starts from the repository's own files and publishes
// them. So the branch is there first, empty. An existing one refuses this push: it is not forced.
const START =
  // A runner has no identity and no sign-in of its own outside its checkout.
  '[ -z "$GITHUB_ACTIONS" ] || { git config --global user.name "github-actions[bot]" && git config --global user.email "41898282+github-actions[bot]@users.noreply.github.com" && git config --global credential.https://github.com.helper "!gh auth git-credential"; } && ' +
  '{ git ls-remote --exit-code --heads origin "$1" >/dev/null || git push origin "$(git commit-tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904 -m "start $1")":"refs/heads/$1"; }';

// A push made with a workflow's token builds no Pages site: it is asked for. Not asked, or refused,
// the files are there all the same.
const ASK =
  '[ -z "$GITHUB_ACTIONS" ] || gh api -X POST "repos/$GITHUB_REPOSITORY/pages/builds" --silent || echo "Pages was not asked to build: ship again, or build it from Settings > Pages"';

const startBranch = (branch: string): Command => ({
  command: "sh",
  args: ["-c", START, "sh", branch],
});

/** A static build on GitHub Pages: each environment in its own folder, users' in the rest of the branch. */
export type GithubPagesStaticHostingAdapter = DeliveryAdapter<StaticHostingPort>;

export const githubPagesStaticHosting = (): GithubPagesStaticHostingAdapter =>
  defineStaticHosting({
    name: "github-pages",
    settings: GithubPagesOptions,
    typicalMinutes: 2,
    describe: ({ options, environment, flow = DEFAULT_FLOW }) =>
      `${addressOf(options.url, flow, environment)} (GitHub Pages)`,
    detect: (folder) => {
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
    questions: (_folder, found, _repository, remote) =>
      found.url === undefined
        ? [
            {
              key: "url",
              message: "Address of the site?",
              ...(remote ? { initial: siteOf(remote) } : {}),
            },
          ]
        : [],
    requirements: (unit) => {
      const { variables } = GithubPagesOptions.partial({ url: true }).parse(unit.options);
      return [
        {
          label: "GitHub Pages",
          check: { command: "git", args: ["ls-remote", "--quiet", "origin", "HEAD"] },
          secrets: ["GH_TOKEN"],
          permissions: { contents: "write", pages: "write" },
          ...(variables.length > 0 ? { variables } : {}),
        },
      ];
    },
    jobs: ({ unit, tag, environment, options, defaultBranch, flow = DEFAULT_FLOW }) => {
      const { branch, domain } = options;
      if (branch === defaultBranch) {
        throw new Error(
          `${unit.name}: branch "${branch}" holds the source, and a ship replaces its files. Use another, such as gh-pages.`,
        );
      }
      const address = addressOf(options.url, flow, environment);
      const folder = folderOf(flow, environment);
      const kept = keptBy(flow);
      return [
        {
          label: `build ${tag} and publish it to ${address}`,
          local: [
            {
              command: "pnpm",
              args: [`--filter=${unit.packageName}`, "run", "build"],
              env: { BASE_PATH: new URL(address).pathname, ...options.env },
            },
            startBranch(branch),
            {
              command: "npx",
              args: [
                "--yes",
                GH_PAGES,
                `--dist=${path.posix.join(unit.dir, options.dist)}`,
                `--branch=${branch}`,
                `--message=${tag}`,
                "--dotfiles",
                "--nojekyll",
                ...(domain ? [`--cname=${domain}`] : []),
                // Each environment replaces its own files only; CNAME outlives both.
                folder === null ? `--remove={${kept},${kept}/**}` : `--dest=${folder}`,
              ],
            },
            { command: "sh", args: ["-c", ASK] },
          ],
          ci: { ref: tag },
          record: true,
        },
      ];
    },
  });
