import { describe, expect, it } from "vitest";
import { z } from "zod";

import { serverHostingFake } from "../../adapters/server-hosting/__fakes__/server-hosting.fake";
import { staticHostingFake } from "../../adapters/static-hosting/__fakes__/static-hosting.fake";
import { moduleFor } from "../../modules/suggest";
import {
  adapterFactory,
  addToConfig,
  documentedKeys,
  placeModule,
  renderBlankUnit,
  renderConfig,
  renderUnit,
  SCHEMA_FILE,
  schemaLineFor,
  settingsKeys,
  withEditorSchema,
} from "../setupFiles";

// The text setup and init write: configs, unit files and the editor's schema, all in memory.

const CLOUD = {
  factory: "backendService",
  port: "serverHosting",
  adapter: "cloudServerHosting",
  from: "@shiplane/cloud",
};
const PAGES = {
  factory: "webApp",
  port: "staticHosting",
  adapter: "pagesStaticHosting",
  from: "@shiplane/pages",
};

const cloud = () => ({ ...serverHostingFake(), name: "cloud" });

describe("Feature: choosing which module ships each app in the config", () => {
  it("given an adapter named pages, when the config calls it, then its factory reads pagesStaticHosting", () => {
    expect(adapterFactory({ ...staticHostingFake(), name: "pages" })).toBe("pagesStaticHosting");
  });

  it("given no module yet, when an app on Cloud is placed, then a module of the kind's name is added, imported from the plugin", () => {
    expect(placeModule(cloud(), [], "shiplane")).toEqual({
      name: "backend-service",
      entry: {
        factory: "backendService",
        port: "serverHosting",
        adapter: "cloudServerHosting",
        from: "@shiplane/cloud",
      },
    });
  });

  it("given a module already shipping on Cloud, when another app on Cloud is placed, then it joins that module", () => {
    const held = moduleFor(cloud(), "api-servers");

    expect(placeModule(cloud(), [held])).toEqual({ name: "api-servers" });
  });

  it("given the kind's name taken by another provider, when an app on Cloud is placed, then its module is named after the provider", () => {
    const other = moduleFor({ ...serverHostingFake(), name: "render" }, "backend-service");

    expect(placeModule(cloud(), [other]).entry).toMatchObject({
      name: "backend-service-cloud",
      from: "@shiplane/cloud",
    });
  });

  it("given the built-in shell adapter, when it is placed, then it is imported from the CLI itself", () => {
    const shell = { ...serverHostingFake(), name: "shell" };

    expect(placeModule(shell, [], "@acme/shiplane").entry?.from).toBe("@acme/shiplane");
    expect(placeModule(shell, []).entry?.from).toBe("shiplane");
  });
});

describe("Feature: getting a readable first shiplane.config.ts", () => {
  it("given two modules, one built in, when the config is rendered, then the CLI import holds both and plugins follow in order", () => {
    const shell = {
      factory: "backendService",
      port: "serverHosting",
      adapter: "shellServerHosting",
      from: "shiplane",
    };

    const text = renderConfig([PAGES, shell, { ...CLOUD, name: "api" }]);

    expect(text.split("\n").slice(0, 6)).toEqual([
      'import { backendService, defineRelease, releaseFlow, shellServerHosting, webApp } from "shiplane";',
      'import { changesetsVersioning } from "@shiplane/changesets";',
      'import { cloudServerHosting } from "@shiplane/cloud";',
      'import { gitSourceControl } from "@shiplane/git";',
      'import { gitHubActionsCiPipeline, gitHubCodeHost } from "@shiplane/github";',
      'import { pagesStaticHosting } from "@shiplane/pages";',
    ]);
    expect(text).toContain(
      [
        "  modules: [",
        "    webApp({ staticHosting: pagesStaticHosting() }),",
        "    backendService({ serverHosting: shellServerHosting() }),",
        '    backendService({ name: "api", serverHosting: cloudServerHosting() }),',
        "  ],",
        "});",
        "",
      ].join("\n"),
    );
    expect(text).toContain("export default defineRelease({\n  flow: releaseFlow({\n");
  });

  it("given two local adapters, when the config is rendered, then they come after the plugins, sorted", () => {
    const text = renderConfig([
      { ...CLOUD, from: "./shiplane/adapters/z-host" },
      { ...PAGES, from: "./shiplane/adapters/a-host" },
    ]);

    const lines = text.split("\n");
    expect(lines.indexOf('import { pagesStaticHosting } from "./shiplane/adapters/a-host";')).toBe(
      lines.indexOf('import { cloudServerHosting } from "./shiplane/adapters/z-host";') - 1,
    );
    expect(lines.findIndex((line) => line.includes("./shiplane"))).toBeGreaterThan(
      lines.findIndex((line) => line.includes("@shiplane/github")),
    );
  });

  it("given apps in two folders, when the config is rendered, then both are listed quoted", () => {
    expect(renderConfig([], "shiplane", undefined, ["apps/*", "tools/cli"])).toContain(
      '  units: ["apps/*", "tools/cli"],\n',
    );
  });
});

