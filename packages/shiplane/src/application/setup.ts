import path from "node:path";

import type { ReleaseModule } from "../modules/module";
import type { AnyDeliveryAdapter } from "../modules/suggest";
import type { FolderView } from "../ports/delivery.port";
import type { CustomPortKey } from "./customAdapter";
import type { SetupContext } from "./setupContext";
import type { FlowChoice, FlowPort, ModuleEntry } from "./setupFiles";
import { moduleFor } from "../modules/suggest";
import { callerWrite, renovateWrite } from "./callerWorkflow";
import { UNIT_FILE, UNIT_FILES } from "./config/readUnitFile";
import { expandPatterns, workspacePatterns } from "./config/workspaceFolders";
import { YAML_CONFIG_FILE, YAML_CONFIG_FILES } from "./config/yamlDeclaration";
import {
  CUSTOM_PORTS,
  customFiles,
  isFactoryName,
  kebab,
  renderCustomAdapter,
  renderCustomTest,
  suggestedName,
} from "./customAdapter";
import { askOptions } from "./initRelease";
import { readManifest } from "./manifest";
import { rehearse, runner } from "./rehearse";
import { paint } from "./say";
import {
  addToConfig,
  CHANGESETS_CLI,
  CHANGESETS_CONFIG,
  COMMITS_VERSIONING,
  CONFIG_FILE,
  DEFAULT_FLOW,
  FLOW_PORTS,
  folderView,
  placeModule,
  releasePackage,
  renderConfig,
  renderUnit,
  SCHEMA_FILE,
  schemaLineFor,
  schemaText,
} from "./setupFiles";
import { addToYamlConfig, renderYamlConfig, withCatalog } from "./setupYaml";
import { unattended } from "./unattended";

/** A file setup writes: its text, and whether it is new. */
export interface Write {
  file: string;
  text: string;
  created: boolean;
  /** Why setup writes it, said beside it when that is not plain from the file. */
  reason?: string;
}

const ok = paint("green", "✓");
const unsure = paint("yellow", "?");

const CHANGESETS_CONFIG_FILE = ".changeset/config.json";

/** What a flow port is called, and what proves the ready-made adapter fits. */
const FLOW_LABEL: Record<FlowPort, { label: string; ready: string }> = {
  sourceControl: { label: "Source control", ready: "git" },
  codeHost: { label: "Code host", ready: "GitHub" },
  ciPipeline: { label: "CI pipeline", ready: "GitHub Actions" },
  versioning: { label: "Versioning", ready: "Changesets" },
};

/** The kinds of app a person picks from, in their words, and the delivery each one needs. */
const APP_KINDS = [
  { value: "server-hosting", label: "Backend service", hint: "a server that runs" },
  { value: "static-hosting", label: "Web application", hint: "static files on a CDN" },
  { value: "mobile-distribution", label: "Mobile application", hint: "store builds and updates" },
  { value: "package-registry", label: "Published package", hint: "a library others install" },
  { value: "skip", label: "Internal tool", hint: "versioned, never deployed" },
] as const;

type AppKind = (typeof APP_KINDS)[number]["value"];

const CUSTOM_PORT_OF: Record<Exclude<AppKind, "skip">, CustomPortKey> = {
  "server-hosting": "serverHosting",
  "static-hosting": "staticHosting",
  "mobile-distribution": "mobileDistribution",
  "package-registry": "packageRegistry",
};

const MODULE_OF: Record<CustomPortKey, string> = {
  sourceControl: "",
  codeHost: "",
  ciPipeline: "",
  versioning: "",
  serverHosting: "backendService",
  staticHosting: "webApp",
  mobileDistribution: "mobileApp",
  packageRegistry: "publishedPackage",
};

/** What proves each ready-made flow adapter fits this repository: hard evidence only. */
const flowEvidence = async (context: SetupContext): Promise<Record<FlowPort, string | null>> => {
  const { files, shell, root } = context;
  const remote = files.exists(".git")
    ? (await shell.capture("git", ["remote", "get-url", "origin"], { cwd: root })).stdout.trim()
    : "";
  const github = /github\.com[:/]([^/]+\/[^/.]+)/.exec(remote)?.[1];
  const workflows = files.list(".github/workflows").filter((file) => /\.ya?ml$/.test(file));
  return {
    sourceControl: files.exists(".git") ? ".git" : null,
    codeHost: github ? `remote github.com/${github}` : null,
    ciPipeline: workflows[0] ? `.github/workflows/${workflows[0]}` : null,
    versioning: files.exists(CHANGESETS_CONFIG_FILE) ? CHANGESETS_CONFIG_FILE : null,
  };
};

