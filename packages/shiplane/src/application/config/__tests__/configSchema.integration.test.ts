import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import type { Workspace } from "../../../testing/workspace";
import { nodeFiles } from "../../../adapters/files/node-files.adapter";
import { MemoryOutput } from "../../../adapters/terminal/__fakes__/terminal.fake";
import { schemaCatalog } from "../../../cli/plugins";
import { FAKES_CATALOG, YAML_MODULE_CONFIG } from "../../../testing/moduleConfig";
import { createWorkspace, SOURCE_ALIASES } from "../../../testing/workspace";
import { writeConfigSchema } from "../../configSchemaFile";
import { CONFIG_SCHEMA_FILE, SCHEMA_MODELINE } from "../configSchema";

let workspace: Workspace | undefined;
afterEach(() => workspace?.remove());

const run = async (files: Record<string, string>) => {
  workspace = createWorkspace(files);
  const output = new MemoryOutput();
  writeConfigSchema(
    { files: nodeFiles(workspace.root), output },
    await schemaCatalog(workspace.root, SOURCE_ALIASES),
  );
  const schema: unknown = JSON.parse(workspace.read(CONFIG_SCHEMA_FILE));
  return { output, schema, workspace };
};

const FlowSchema = z.object({
  properties: z.object({ flow: z.object({ properties: z.record(z.string(), z.unknown()) }) }),
});

/** The names a slot offers as a short string. */
const shortNames = (slot: unknown) =>
  JSON.stringify(slot)
    .match(/"const":"[^"]+"/g)
    ?.map((match) => match.slice(9, -1)) ?? [];

describe("shiplane schema", () => {
  it("given an adapter file in shiplane/adapters, when the schema is written, then each slot of its port offers it by its path", async () => {
    const { schema } = await run({ "shiplane/adapters/fakes.ts": FAKES_CATALOG });

    expect(schema).toMatchObject({ title: "shiplane.yml", required: ["flow", "modules"] });
    const { flow } = FlowSchema.parse(schema).properties;
    expect(shortNames(flow.properties.versioning)).toContain("./shiplane/adapters/fakes.ts");
  });

  it("given a shiplane.yml with no schema line, when the schema is written, then shiplane.yml points the editor at it", async () => {
    const { output, workspace: written } = await run({
      "shiplane/adapters/fakes.ts": FAKES_CATALOG,
      "shiplane.yml": YAML_MODULE_CONFIG,
    });

    expect(written.read("shiplane.yml")).toBe(`${SCHEMA_MODELINE}\n${YAML_MODULE_CONFIG}`);
    expect(output.text).toContain("shiplane.yml points your editor at it");
  });

  it("given a shiplane.yml that already names a schema, when the schema is written, then shiplane.yml is left as it is", async () => {
    const own = `# yaml-language-server: $schema=./my.schema.json\n${YAML_MODULE_CONFIG}`;

    const { workspace: written } = await run({
      "shiplane/adapters/fakes.ts": FAKES_CATALOG,
      "shiplane.yml": own,
    });

    expect(written.read("shiplane.yml")).toBe(own);
  });

  it("given a module, when the schema is written, then its with offers the options and the adapter slot it takes", async () => {
    const { schema } = await run({ "shiplane/adapters/fakes.ts": FAKES_CATALOG });

    const text = JSON.stringify(schema);
    expect(text).toContain('"if":{"properties":{"use":{"const":"backend-service"}}');
    expect(text).toContain('"required":["serverHosting"]');
  });
});
