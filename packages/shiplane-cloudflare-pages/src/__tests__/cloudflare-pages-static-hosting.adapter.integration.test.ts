import { RecordingShell, TEST_FLOW, testUnit } from "shiplane/testing";
import { describe, expect, it } from "vitest";

import { cloudflarePagesStaticHosting } from "../cloudflare-pages-static-hosting.adapter";

const pages = cloudflarePagesStaticHosting();

type Folder = Parameters<NonNullable<typeof pages.detect>>[0];

const folder = (files: Record<string, string>): Folder => ({
  dir: "apps/site",
  name: "site",
  files: Object.keys(files),
  has: (file) => file in files,
  read: (file) => files[file] ?? null,
});

describe("recognising a site Cloudflare Pages ships", () => {
  it("given a wrangler.jsonc, when init looks at the folder, then it is found with the project it names", () => {
    expect(pages.detect?.(folder({ "wrangler.jsonc": '{ "name": "acme-site" }' }))).toEqual({
      certainty: "found",
      reason: "wrangler.jsonc",
      options: { project: "acme-site" },
    });
  });

  it("given a wrangler.toml naming the project beside an account_name, when init looks at the folder, then it proposes that project, not the account", () => {
    expect(
      pages.detect?.(folder({ "wrangler.toml": 'account_name = "acme"\nname  =  "acme-site"\n' })),
    ).toEqual({ certainty: "found", reason: "wrangler.toml", options: { project: "acme-site" } });
  });

  it("given a wrangler.json with spaces around its name, when init looks at the folder, then it is found with the project it names", () => {
    expect(
      pages.detect?.(folder({ "wrangler.json": '{ "name" :  "acme-site" }' }))?.options,
    ).toEqual({ project: "acme-site" });
  });

  it("given a wrangler.toml that names no project, when init looks at the folder, then it is found and the project is left to ask", () => {
    expect(pages.detect?.(folder({ "wrangler.toml": 'main = "src/index.ts"\n' }))).toEqual({
      certainty: "found",
      reason: "wrangler.toml",
      options: {},
    });
  });

  it("given a Vite config with an index.html, when init looks at the folder, then it is likely a site, for both reasons", () => {
    const found = pages.detect?.(
      folder({ "vite.config.ts": "export default {}", "index.html": "<!doctype html>" }),
    );

    expect(found).toEqual({
      certainty: "likely",
      reason: "vite.config.ts, index.html",
      options: {},
    });
  });

  it("given a Vite config with no index.html, when init looks at the folder, then it is only possibly a site, since it is usually a library", () => {
    expect(pages.detect?.(folder({ "vite.config.ts": "export default {}" }))?.certainty).toBe(
      "possible",
    );
  });

  it("given an Astro config with no index.html, when init looks at the folder, then it is likely a site, named by its config", () => {
    expect(pages.detect?.(folder({ "astro.config.mjs": "export default {}" }))).toEqual({
      certainty: "likely",
      reason: "astro.config.mjs",
      options: {},
    });
  });

  it("given files that only look like wrangler or build configs, when init looks at the folder, then nothing is found", () => {
    expect(
      pages.detect?.(
        folder({
          "my-wrangler.toml": 'name = "acme-site"',
          "wrangler.toml.bak": 'name = "acme-site"',
          "myvite.config.ts": "export default {}",
          "vite.config.ts.orig": "export default {}",
        }),
      ),
    ).toBeNull();
  });
});

describe("asking for what init could not find", () => {
  it("given a site with no project found, when init asks, then it asks for the Pages project, offering the repository and folder name", () => {
    expect(pages.questions?.(folder({}), {}, "acme")).toEqual([
      { key: "project", message: "Pages project?", initial: "acme-site" },
    ]);
  });

  it("given a project already found, when init asks, then it asks nothing", () => {
    expect(pages.questions?.(folder({}), { project: "acme-site" }, "acme")).toEqual([]);
  });
});