/** A name for a custom adapter: asked, checked, unused. Null when cancelled. */
const askName = async (
  context: SetupContext,
  port: CustomPortKey,
  initial: string,
): Promise<string | null> => {
  const { prompter, output, files } = context;
  for (;;) {
    const name = await prompter.text("Name it (you can rename it later)", initial);
    if (name === null) return null;
    if (!isFactoryName(name)) {
      output.line(`  ${paint("red", "✗")} ${name}: a name like ${suggestedName(port)}`);
      continue;
    }
    if (files.exists(customFiles(name).file)) {
      output.line(`  ${paint("red", "✗")} ${customFiles(name).file} already exists`);
      continue;
    }
    return name;
  }
};

/** The custom adapter's two files. */
const customWrites = (port: CustomPortKey, name: string, pkg: string): Write[] => [
  { file: customFiles(name).file, text: renderCustomAdapter(port, name, pkg), created: true },
  { file: customFiles(name).test, text: renderCustomTest(port, name, pkg), created: true },
];

/** What both ways of versioning need: the changesets config, and its CLI when it is missing. */
const changesetsWrites = ({ files }: SetupContext): Write[] => {
  const manifest = readManifest({ files, dir: "." });
  const present = { ...manifest?.dependencies, ...manifest?.devDependencies }[CHANGESETS_CLI.name];
  return [
    { file: CHANGESETS_CONFIG_FILE, text: CHANGESETS_CONFIG, created: true },
    ...(manifest === null || present
      ? []
      : [
          {
            file: "package.json",
            text: `${JSON.stringify(
              {
                ...manifest,
                devDependencies: {
                  ...manifest.devDependencies,
                  [CHANGESETS_CLI.name]: CHANGESETS_CLI.version,
                },
              },
              null,
              2,
            )}\n`,
            created: false,
          },
        ]),
  ];
};

/** How a repository with no changesets config releases: asked once, commits unless told. */
const chooseVersioning = async (
  context: SetupContext,
  yes: boolean,
  writes: Write[],
  pkg: string,
): Promise<FlowChoice | null> => {
  const { prompter } = context;
  const picked = unattended({ prompter, options: { yes } })
    ? "commits"
    : await prompter.select(
        "How do you want to release?",
        [
          {
            value: "commits",
            label: "From commits",
            hint: "feat, fix and ! set the version, nothing to write",
          },
          {
            value: "changesets",
            label: "From changesets",
            hint: "you write what ships, and when",
          },
          { value: "custom", label: "Custom", hint: "a no-op in memory you implement" },
        ],
        "commits",
      );
  if (picked === null) return null;
  if (picked === "custom") {
    const name = await askName(context, "versioning", suggestedName("versioning"));
    if (name === null) return null;
    writes.push(...customWrites("versioning", name, pkg));
    return { factory: name, from: customFiles(name).from, name: `${customFiles(name).from}.ts` };
  }
  writes.push(...changesetsWrites(context));
  return picked === "commits" ? COMMITS_VERSIONING : DEFAULT_FLOW.versioning;
};

