import { RecordingShell, TEST_FLOW, testUnit } from "shiplane/testing";
import { describe, expect, it } from "vitest";

import { githubPagesStaticHosting } from "../github-pages-static-hosting.adapter";

const pages = githubPagesStaticHosting();

type Folder = Parameters<NonNullable<typeof pages.detect>>[0];

const folder = (files: string[]): Folder => ({
  dir: "apps/site",
  name: "site",
  files,
  has: (file) => files.includes(file),
  read: () => null,
});

const jobFor = (environment: "preview" | "production", settings: Record<string, unknown> = {}) =>
  pages.create({ root: "/repo", shell: new RecordingShell() }).jobs({
    flow: TEST_FLOW,
    unit: testUnit("site", { module: "web-app" }),
    tag: "site@1.0.0",
    environment,
    commit: "abc1234",
    defaultBranch: "main",
    options: pages.settings.parse({ url: "https://acme.github.io/site", ...settings }),
  })[0];

describe("a GitHub Pages unit file", () => {
  it("given only an address, when shiplane reads it, then the site ships from dist to gh-pages", () => {
    expect(pages.settings.parse({ url: "https://acme.github.io/site/" })).toEqual({
      url: "https://acme.github.io/site/",
      branch: "gh-pages",
      dist: "dist",
      variables: [],
    });
  });

  it("given an address that is not one, when shiplane reads it, then it says what to write", () => {
    expect(() => pages.settings.parse({ url: "acme.github.io" })).toThrow(
      "like https://acme.github.io/site/",
    );
  });
});

describe("recognising a site", () => {
  it.each([
    [["astro.config.mjs"], "likely"],
    [["vite.config.ts", "index.html"], "likely"],
    [["vite.config.ts"], "possible"],
  ])("given %s, when setup looks at the folder, then it is %s a site", (files, certainty) => {
    expect(pages.detect?.(folder(files))?.certainty).toBe(certainty);
  });

  it("given no build config, when setup looks at the folder, then nothing is found", () => {
    expect(pages.detect?.(folder(["index.ts"]))).toBeNull();
  });

  it.each([
    ["acme/acme.github.io", "https://acme.github.io/"],
    ["acme/docs", "https://acme.github.io/docs/"],
  ])(
    "given the repository %s, when setup asks for the address, then it offers %s",
    (remote, initial) => {
      expect(pages.questions?.(folder([]), {}, "site", remote)).toEqual([
        { key: "url", message: "Address of the site?", initial },
      ]);
    },
  );

  it("given a repository not on GitHub, when setup asks for the address, then it guesses nothing", () => {
    expect(pages.questions?.(folder([]), {}, "site")).toEqual([
      { key: "url", message: "Address of the site?" },
    ]);
  });

  it("given an address already found, when setup asks, then it asks nothing", () => {
    expect(pages.questions?.(folder([]), { url: "https://acme.dev/" }, "site")).toEqual([]);
  });
});

describe("what a runner needs to publish", () => {
  it("given variables the build reads, when setup writes ship.yml, then it may write the branch, ask for a build, and passes them", () => {
    const unit = testUnit("site", {
      options: { url: "https://acme.github.io/", variables: ["SITE_KEY"] },
    });

    expect(pages.requirements?.(unit)[0]).toMatchObject({
      secrets: ["GH_TOKEN"],
      permissions: { contents: "write", pages: "write" },
      variables: ["SITE_KEY"],
    });
  });

  it("given a name that is not a variable's, when shiplane reads it, then it says what to write", () => {
    expect(() =>
      pages.settings.parse({ url: "https://acme.github.io/", variables: ["siteKey"] }),
    ).toThrow("like SITE_KEY");
  });
});

describe("building and publishing to GitHub Pages", () => {
  it("given a ship to preview, when its job is built, then the site is built for the preview folder and this machine or CI can ship it", () => {
    const job = jobFor("preview");

    expect(job?.label).toBe(
      "build site@1.0.0 and publish it to https://acme.github.io/site/preview/",
    );
    expect(job?.local[0]).toEqual({
      command: "pnpm",
      args: ["--filter=@acme/site", "run", "build"],
      env: { BASE_PATH: "/site/preview/" },
    });
    expect(job?.local[2]?.args).toContain("--dest=preview");
    expect(job?.ci).toEqual({ ref: "site@1.0.0" });
  });

  it("given a ship to production, when its job is built, then the site is built for its root", () => {
    expect(jobFor("production")?.local[0]?.env).toEqual({ BASE_PATH: "/site/" });
  });

  it("given variables of its own, when the site ships, then the build gets them beside BASE_PATH", () => {
    expect(jobFor("production", { env: { ANALYTICS: "off" } })?.local[0]?.env).toEqual({
      BASE_PATH: "/site/",
      ANALYTICS: "off",
    });
  });

  it("given the branch the source is on, when the site ships, then it refuses before anything runs", () => {
    expect(() => jobFor("production", { branch: "main" })).toThrow(
      'branch "main" holds the source',
    );
  });
});

describe("publishing to environments named otherwise", () => {
  const flow = { path: ["dev", "staging", "prod"], users: "prod" } as const;
  const argsOn = (environment: string) =>
    githubPagesStaticHosting()
      .create({ root: "/repo", shell: new RecordingShell() })
      .jobs({
        unit: testUnit("site", { module: "web-app" }),
        tag: "site@1.0.0",
        environment,
        flow,
        commit: "abc1234",
        defaultBranch: "main",
        options: {
          url: "https://acme.github.io/site/",
          branch: "gh-pages",
          dist: "dist",
          variables: [],
        },
      })[0]?.local[2]?.args;

  it("given one users are not on, when it publishes, then it goes to a folder of its name", () => {
    expect(argsOn("staging")).toContain("--dest=staging");
  });

  it("given the one users are on, when it publishes, then it replaces all but the others' folders", () => {
    expect(argsOn("prod")).toContain("--remove={!(CNAME|dev|staging),!(CNAME|dev|staging)/**}");
  });
});