describe("what doctor checks before a site ships to Cloudflare Pages", () => {
  it("given a unit pinning its own wrangler, when doctor checks, then whoami runs on that wrangler, login fixes it, and a runner signs in with its API token and account", () => {
    const unit = testUnit("site", {
      options: { project: "acme-site", wrangler: "wrangler@4.0.0" },
    });

    expect(pages.requirements?.(unit)).toEqual([
      {
        label: "wrangler",
        check: { command: "npx", args: ["--yes", "wrangler@4.0.0", "whoami"] },
        fix: { command: "npx", args: ["--yes", "wrangler@4.0.0", "login"] },
        secrets: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
      },
    ]);
  });
});

describe("relying on defaults in a Cloudflare Pages unit file", () => {
  it("given a unit file naming only a project, when shiplane reads it, then the site ships from dist, with a pinned wrangler", () => {
    expect(pages.settings.parse({ project: "acme-site" })).toEqual({
      project: "acme-site",
      dist: "dist",
      build: {},
      wrangler: "wrangler@4.141.0",
    });
  });
});

describe("choosing the branch an upload goes to", () => {
  const THREE = { path: ["dev", "staging", "prod"], users: "prod" } as const;

  it.each([
    ["preview", TEST_FLOW, "preview"],
    ["production", TEST_FLOW, "main"],
    ["staging", THREE, "staging"],
    ["prod", THREE, "main"],
  ])(
    "given no branch named, when a site ships to %s, then it goes to %s's branch",
    (environment, flow, branch) => {
      const [job] = pages.create({ root: "/repo", shell: new RecordingShell() }).jobs({
        unit: testUnit("site", { module: "web-app" }),
        tag: "site@1.0.0",
        environment,
        flow,
        commit: "abc1234",
        defaultBranch: "main",
        options: { project: "acme-site", dist: "dist", build: {}, wrangler: "wrangler@4.141.0" },
      });

      expect(job?.local.at(-1)?.args).toContain(`--branch=${branch}`);
    },
  );
});

describe("building and uploading to Cloudflare Pages", () => {
  const port = pages.create({ root: "/repo", shell: new RecordingShell() });
  const unit = testUnit("site", { module: "web-app" });
  const jobFor = (build: { command?: string[]; env?: Record<string, string> }) =>
    port.jobs({
      flow: TEST_FLOW,
      unit,
      tag: "site@1.0.0",
      environment: "preview",
      commit: "abc1234",
      defaultBranch: "main",
      options: {
        project: "acme-site",
        dist: "dist",
        build,
        branch: "preview",
        wrangler: "wrangler@4.141.0",
      },
    })[0];

  it("given a site with no build command of its own, when it ships to preview, then turbo builds it and wrangler uploads its dist to the project's preview branch, named by the tag", () => {
    expect(jobFor({})).toEqual({
      label: "build site@1.0.0 and upload it to acme-site (preview)",
      local: [
        { command: "pnpm", args: ["turbo", "run", "build", "--filter=@acme/site"] },
        {
          command: "npx",
          args: [
            "--yes",
            "wrangler@4.141.0",
            "pages",
            "deploy",
            "apps/site/dist",
            "--project-name=acme-site",
            "--branch=preview",
            "--commit-hash=abc1234",
            "--commit-message=site@1.0.0",
          ],
        },
      ],
      ci: { ref: "site@1.0.0" },
      record: true,
    });
  });

  it("given a build command of its own, when the job is built, then that command builds the site instead of turbo", () => {
    expect(jobFor({ command: ["pnpm", "--filter", "site", "build"] })?.local[0]).toMatchObject({
      command: "pnpm",
      args: ["--filter", "site", "build"],
    });
  });

  it("given variables the build reads, when the job is built, then the build gets them and the upload names the commit and tag", () => {
    const job = jobFor({ env: { PUBLIC_API_URL: "https://api-preview.acme.dev" } });

    expect(job?.local[0]?.env).toEqual({ PUBLIC_API_URL: "https://api-preview.acme.dev" });
    expect(job?.local[1]?.args).toEqual(
      expect.arrayContaining(["--commit-hash=abc1234", "--commit-message=site@1.0.0"]),
    );
  });

  it("given an empty set of build variables, when the site ships, then its build runs with no env of its own", () => {
    expect(jobFor({ env: {} })?.local[0]).not.toHaveProperty("env");
  });
});