/** The flow, from what the repository proves; asked part by part when unsure or when asked to. */
const chooseFlow = async (
  context: SetupContext,
  yes: boolean,
  needsPerson: string[],
  writes: Write[],
  pkg: string,
): Promise<Record<FlowPort, FlowChoice> | null> => {
  const { output, prompter } = context;
  const evidence = await flowEvidence(context);
  output.line(paint("bold", "  Flow"));
  FLOW_PORTS.forEach((port) => {
    const proof = evidence[port];
    const { label, ready } = FLOW_LABEL[port];
    output.line(
      proof
        ? `  ${ok} ${ready.padEnd(16)}${paint("dim", proof)}`
        : `  ${unsure} ${label.padEnd(16)}${paint("dim", "not sure: nothing here proves one")}`,
    );
  });
  const sure = FLOW_PORTS.every((port) => evidence[port] !== null);
  // Proven: nothing to ask. The rehearsal and "Write it?" are the check.
  if (sure) return DEFAULT_FLOW;
  const missing = FLOW_PORTS.filter((port) => !evidence[port] && port !== "versioning");
  if (yes && missing.length > 0) {
    needsPerson.push(
      ...missing.map((port) => `the ${FLOW_LABEL[port].label.toLowerCase()} (nothing proves one)`),
    );
    return null;
  }
  const flow = { ...DEFAULT_FLOW };
  // Only how it versions is left open: the rest is proven, so nothing else is asked.
  for (const port of missing.length > 0 ? FLOW_PORTS : (["versioning"] as const)) {
    if (port === "versioning" && !evidence.versioning) {
      const choice = await chooseVersioning(context, yes, writes, pkg);
      if (choice === null) return null;
      flow.versioning = choice;
      continue;
    }
    const { label, ready } = FLOW_LABEL[port];
    const picked = await prompter.select(
      `${label}?`,
      [
        {
          value: "ready",
          label: ready,
          hint: `${DEFAULT_FLOW[port].from}${evidence[port] ? "" : ", not found here"}`,
        },
        { value: "custom", label: "Custom", hint: "a no-op in memory you implement" },
      ],
      evidence[port] ? "ready" : "custom",
    );
    if (picked === null) return null;
    if (picked === "custom") {
      const name = await askName(context, port, suggestedName(port));
      if (name === null) return null;
      flow[port] = {
        factory: name,
        from: customFiles(name).from,
        name: `${customFiles(name).from}.ts`,
      };
      writes.push(...customWrites(port, name, pkg));
    }
  }
  return flow;
};

/** Where the apps live: prefilled from the workspace when those folders exist, else typed. */
const chooseFolders = async (
  context: SetupContext,
  yes: boolean,
  needsPerson: string[],
): Promise<string[] | null> => {
  const { prompter, output, files } = context;
  const known = workspacePatterns(files).filter(
    (pattern) => pattern.startsWith("!") || expandPatterns(files, [pattern]).length > 0,
  );
  const found = expandPatterns(files, known).filter((dir) => dir !== ".");
  output.line();
  output.line(paint("bold", "  Apps"));
  if (found.length === 0 && yes) {
    needsPerson.push("where the apps are (no workspace folders found)");
    return null;
  }
  const listed = known.filter((pattern) => !pattern.startsWith("!")).join(", ");
  const taken =
    found.length > 0 &&
    (yes ||
      (await prompter.confirm(
        `Your apps and packages are in ${listed} (${found.length} folders)?`,
        true,
      )));
  if (taken) return known;
  for (;;) {
    const typed = await prompter.text("Where are your apps and packages? (e.g. apps/*, web)");
    if (typed === null) return null;
    const patterns = typed
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const empty = patterns.filter((pattern) => expandPatterns(files, [pattern]).length === 0);
    if (patterns.length > 0 && empty.length === 0) return patterns;
    output.line(
      `  ${paint("red", "✗")} ${empty.join(", ") || "nothing typed"} matches no folder: try again`,
    );
  }
};

/** Folders under these patterns with a manifest and no unit file yet. */
const newFolders = (context: SetupContext, patterns: readonly string[]): FolderView[] =>
  expandPatterns(context.files, patterns)
    .filter((dir) => dir !== "." && context.files.exists(path.posix.join(dir, "package.json")))
    .filter((dir) => !UNIT_FILES.some((name) => context.files.exists(path.posix.join(dir, name))))
    .map((dir) => folderView(context.files, dir));

interface Placed {
  folder: FolderView;
  module: string;
  options: Record<string, unknown>;
  reason?: string;
}

