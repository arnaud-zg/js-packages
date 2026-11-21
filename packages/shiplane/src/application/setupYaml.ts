import { isSeq, parseDocument, stringify } from "yaml";

import type { FlowChoice, FlowPort, ModuleEntry } from "./setupFiles";
import { SCHEMA_MODELINE } from "./config/configSchema";
import { CUSTOM_PORTS, customFiles, kebab } from "./customAdapter";
import { FLOW_PORTS } from "./setupFiles";

/** The YAML config setup writes when asked for `--format yaml`. */
export const YAML_CONFIG_FILE = "shiplane.yml";

/** The name each official flow adapter has in a catalog, by the factory a TS config calls. */
const FLOW_NAMES: Readonly<Record<string, string>> = {
  gitSourceControl: "git",
  gitHubCodeHost: "github",
  gitHubActionsCiPipeline: "github-actions",
  changesetsVersioning: "changesets",
  commitsVersioning: "commits",
};

/** The kind of each module factory setup composes. */
const MODULE_KINDS: Readonly<Record<string, string>> = {
  backendService: "backend-service",
  webApp: "web-app",
  mobileApp: "mobile-app",
  publishedPackage: "published-package",
};

const isLocalFrom = (from: string) => from.startsWith(".");

/** A flow port's adapter as shiplane.yml names it: a catalog name, or a local file's path. */
const flowName = ({ factory, from }: FlowChoice) =>
  isLocalFrom(from) ? `${from}.ts` : (FLOW_NAMES[factory] ?? factory);

/** A module as a shiplane.yml lists it: its kind, its name when not its kind, its adapter. */
const moduleItem = ({ factory, port, adapter, name, from }: ModuleEntry) => ({
  use: MODULE_KINDS[factory] ?? factory,
  with: {
    ...(name ? { name } : {}),
    [port]: isLocalFrom(from)
      ? `${from}.ts`
      : from.startsWith("@shiplane/")
        ? from.slice("@shiplane/".length)
        : adapter === "shellServerHosting"
          ? "shell"
          : adapter,
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
    body({ flow: Object.fromEntries(FLOW_PORTS.map((port) => [port, flowName(flow[port])])) }),
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
