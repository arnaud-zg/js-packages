import { isSeq, parseDocument, stringify } from "yaml";

import type { FlowChoice, FlowPort, ModuleEntry } from "./setupFiles";
import { SCHEMA_MODELINE } from "./config/configSchema";
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

const body = (value: Record<string, unknown>) => stringify(value, { lineWidth: 100 }).trimEnd();

/** A root shiplane.yml with this flow and these modules, in the order given. */
export const renderYamlConfig = (
  entries: readonly ModuleEntry[],
  flow: Record<FlowPort, FlowChoice>,
  units?: readonly string[],
) =>
  [
    SCHEMA_MODELINE,
    "# How this repository releases. shiplane schema gives your editor every key.",
    body({ flow: Object.fromEntries(FLOW_PORTS.map((port) => [port, flow[port].name])) }),
    ...(units ? [body({ units: [...units] })] : []),
    "# What gets released, in this order. The first app is the repository's Latest release.",
    body({ modules: entries.map(moduleItem) }),
    "",
  ].join("\n");

/** Adds a module to an existing shiplane.yml, its comments kept; null when it has no modules list. */
export const addToYamlConfig = (text: string, entry: ModuleEntry): string | null => {
  const document = parseDocument(text);
  const modules = document.get("modules");
  if (!isSeq(modules)) return null;
  modules.add(document.createNode(moduleItem(entry)));
  return document.toString({ lineWidth: 100 });
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