/** How a folder ships: taken when an adapter is sure, asked otherwise. Null: not shipped. */
const placeFolder = async (
  context: SetupContext,
  folder: FolderView,
  state: {
    yes: boolean;
    needsPerson: string[];
    modules: ReleaseModule[];
    entries: ModuleEntry[];
    writes: Write[];
    pkg: string;
  },
): Promise<Placed | "skip" | null> => {
  const { prompter, output, adapters } = context;
  const sure = adapters
    .map((adapter) => ({ adapter, detection: adapter.detect?.(folder) ?? null }))
    .find(({ detection }) => detection?.certainty === "found");
  const place = (adapter: AnyDeliveryAdapter) => {
    const { name, entry } = placeModule(adapter, state.modules, state.pkg);
    if (entry) {
      state.entries.push(entry);
      state.modules.push(moduleFor(adapter, name));
    }
    return name;
  };
  if (sure?.detection) {
    const kind = APP_KINDS.find(({ value }) => value === sure.adapter.capability)?.label ?? "";
    output.line(
      `  ${ok} ${folder.dir.padEnd(18)}${kind} → ${sure.adapter.name}   ${paint("dim", `proof: ${sure.detection.reason}`)}`,
    );
    const options = await askOptions(
      context,
      folder,
      sure.adapter,
      sure.detection.options,
      state.yes,
    );
    return {
      folder,
      module: place(sure.adapter),
      options,
      reason: sure.detection.reason,
    };
  }
  if (state.yes) {
    state.needsPerson.push(`${folder.dir} (no adapter is sure what it is)`);
    return null;
  }
  output.line(`  ${unsure} ${folder.dir.padEnd(18)}${paint("dim", "not sure what this is")}`);
  // The modules the config already has come first: your own adapters included.
  const answer = await prompter.select<string>(`What is ${folder.dir}?`, [
    ...state.modules.map((module) => ({
      value: `module:${module.name}`,
      label: `Like ${module.name}`,
      hint: `${module.kind} on ${module.provider}, already in your config`,
    })),
    ...APP_KINDS.map(({ value, label, hint }) => ({ value, label, hint })),
  ]);
  if (answer === null) return null;
  if (answer.startsWith("module:")) {
    return { folder, module: answer.slice("module:".length), options: {} };
  }
  const kind = answer as AppKind;
  if (kind === "skip") return "skip";
  const fitting = adapters.filter((a) => a.capability === kind);
  const picked =
    fitting.length === 0
      ? "custom"
      : await prompter.select(
          `Where does ${folder.dir} go?`,
          [
            ...fitting.map((adapter) => ({ value: adapter.name, label: adapter.name })),
            { value: "custom", label: "Custom", hint: "a no-op adapter you implement" },
          ],
          fitting[0]?.name,
        );
  if (picked === null) return null;
  const adapter = fitting.find(({ name }) => name === picked);
  if (adapter) {
    const options = await askOptions(context, folder, adapter, {}, false);
    return { folder, module: place(adapter), options };
  }
  const port = CUSTOM_PORT_OF[kind];
  const name = await askName(
    context,
    port,
    `${path.posix.basename(folder.dir)}Delivery`.replace(/-([a-z])/g, (_m, c: string) =>
      c.toUpperCase(),
    ),
  );
  if (name === null) return null;
  const module = kebab(name);
  state.entries.push({
    factory: MODULE_OF[port],
    port,
    adapter: name,
    name: module,
    from: customFiles(name).from,
  });
  state.writes.push(...customWrites(port, name, state.pkg));
  return { folder, module, options: {} };
};

/** The config: written whole the first time, else the new modules added to the one there. */
const configWrites = (
  { files }: SetupContext,
  {
    existing,
    entries,
    pkg,
    flow,
    patterns,
    yaml,
  }: {
    existing: boolean;
    entries: readonly ModuleEntry[];
    pkg: string;
    flow: Record<FlowPort, FlowChoice> | null;
    patterns: string[] | null;
    /** Set when the config is, or is to be, shiplane.yml. */
    yaml: boolean;
  },
): Write[] => {
  const file = yaml ? YAML_CONFIG_FILE : CONFIG_FILE;
  if (!existing) {
    const units =
      patterns && patterns.join() !== workspacePatterns(files).join() ? patterns : undefined;
    const text = yaml
      ? renderYamlConfig(entries, flow ?? DEFAULT_FLOW, units)
      : renderConfig(entries, pkg, flow ?? DEFAULT_FLOW, units);
    return [{ file, text, created: true }];
  }
  if (entries.length === 0) return [];
  const before = files.read(file) ?? "";
  const add = (text: string, entry: ModuleEntry) =>
    (yaml ? addToYamlConfig(text, entry) : addToConfig(text, entry, pkg)) ?? text;
  return [{ file, text: entries.reduce(add, before), created: false }];
};

