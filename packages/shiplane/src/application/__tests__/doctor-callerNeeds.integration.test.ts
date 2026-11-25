import { describe, expect, it } from "vitest";

import { serverHostingFake } from "../../adapters/server-hosting/__fakes__/server-hosting.fake";
import { memoryRepository } from "../../testing/memoryRepository";
import { doctor } from "../doctor";
import { callerFor, callingPipeline, runningShiplane, SHIP_YML } from "./callerWorld";

// shiplane doctor checking what ship.yml allows and passes, in memory: a site whose adapter writes a
// branch and whose build reads a variable.

const REPO = {
  "shiplane.config.ts": "export default defineRelease({ modules: [] });\n",
  "pnpm-workspace.yaml": "packages:\n  - apps/*\n",
  "apps/site/package.json": JSON.stringify({ name: "@acme/site", version: "0.1.0" }),
  "apps/site/shiplane.unit.yml": "module: backend-service\nservice: site\n",
};
const NEEDS = {
  apps: [],
  environments: [],
  secrets: [],
  features: [],
  permissions: { contents: "write" as const },
  variables: ["SITE_KEY"],
};

const given = (shipYml: string) => {
  const pages = { ...serverHostingFake(), name: "pages" };
  pages.fake.seed({
    requirements: [
      {
        label: "pages",
        check: { command: "git", args: ["ls-remote"] },
        permissions: NEEDS.permissions,
        variables: NEEDS.variables,
      },
    ],
  });
  const repo = memoryRepository({ ...REPO, [SHIP_YML]: shipYml }, [pages], { interactive: true });
  return { ...repo, context: runningShiplane(repo.context, "0.6.0", callingPipeline(["0.6.0"])) };
};

describe("Feature: doctor checks ship.yml allows and passes what the adapters need", () => {
  it("given ship.yml with both, when doctor runs, then it asks nothing", async () => {
    const { context, prompter } = given(callerFor("0.6.0", NEEDS));

    expect(await doctor(context)).toBe(true);

    expect(prompter.asked).toEqual([]);
  });

  it("given ship.yml with neither, when the person agrees, then it has both", async () => {
    const { context, prompter, output, files } = given(callerFor("0.6.0"));
    prompter.answer(true, true);

    expect(await doctor(context)).toBe(true);

    expect(output.lines).toContain("│  ✗ ship.yml does not allow contents: write");
    expect(output.lines).toContain("│  ✗ ship.yml passes no SITE_KEY");
    expect(files.read(SHIP_YML)).toBe(callerFor("0.6.0", NEEDS));
  });
});