describe("Feature: adding an app to a shiplane.config.ts the person already edited", () => {
  const CONFIG = [
    'import { defineRelease, releaseFlow, webApp } from "shiplane";',
    'import { pagesStaticHosting } from "@shiplane/pages";',
    "",
    "export default defineRelease({",
    "  modules: [",
    "    webApp({ staticHosting: pagesStaticHosting() }),",
    "  ],",
    "});",
    "",
  ].join("\n");

  it("given a config over several lines, when a module is added, then it goes last with its import after the others", () => {
    expect(addToConfig(CONFIG, CLOUD)).toBe(
      [
        'import { backendService, defineRelease, releaseFlow, webApp } from "shiplane";',
        'import { pagesStaticHosting } from "@shiplane/pages";',
        'import { cloudServerHosting } from "@shiplane/cloud";',
        "",
        "export default defineRelease({",
        "  modules: [",
        "    webApp({ staticHosting: pagesStaticHosting() }),",
        "    backendService({ serverHosting: cloudServerHosting() }),",
        "  ],",
        "});",
        "",
      ].join("\n"),
    );
  });

  it("given a last module with no trailing comma, when one is added, then a comma is put between them", () => {
    const config = CONFIG.replace("pagesStaticHosting() }),", "pagesStaticHosting() })");

    expect(addToConfig(config, CLOUD)).toContain(
      "    webApp({ staticHosting: pagesStaticHosting() }),\n    backendService(",
    );
  });

  it("given modules on one line, when one is added, then it stays on that line", () => {
    const config =
      'import { defineRelease } from "shiplane";\nexport default defineRelease({ modules: [a()] });\n';

    expect(addToConfig(config, CLOUD)).toContain(
      "modules: [a(), backendService({ serverHosting: cloudServerHosting() })] });",
    );
  });

  it("given an empty modules list, when one is added, then it is the only one", () => {
    const config =
      'import { defineRelease } from "shiplane";\nexport default defineRelease({ modules: [] });\n';

    expect(addToConfig(config, CLOUD)).toContain(
      "modules: [backendService({ serverHosting: cloudServerHosting() })] });",
    );
  });

  it("given nested brackets in a module, when one is added, then it lands after the closing one", () => {
    const config =
      'import { defineRelease } from "shiplane";\ndefineRelease({ modules: [a({ b: [1] })], other: [2] });\n';

    expect(addToConfig(config, CLOUD)).toContain(
      "modules: [a({ b: [1] }), backendService({ serverHosting: cloudServerHosting() })], other: [2]",
    );
  });

  it("given the plugin already imported and the factory already there, when one is added, then no import is repeated", () => {
    const config = `${CONFIG.replace("webApp }", "backendService, webApp }")}`.replace(
      '"@shiplane/pages";',
      '"@shiplane/pages";\nimport { cloudServerHosting } from "@shiplane/cloud";',
    );

    const text = addToConfig(config, CLOUD) ?? "";

    expect(text.match(/@shiplane\/cloud/g)).toHaveLength(1);
    expect(text.match(/backendService/g)).toHaveLength(2);
  });

  it("given a built-in adapter, when it is added, then it joins the CLI's own import", () => {
    const shell = { ...CLOUD, adapter: "shellServerHosting", from: "shiplane" };

    expect(addToConfig(CONFIG, shell)).toContain(
      'import { backendService, defineRelease, releaseFlow, shellServerHosting, webApp } from "shiplane";',
    );
  });

  it("given a config that imports nothing, when one is added, then both imports go on top", () => {
    const text = addToConfig(
      "export default defineRelease({ modules: [] });\n",
      CLOUD,
      "@acme/cli",
    );

    expect(text).toBe(
      'import { backendService } from "@acme/cli";\nimport { cloudServerHosting } from "@shiplane/cloud";\nexport default defineRelease({ modules: [backendService({ serverHosting: cloudServerHosting() })] });\n',
    );
  });

  it("given a config with no modules list or an unclosed one, when a module is added, then setup leaves the file alone", () => {
    expect(addToConfig("export default {};", CLOUD)).toBeNull();
    expect(addToConfig("export default { modules: [ a(", CLOUD)).toBeNull();
  });
});

