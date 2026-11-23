import path from "node:path";
import type { Command, DeliveryAdapter, StaticHostingPort } from "shiplane/plugin";
import { defineStaticHosting, perEnv, z } from "shiplane/plugin";

const GH_PAGES = "gh-pages@6.3.0";

/** Where preview lives on the branch. Production is the rest of it. */
const PREVIEW = "preview";

/** Everything at the branch root but these, as a glob. It starts with a brace where it is used: a
 * leading `!` would negate the whole pattern. */
const KEPT = `!(CNAME|${PREVIEW})`;

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
});

const addressOf = (url: string, environment: string) => {
  const root = url.endsWith("/") ? url : `${url}/`;
  return environment === PREVIEW ? `${root}${PREVIEW}/` : root;
};

/** Where GitHub serves a repository's site: a user's or organisation's is named by its address. */
const siteOf = (remote: string) => {
  const [owner = "", name = ""] = remote.split("/");
  return name.endsWith(".github.io") ? `https://${name}/` : `https://${owner}.github.io/${name}/`;
};

// On a branch that does not exist, gh-pages starts from the repository's own files and publishes
// them. So the branch is there first, empty. An existing one refuses this push: it is not forced.
const START =
  'git ls-remote --exit-code --heads origin "$1" >/dev/null || git push origin "$(git commit-tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904 -m "start $1")":"refs/heads/$1"';

const startBranch = (branch: string): Command => ({
  command: "sh",
  args: ["-c", START, "sh", branch],
});

/** A static build on GitHub Pages: preview in its own folder, production in the rest of the branch. */
export type GithubPagesStaticHostingAdapter = DeliveryAdapter<StaticHostingPort>;

export const githubPagesStaticHosting = (): GithubPagesStaticHostingAdapter =>
  defineStaticHosting({
    name: "github-pages",
    settings: GithubPagesOptions,
    typicalMinutes: 2,
    describe: ({ options, environment }) => `${addressOf(options.url, environment)} (GitHub Pages)`,
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
    jobs: ({ unit, tag, environment, options, defaultBranch }) => {
      const { branch, domain } = options;
      if (branch === defaultBranch) {
        throw new Error(
          `${unit.name}: branch "${branch}" holds the source, and a ship replaces its files. Use another, such as gh-pages.`,
        );
      }
      const address = addressOf(options.url, environment);
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
                environment === PREVIEW ? `--dest=${PREVIEW}` : `--remove={${KEPT},${KEPT}/**}`,
              ],
            },
          ],
          record: true,
        },
      ];
    },
  });
