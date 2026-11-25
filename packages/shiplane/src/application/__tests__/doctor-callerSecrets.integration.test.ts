import { describe, expect, it } from "vitest";

import { serverHostingFake } from "../../adapters/server-hosting/__fakes__/server-hosting.fake";
import { memoryRepository } from "../../testing/memoryRepository";
import { doctor } from "../doctor";
import { callerFor, callingPipeline, runningShiplane, SHIP_YML } from "./callerWorld";

// shiplane doctor checking the secrets ship.yml passes, in memory: an app ships with an adapter
// that reads EXPO_TOKEN on a runner, and the CI pipeline is a Fake making the caller workflow.

const REPO = {
  "shiplane.config.ts": "export default defineRelease({ modules: [] });\n",
  "pnpm-workspace.yaml": "packages:\n  - apps/*\n",
  "apps/expo/package.json": JSON.stringify({ name: "@acme/expo", version: "0.1.0" }),
  "apps/expo/shiplane.unit.yml": "module: backend-service\nservice: expo\n",
};

/** A ship.yml written by hand around shiplane's workflow, pinned to the shiplane installed. */
const OWN = [
  "# Ours: ships on a manual run.",
  "name: Ship it",
  "on: workflow_dispatch",
  "permissions:",
  "  contents: read",
  "  issues: write",
  "jobs:",
  "  ship:",
  "    steps:",
  "      - uses: acme/shiplane/.github/actions/ship@sha-0.6.0 # shiplane@0.6.0",
  "        with:",
  "          environment: staging",
  "          SENTRY_TOKEN: ${{ secrets.SENTRY_TOKEN }} # ours",
  "  notify:",
  "    runs-on: ubuntu-latest",
  "",
].join("\n");

/** OWN once doctor passes EXPO_TOKEN only, with the permissions the release needs. */
const FIXED = OWN.replace("  issues: write\n", "").replace(
  "          SENTRY_TOKEN: ${{ secrets.SENTRY_TOKEN }} # ours",
  "          EXPO_TOKEN: ${{ secrets.EXPO_TOKEN }}",
);

const NEEDS = { apps: [], environments: [], secrets: ["EXPO_TOKEN"], features: [] };

const given = ({
  files = {},
  interactive = true,
  secrets = ["EXPO_TOKEN"],
}: { files?: Record<string, string>; interactive?: boolean; secrets?: string[] } = {}) => {
  const storectl = { ...serverHostingFake(), name: "storectl" };
  storectl.fake.seed({
    requirements: [
      { label: "storectl", check: { command: "storectl", args: ["whoami"] }, secrets },
    ],
  });
  const repo = memoryRepository({ ...REPO, ...files }, [storectl], { interactive });
  const context = runningShiplane(repo.context, "0.6.0", callingPipeline(["0.6.0"]));
  return { ...repo, context };
};

describe("Feature: doctor checks ship.yml passes the secrets the adapters need", () => {
  it("given ship.yml passing each secret the adapters need, when doctor runs, then it says so in one line", async () => {
    const { context, output, prompter } = given({
      files: { [SHIP_YML]: callerFor("0.6.0", NEEDS) },
    });

    expect(await doctor(context)).toBe(true);

    expect(output.lines).toContain("│  ✓ ship.yml  shiplane@0.6.0");
    expect(prompter.asked).toEqual([]);
  });

  it("given ship.yml missing a secret and passing one no adapter needs, when the person agrees, then only its secrets and permissions are rewritten", async () => {
    const { context, output, prompter, files } = given({ files: { [SHIP_YML]: OWN } });
    prompter.answer(true);

    expect(await doctor(context)).toBe(true);

    expect(output.lines).toContain(
      "│  ✗ ship.yml passes no EXPO_TOKEN, and apps/expo ships with storectl; passes SENTRY_TOKEN, which no adapter needs",
    );
    const [asked = ""] = prompter.asked;
    expect(asked).toBe(
      `Pass ${SHIP_YML} only the secrets its adapters need, with the permissions they need?`,
    );
    expect(prompter.initials[asked]).toBe(true);
    expect(files.read(SHIP_YML)).toBe(FIXED);
    expect(output.lines).toContain(`│  ~ ${SHIP_YML}`);
  });

  it("given ship.yml missing a secret, when doctor runs with --yes, then its secrets are rewritten without asking", async () => {
    const { context, prompter, files } = given({ files: { [SHIP_YML]: OWN } });

    expect(await doctor(context, { yes: true })).toBe(true);

    expect(prompter.asked).toEqual([]);
    expect(files.read(SHIP_YML)).toBe(FIXED);
  });

  it("given ship.yml missing a secret, when the person declines, then it is kept as written and doctor fails", async () => {
    const { context, prompter, files } = given({ files: { [SHIP_YML]: OWN } });
    prompter.answer(false);

    expect(await doctor(context)).toBe(false);

    expect(files.read(SHIP_YML)).toBe(OWN);
  });

  it("given ship.yml passing no secret at all, when doctor runs with --yes, then the secrets go after the action's other inputs", async () => {
    const bare = OWN.replace("          SENTRY_TOKEN: ${{ secrets.SENTRY_TOKEN }} # ours\n", "");
    const { context, output, files } = given({ files: { [SHIP_YML]: bare } });

    expect(await doctor(context, { yes: true })).toBe(true);

    expect(output.lines).toContain(
      "│  ✗ ship.yml passes no EXPO_TOKEN, and apps/expo ships with storectl",
    );
    expect(files.read(SHIP_YML)).toBe(FIXED);
  });

  it("given ship.yml pinned to an older shiplane and missing a secret, when doctor runs with --yes, then both are fixed", async () => {
    const old = OWN.replace("@sha-0.6.0 # shiplane@0.6.0", "@sha-0.5.2 # shiplane@0.5.2");
    const { context, output, files } = given({ files: { [SHIP_YML]: old } });

    expect(await doctor(context, { yes: true })).toBe(true);

    expect(output.lines).toContain("│  ✗ ship.yml pins shiplane@0.5.2, installed 0.6.0");
    expect(files.read(SHIP_YML)).toBe(FIXED);
  });

  it("given ship.yml pinned to an older shiplane and missing a secret, when the person re-pins only, then doctor still fails", async () => {
    const old = OWN.replace("@sha-0.6.0 # shiplane@0.6.0", "@sha-0.5.2 # shiplane@0.5.2");
    const { context, prompter, files } = given({ files: { [SHIP_YML]: old } });
    prompter.answer(true, false);

    expect(await doctor(context)).toBe(false);

    expect(files.read(SHIP_YML)).toBe(OWN);
  });
});
