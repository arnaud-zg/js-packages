import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The core knows ports, never who implements them, and its tests must not either: a provider's words
// belong in that provider's package.

const SRC = fileURLToPath(new URL("..", import.meta.url));
const SELF = "__tests__/providerAgnostic.test.ts";
const TEST_CODE = /__tests__|__fakes__|\.contract\.ts$|^testing\//;
const PROVIDER = /GitHub|\bgh |github|GH_TOKEN|\bEAS\b|\beas\b|flyctl|wrangler|\bfly\b|cloudflare/;

// Test code for what the core itself still says about a provider. Remove a file once it is agnostic;
// never add one to make a new test pass.
const KNOWN = [
  "application/__tests__/adapters-terminal.integration.test.ts",
  "application/__tests__/callerWorld.ts",
  "application/__tests__/cli-commands.integration.test.ts",
  "application/__tests__/cli-setup-commands.integration.test.ts",
  "application/__tests__/doctor-callerSecrets.integration.test.ts",
  "application/__tests__/doctor-callerWorkflow.integration.test.ts",
  "application/__tests__/release-branchTestVersion.integration.test.ts",
  "application/__tests__/setup-again.integration.test.ts",
  "application/__tests__/setup-callerWorkflow.integration.test.ts",
  "application/__tests__/setup-configText.unit.test.ts",
  "application/__tests__/setup-questions.integration.test.ts",
  "application/__tests__/setup.integration.test.ts",
  "application/__tests__/setupFiles.unit.test.ts",
  "application/__tests__/setupYaml.integration.test.ts",
  "application/__tests__/ship-runner.integration.test.ts",
  "application/config/__tests__/loadRelease.test.ts",
  "application/config/__tests__/yamlDeclaration.unit.test.ts",
  "cli/__tests__/rehearsal.test.ts",
  "cli/__tests__/setup.e2e.test.ts",
  "domain/__tests__/codeScope.test.ts",
  "domain/__tests__/releaseTitle.test.ts",
  "testing/consumer.ts",
];

describe("the core's tests name no provider", () => {
  it("given the core's test code, when a provider is named, then only the known files do, and each still does", () => {
    const naming = readdirSync(SRC, { recursive: true, encoding: "utf8" })
      .map((file) => file.replaceAll("\\", "/"))
      .filter((file) => file.endsWith(".ts") && TEST_CODE.test(file) && file !== SELF)
      .filter((file) => PROVIDER.test(readFileSync(`${SRC}/${file}`, "utf8")))
      .sort();

    expect(naming).toEqual([...KNOWN].sort());
  });
});
