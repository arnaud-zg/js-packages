import type { Requirement } from "shiplane/plugin";

const NPMJS = "https://registry.npmjs.org";
const DOCS =
  "https://github.com/arnaud-zg/js-packages/blob/main/packages/shiplane-npm/README.md#-npm-does-not-trust-the-workflow";

/**
 * Asks npm for the package's publish token, as `npm publish` does, and drops it: exits 1 only when
 * npm refuses it and no npm token signs in instead. npm's own publish says `ENEEDAUTH` and no more.
 * Passes when npm cannot say, or when the package publishes to another registry.
 */
const SCRIPT = `
const { spawnSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const [, name, registry] = process.argv;
const elsewhere = () => {
  try {
    const { publishConfig } = JSON.parse(readFileSync("package.json", "utf8"));
    const own = publishConfig && publishConfig.registry;
    return Boolean(own) && !/^https?:\\/\\/registry\\.npmjs\\.(org|com)\\/?$/.test(own);
  } catch {
    return false;
  }
};
const post = async () => {
  const url = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
  url.searchParams.set("audience", "npm:registry.npmjs.org");
  const asked = await fetch(url, {
    headers: { authorization: "Bearer " + process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN },
  });
  if (!asked.ok) return 0;
  const { value } = await asked.json();
  const path = "/-/npm/v1/oidc/token/exchange/package/" + name.replace("/", "%2f");
  const answer = await fetch(registry + path, {
    method: "POST",
    headers: { authorization: "Bearer " + value },
  });
  return answer.status;
};
const main = async () => {
  if (elsewhere()) return;
  const status = await post().catch(() => 0);
  if (![400, 401, 403, 404].includes(status)) return;
  if (spawnSync("npm", ["whoami"]).status === 0) return;
  process.exitCode = 1;
};
main();
`;

/** The workflow file and repository of this run, as npm reads them from its OIDC token. */
const thisRun = () => {
  const { GITHUB_WORKFLOW_REF: ref = "", GITHUB_REPOSITORY: repository = "" } = process.env;
  const file = /\.github\/workflows\/([^@]+)@/.exec(ref)?.[1] ?? "ship.yml";
  return { file, repository };
};

/**
 * On a GitHub Actions runner that mints OIDC tokens: whether npm trusts this workflow to publish
 * the package. None anywhere else.
 */
export const trustRequirement = (
  { name, dir }: { name: string; dir: string },
  registry = NPMJS,
): Requirement[] => {
  const { file, repository } = thisRun();
  if (!process.env.ACTIONS_ID_TOKEN_REQUEST_URL || !repository) return [];
  return [
    {
      label: `npm trust for ${name}`,
      check: { command: "node", args: ["-e", SCRIPT, name, registry], cwd: dir },
      help:
        `npm does not let ${file} of ${repository} publish these packages. On your own machine, ` +
        `signed in to npm with 2FA, run each line below, then run the workflow again. ` +
        `Already set up? Compare with npm trust list <package>: ${DOCS}`,
      fix: {
        command: "npx",
        args: [
          "--yes",
          "npm@^11.21.0",
          "trust",
          "github",
          name,
          "--file",
          file,
          "--repo",
          repository,
          "--allow-publish",
          "--allow-stage-publish",
          "--yes",
        ],
      },
    },
  ];
};