/** In a YAML config, each custom adapter's file also exports the catalog shiplane.yml names. */
const withCatalogs = (
  writes: readonly Write[],
  entries: readonly ModuleEntry[],
  flow: Record<FlowPort, FlowChoice> | null,
  pkg: string,
): Write[] => {
  const custom = [
    ...entries.map(({ port, adapter, from }) => ({ port, name: adapter, from })),
    ...(flow
      ? FLOW_PORTS.map((port) => ({ port, name: flow[port].factory, from: flow[port].from }))
      : []),
  ].filter(({ from }) => from.startsWith("."));
  return writes.map((write) => {
    const found = custom.find(({ name }) => customFiles(name).file === write.file);
    return found && isCustomPort(found.port)
      ? { ...write, text: withCatalog(write.text, found.port, found.name, pkg) }
      : write;
  });
};

const isCustomPort = (port: string): port is CustomPortKey => port in CUSTOM_PORTS;

/** The command that builds a folder: its unit's, its package.json script's, or one asked once. */
const buildFor = async (
  context: SetupContext,
  folder: FolderView,
  yes: boolean,
): Promise<string | null> => {
  if (readManifest({ files: context.files, dir: folder.dir })?.scripts?.build) return null;
  if (yes) return null;
  const typed = await context.prompter.text(
    `${folder.dir} has no "build" script. Command to build it? (empty: nothing to build)`,
  );
  return typed?.trim() ? typed.trim() : null;
};

/**
 * `shiplane setup`: the one command to set releases up and keep them right. It reads the
 * repository, takes what it can prove, asks only the rest, then rehearses a release (builds, plan,
 * sign-ins) with nothing pushed or deployed. Files are kept only when the rehearsal passes. Run
 * again, it says all is set or offers what changed.
 */
