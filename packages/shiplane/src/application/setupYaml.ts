import { isSeq, parseDocument } from "yaml";

import type { FlowChoice, FlowPort, ModuleEntry } from "./setupFiles";
import { stepsOf } from "./chooseEnvironments";
import { SCHEMA_MODELINE } from "./config/configSchema";
import { oneLineLists, YAML_WRITE, yamlText } from "./config/yamlText";
import { CUSTOM_PORTS, customFiles, kebab } from "./customAdapter";
import { adapterNameOf, FLOW_PORTS } from "./setupFiles";

/** A module as a shiplane.yml lists it: its kind, its name when not its kind, its adapter. */
const moduleItem = ({ factory, port, adapter, name, from }: ModuleEntry) => ({
  use: kebab(factory),
  with: {
    ...(name ? { name } : {}),
    [port]: from.startsWith(".") ? `${from}.ts` : adapterNameOf(adapter, port),
  },
});

const body = (value: Record<string, unknown>) => yamlText(value).trimEnd();

/** A root shiplane.yml with this flow and these modules, in the order given. */
export const renderYamlConfig = (
  entries: readonly ModuleEntry[],
  flow: Record<FlowPort, FlowChoice>,
  units?: readonly string[],
  path?: readonly string[] | null,
) =>
  [
    SCHEMA_MODELINE,
    "# How this repository releases. Your editor completes every key from the schema above.",
    body({ flow: Object.fromEntries(FLOW_PORTS.map((port) => [port, flow[port].name])) }),
    ...(units ? [body({ units: [...units] })] : []),
    ...(path ? [body({ deployApps: { promote: stepsOf(path) } })] : []),
    "# What gets released, in this order. The first app is the repository's Latest release.",
    body({ modules: entries.map(moduleItem) }),
    "",
  ].join("\n");

/** An existing shiplane.yml saying how apps go to their users, its comments kept. */
export const withYamlPromote = (text: string, path: readonly string[]) => {
  const document = parseDocument(text);
  document.set("deployApps", document.createNode({ promote: stepsOf(path) }));
  return document.toString(YAML_WRITE);
};

/** Adds a module to an existing shiplane.yml, its comments kept; null when it has no modules list. */
export const addToYamlConfig = (text: string, entry: ModuleEntry): string | null => {
  const document = parseDocument(text);
  const modules = document.get("modules");
  if (!isSeq(modules)) return null;
  // Only the new item: the lists already there keep the style they were written in.
  const item = document.createNode(moduleItem(entry));
  oneLineLists(item);
  modules.add(item);
  return document.toString(YAML_WRITE);
};

/** A custom adapter's file, with the catalog a shiplane.yml names it by. */
export const withCatalog = (
  text: string,
  port: keyof typeof CUSTOM_PORTS,
  name: string,
  pkg: string,
) => {
  const zImport = `import { z } from "${pkg}";`;
  return `import { adapterEntry } from "${pkg}/plugin";
${text.includes(zImport) ? "" : `${zImport}\n`}${text}
// What shiplane.yml names, by this file's path: ${customFiles(name).from}.ts
export const catalog = [
  adapterEntry({
    name: "${kebab(name)}",
    port: "${port}",
    description: "${name}: your own ${CUSTOM_PORTS[port].label}",
    options: z.object({}),
    make: () => ${name}(),
  }),
];
`;
};