describe("Feature: unit files a person can read and fill in", () => {
  it("given settings found with a reason, when the unit file is written, then it says where it read them and links the schema", () => {
    expect(
      renderUnit(
        "backend-service",
        { service: "api" },
        { reason: "cloud.toml", schemaLine: "../s.json" },
      ),
    ).toBe(
      [
        "# yaml-language-server: $schema=../s.json",
        "# Written by shiplane init. Every key: shiplane docs backend-service",
        "# Read from cloud.toml",
        "",
        "module: backend-service",
        "service: api",
        "",
      ].join("\n"),
    );
  });

  it("given no reason nor schema, when the unit file is written, then only the docs line heads it", () => {
    expect(renderUnit("web-app", {}, {})).toBe(
      "# Written by shiplane init. Every key: shiplane docs web-app\n\nmodule: web-app\n",
    );
  });

  it("given a schema with a default and a required key, when a blank unit file is written, then each key is commented and described", () => {
    const settings = z.object({
      service: z.string().describe("The service"),
      region: z.string().default("cdg").describe("Where it runs"),
    });

    expect(renderBlankUnit("backend-service", settings, "../s.json")).toBe(
      [
        "# yaml-language-server: $schema=../s.json",
        "# Written by shiplane init --blank. Uncomment and fill what applies.",
        "module: backend-service",
        "",
        "# The service (required)",
        "# service:",
        "",
        "# Where it runs",
        '# region: "cdg"',
        "",
      ].join("\n"),
    );
    expect(renderBlankUnit("x", z.object({}))).toBe(
      "# Written by shiplane init --blank. Uncomment and fill what applies.\nmodule: x\n",
    );
  });

  it("given nested settings, when a module's keys are listed for the person, then each nested key is a dotted path with its default and whether it is required", () => {
    const settings = z.object({
      build: z.object({ command: z.string().describe("How"), out: z.string().optional() }),
      name: z.string().optional(),
    });

    expect(documentedKeys(settings)).toEqual([
      { key: "build.command", description: "How", default: undefined, required: true },
      { key: "build.out", description: "", default: undefined, required: false },
      { key: "name", description: "", default: undefined, required: false },
    ]);
    expect(settingsKeys(z.object({ a: z.number().default(1) }))).toEqual([
      { key: "a", description: "", default: 1, required: false },
    ]);
  });

  it("given an app two folders deep or at the root, when its unit file links the editor schema, then the link points back to the repository root", () => {
    expect(schemaLineFor("apps/api")).toBe(`../../${SCHEMA_FILE}`);
    expect(schemaLineFor(".")).toBe(SCHEMA_FILE);
  });

  it("given the person's editor settings, when setup maps unit files to the schema, then the mapping is added once and their own settings are kept", () => {
    const entry = `"yaml.schemas": { "./${SCHEMA_FILE}": "**/shiplane.unit.yml" }`;

    expect(withEditorSchema(null)).toBe(`{\n  ${entry}\n}\n`);
    expect(withEditorSchema('// mine\n{ "a": 1 }')).toBe(`// mine\n{\n  ${entry}, "a": 1 }`);
    expect(withEditorSchema('{ "yaml.schemas": {} }')).toBeNull();
    expect(withEditorSchema("not json")).toBeNull();
  });
});