export const setup = async (
  context: SetupContext,
  { yes, format = "ts" }: { yes: boolean; format?: "ts" | "yaml" },
): Promise<boolean> => {
  const { output, prompter, files } = context;
  const pkg = releasePackage(files);
  const needsPerson: string[] = [];
  const writes: Write[] = [];
  output.line();
  output.line(`  ${paint("bold", "shiplane setup")}  ${paint("dim", path.basename(context.root))}`);
  output.line();

  // The config in place decides its own format; --format only picks a new one's.
  const configFile = files.exists(CONFIG_FILE)
    ? CONFIG_FILE
    : (YAML_CONFIG_FILES.find((file) => files.exists(file)) ?? null);
  const yaml = configFile === null ? format === "yaml" : configFile !== CONFIG_FILE;
  const existing = configFile ? await context.load() : null;
  if (existing && existing.problems.length > 0) {
    existing.problems.forEach(({ file, line, message, hint }) => {
      output.line(
        `  ${paint("red", "✗")} ${paint("bold", line === undefined ? file : `${file}:${line}`)}  ${message}`,
      );
      if (hint) output.line(`     ${paint("dim", hint)}`);
    });
    output.line(`  ${paint("dim", "Fix these, then run shiplane setup again. Nothing written.")}`);
    return false;
  }

  const flow = existing ? null : await chooseFlow(context, yes, needsPerson, writes, pkg);
  if (existing) output.line(`  ${ok} flow  ${paint("dim", configFile ?? CONFIG_FILE)}`);
  if (!existing && !flow && needsPerson.length === 0) return cancelled(context);

  const patterns = existing
    ? existing.units.length > 0
      ? workspacePatterns(files)
      : await chooseFolders(context, yes, needsPerson)
    : await chooseFolders(context, yes, needsPerson);
  if (!patterns && needsPerson.length === 0) return cancelled(context);
  if (existing && existing.units.length > 0) {
    output.line(
      `  ${ok} ${existing.units.length} apps  ${paint("dim", "unchanged, your edits kept")}`,
    );
  }

  const modules: ReleaseModule[] = [...(existing?.modules ?? [])];
  const entries: ModuleEntry[] = [];
  const placed: Placed[] = [];
  for (const folder of patterns ? newFolders(context, patterns) : []) {
    const result = await placeFolder(context, folder, {
      yes,
      needsPerson,
      modules,
      entries,
      writes,
      pkg,
    });
    if (result === null && needsPerson.length === 0) return cancelled(context);
    if (result && result !== "skip") {
      const buildCommand = await buildFor(context, folder, yes);
      placed.push(
        buildCommand ? { ...result, options: { buildCommand, ...result.options } } : result,
      );
    }
  }

  if (needsPerson.length > 0) {
    output.line();
    output.line(
      `  ${paint("red", "✗")} ${needsPerson.length} thing${needsPerson.length === 1 ? "" : "s"} need${needsPerson.length === 1 ? "s" : ""} a person:`,
    );
    needsPerson.forEach((item) => output.line(`     ${item}`));
    output.line(`  ${paint("dim", "Run shiplane setup without --yes. Nothing written.")}`);
    return false;
  }

  if (yaml) writes.splice(0, writes.length, ...withCatalogs(writes, entries, flow, pkg));
  writes.unshift(
    ...configWrites(context, { existing: existing !== null, entries, pkg, flow, patterns, yaml }),
  );
  placed.forEach(({ folder, module, options, reason }) =>
    writes.push({
      file: path.posix.join(folder.dir, UNIT_FILE),
      text: renderUnit(module, options, { reason, schemaLine: schemaLineFor(folder.dir) }),
      created: true,
    }),
  );

  // The workflow that ships on CI: from the config there, or once a new one is written.
  const caller = existing ? await callerWrite(context, existing) : null;
  if (caller) writes.push(caller);
  const renovate = existing ? renovateWrite(context, existing, caller?.text) : null;
  if (renovate) writes.push(renovate);

  if (writes.length === 0) {
    const passed = await rehearse(context);
    if (passed) output.line(`  ${ok} all set`);
    return passed;
  }

  // Written to rehearse on, put back as they were unless it passes.
  const before = [...writes.map(({ file }) => file), SCHEMA_FILE].map((file) => ({
    file,
    text: files.read(file),
  }));
  writes.forEach(({ file, text }) => files.write(file, text));
  if (existing === null || entries.length > 0) {
    const release = await context.load();
    if (release.modules.length > 0) files.write(SCHEMA_FILE, schemaText(release.modules));
    const written = existing ? null : await callerWrite(context, release);
    if (written) {
      before.push({ file: written.file, text: null });
      files.write(written.file, written.text);
      writes.push(written);
    }
    const renovate = existing ? null : renovateWrite(context, release);
    if (renovate) {
      before.push({ file: renovate.file, text: files.read(renovate.file) });
      files.write(renovate.file, renovate.text);
      writes.push(renovate);
    }
  }
  const passed = await rehearse(context);
  const keep = passed && (yes || (await prompter.confirm("Releasable. Write it?", true)));
  if (!keep) {
    before.forEach(({ file, text }) =>
      text === null ? files.remove(file) : files.write(file, text),
    );
    output.line(
      `  ${paint("dim", passed ? "Nothing written." : "Fix it, then run shiplane setup again. Nothing written.")}`,
    );
    return false;
  }
  writes.forEach(({ file, created, reason }) =>
    output.line(
      `  ${created ? paint("green", "+") : paint("yellow", "~")} ${file}${reason ? `  ${paint("dim", reason)}` : ""}`,
    ),
  );
  const custom = writes.some(({ file }) => file.startsWith("shiplane/adapters/"));
  if (custom) {
    output.line(
      `  ${paint("dim", "Custom adapters start in memory: fill them in until their contract test passes.")}`,
    );
    output.line(
      `  ${paint("dim", "Works? Share it as shiplane-<name>, or open a pull request at github.com/arnaud-zg/packages.")}`,
    );
  }
  const fromCommits = flow
    ? flow.versioning.factory === COMMITS_VERSIONING.factory
    : existing?.flow.versioning.name === "commits";
  const next = fromCommits ? "erge a commit" : "dd a changeset, merge";
  const install = writes.some(({ file }) => file === "package.json");
  const start = fromCommits ? "m" : "a";
  output.line();
  output.line(
    `  ${ok} ${paint("bold", "Ready.")} ${install ? `Run ${runner(context)} install, then ${start}` : start.toUpperCase()}${next}, and run ${paint("cyan", "shiplane")}`,
  );
  return true;
};

const cancelled = (context: SetupContext) => {
  context.output.line(`  ${paint("dim", "Nothing written.")}`);
  return false;
};
