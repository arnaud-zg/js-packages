import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import type { DeployPath } from "../../domain/deploys";
import type { DisplayChoice } from "../../domain/display";
import type { DeployFlow, Environment } from "../../domain/environment";
import type { TestReleaseBranches } from "../../domain/testChannel";
import type { ReleaseUnit } from "../../domain/unit";
import type { Feature, ReleaseFlow, ReleaseModule } from "../../modules/module";
import type { ServiceAdapter } from "../../ports/adapter.port";
import type { ConfigReader } from "../../ports/config.port";
import type { ManifestReader } from "../../ports/manifest.port";
import type { ConfigProblem } from "./problem";
import type { UnitFile } from "./readUnitFile";
import { DEFAULT_FLOW, keysOf, LIVE, reachesUsers } from "../../domain/environment";
import { PrepareSchema } from "../../domain/prepare";
import { DEFAULT_TAG_FORMAT, TAG_FORMATS, tagFormatNamed } from "../../domain/tags";
import { channelProblem, channels } from "../../domain/testChannel";
import { ConfigError } from "../../ports/config.port";
import { releaseFlow } from "../releaseFlow";
import { reasonOf } from "../say";
import { sortProblems } from "./problem";
import { readUnitFile, UNIT_FILE, UNIT_FILES } from "./readUnitFile";
import { isRecord, referencesIn, valueAt } from "./values";
import { expandPatterns, workspacePatterns } from "./workspaceFolders";

/** A file still under its name from before shiplane, and the name it takes. */
export interface Rename {
  from: string;
  to: string;
}

const renameOf = (file: string): Rename | null =>
  /(^|\/)release\.(config|unit)\./.test(file)
    ? { from: file, to: file.replace(/(^|\/)release\./, "$1shiplane.") }
    : null;

/** The release as composed: the flow, the modules in release order, the features, then the apps. */
export interface Release {
  root: string;
  flow: ReleaseFlow;
  /** What gets released, in release order. */
  modules: ReleaseModule[];
  /** What happens around a release, in the order they run. */
  features: Feature[];
  /** In release order: by module, then by name inside a module. The first is the Latest release. */
  units: ReleaseUnit[];
  problems: ConfigProblem[];
  /** How a tag names a version, such as `{name}@{version}`. */
  tagFormat: string;
  /** The way apps go to their users (`deployApps.promote`); preview then production when unset. */
  appFlow?: DeployFlow;
  /** The channels packages publish on (`publishPackages.channels`); any when unset. */
  channels?: readonly string[];
  /** Where a branch may deploy apps (`deployApps.onBranch`). */
  deployOnBranch?: Environment | false;
  /** What a branch publishes outside the channels (`publishPackages.onBranch`); a snapshot when unset. */
  onBranch?: "snapshot" | false;
  /** How a unit ships when both ways can, as the config asks; unset, each ship asks. */
  via?: DeployPath;
  /** How much the release says while it runs, as the config asks. */
  display?: DisplayChoice;
  /** Files still under their name from before shiplane. */
  renames?: Rename[];
  /** The config file it was read from, from the root: `shiplane.config.ts` or `shiplane.yml`. */
  configFile?: string;
  /** The template of a test version's pull request comment; `comments.table` when unset. */
  testComment?: string;
  /** Which channel each branch's test release publishes on; unset, every branch a snapshot. */
  testRelease?: TestReleaseBranches;
  /** Run from the root before each unit ships from this machine, its placeholders filled. */
  prepare?: string;
}

type Composed = Pick<
  Release,
  | "flow"
  | "modules"
  | "features"
  | "display"
  | "tagFormat"
  | "testComment"
  | "testRelease"
  | "via"
  | "appFlow"
  | "channels"
  | "onBranch"
  | "deployOnBranch"
  | "prepare"
> & {
  units?: string[];
};

export interface LoadOptions {
  /** Where `shiplane` resolves from inside the config; by default, this very package. */
  aliases?: Record<string, string>;
  /** Where each unit's name and version come from: its package.json, as `cli/compose` wires it. */
  manifests: ManifestReader;
}

/** What `loadRelease` reads through: the config's readers and each unit's manifest reader. */
export interface LoadPorts {
  /** One reader per kind of config file, as `cli/compose` wires them; a repository holds one. */
  configs: readonly ConfigReader[];
  manifests: ManifestReader;
}

/** A port no flow fills yet: a release that never loaded has nothing to run on. */
const unset = <Port>(port: string): ServiceAdapter<Port> => ({
  name: "unset",
  create: () => {
    throw new Error(`no ${port} adapter: shiplane.config.ts sets none`);
  },
});

/** The flow of a release that did not load: every port unset. */
const unsetFlow = () =>
  releaseFlow({
    sourceControl: unset("sourceControl"),
    codeHost: unset("codeHost"),
    ciPipeline: unset("ciPipeline"),
    versioning: unset("versioning"),
  });

const FLOW_MISSING = [
  "flow is missing: give it one, such as",
  "flow: releaseFlow({ sourceControl: gitSourceControl(), codeHost: gitHubCodeHost(),",
  "ciPipeline: gitHubActionsCiPipeline(), versioning: changesetsVersioning() }),",
  "from the shiplane-git, shiplane-github and shiplane-changesets plugins",
].join(" ");

const typed = (value: unknown, type: string) =>
  isRecord(value) && value.type === type && typeof value.name === "string";

const isFlow = (value: unknown): value is ReleaseFlow => isRecord(value) && value.type === "flow";
const isModule = (value: unknown): value is ReleaseModule => typed(value, "module");
const isFeature = (value: unknown): value is Feature => typed(value, "feature");

const listOf = <Item>(
  value: unknown,
  key: string,
  is: (candidate: unknown) => candidate is Item,
  example: string,
): Item[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${key} is not a list, such as ${key}: [${example}]`);
  return value.map((item: unknown, index) => {
    if (!is(item)) throw new Error(`${key}[${index}] is not one of its ${key}, such as ${example}`);
    return item;
  });
};

const LEFTOVERS: Record<string, string> = {
  plugins:
    "plugins is gone: defineRelease takes flow, modules and features, such as modules: [backendService({ serverHosting: flyServerHosting() })]",
  latest: "latest is gone: the first app of the first module is the Latest release",
};

/** The modules, their names unique and their adapters' settings free of `module`. */
const checkModules = (modules: readonly ReleaseModule[], features: readonly Feature[]) => {
  const names = [...modules, ...features].map(({ name }) => name);
  names.forEach((name, index) => {
    if (names.indexOf(name) !== index) {
      throw new Error(
        `two modules are named "${name}": give one its own, such as { name: "${name}-2", ... }`,
      );
    }
  });
  const clash = modules.find(({ settings }) => "module" in settings.shape);
  if (clash) {
    throw new Error(
      `"module" is reserved for the unit file's module, yet ${clash.name}'s adapter takes it`,
    );
  }
};

const tagFormatOf = (tag: unknown) => {
  if (tag === undefined) return DEFAULT_TAG_FORMAT;
  const format = typeof tag === "string" ? tagFormatNamed(tag) : undefined;
  if (!format?.includes("{version}")) {
    const names = Object.keys(TAG_FORMATS)
      .map((name) => `"${name}"`)
      .join(", ");
    throw new Error(`tag is one of ${names}, or a format naming the version, such as "v{version}"`);
  }
  return format;
};

/** What the config file declared, checked: the first problem is thrown. */
const checkConfig = (loaded: unknown): Composed => {
  if (!isRecord(loaded)) throw new Error("its default export is not defineRelease({ modules })");
  for (const [key, message] of Object.entries(LEFTOVERS)) {
    if (key in loaded) throw new Error(message);
  }
  if (loaded.flow === undefined) throw new Error(FLOW_MISSING);
  if (!isFlow(loaded.flow)) {
    throw new Error("flow is not a release flow, such as flow: releaseFlow({ ... })");
  }
  const modules = listOf(loaded.modules, "modules", isModule, "webApp({ ... })");
  const features = listOf(loaded.features, "features", isFeature, "releaseComments({ ... })");
  checkModules(modules, features);
  const units = Array.isArray(loaded.units)
    ? loaded.units.filter((unit): unit is string => typeof unit === "string")
    : undefined;
  const display = isRecord(loaded.display) ? loaded.display : {};
  const deployApps = deployAppsOf(loaded.deployApps);
  const flag = (value: unknown) => (typeof value === "boolean" ? value : undefined);
  return {
    flow: loaded.flow,
    modules,
    features,
    units,
    display: { verbose: flag(display.verbose), mascot: mascotOf(display.mascot) },
    tagFormat: tagFormatOf(loaded.tag),
    ...testCommentOf(loaded.testComment),
    ...testReleaseOf(loaded.testRelease),
    via: viaOf(loaded.via),
    ...deployApps,
    ...publishPackagesOf(loaded.publishPackages, (deployApps.appFlow ?? DEFAULT_FLOW).path),
    ...prepareOf(loaded.prepare),
  };
};

const EnvironmentName = z.string().regex(/^[a-z][a-z0-9-]*$/);

const DeployAppsSchema = z.strictObject({
  promote: z
    .array(z.strictObject({ from: EnvironmentName.optional(), to: EnvironmentName.optional() }))
    .min(1)
    .optional(),
  onBranch: z.union([EnvironmentName, z.literal(false)]).optional(),
});

type Steps = NonNullable<z.infer<typeof DeployAppsSchema>["promote"]>;

/** The way the steps describe, or why they describe none. */
const flowOfSteps = (steps: Steps): DeployFlow | string => {
  const [first, ...rest] = steps;
  if (!first || (first.from === undefined && first.to === undefined)) {
    return "each step names from, to, or both";
  }
  if (rest.length > 0 && steps.some(({ from, to }) => from === undefined || to === undefined)) {
    return "with more than one step, each names both from and to";
  }
  const broken = rest.find(({ from }, index) => from !== steps[index]?.to);
  if (broken) return `the step from ${broken.from} must start where the one before it ends`;
  const path = [first.from, ...steps.map(({ to }) => to)].filter((name) => name !== undefined);
  if (new Set(path).size < path.length) return "an environment is named twice";
  const channel = path.find(
    (name) => name === LIVE || Object.values<string>(channels).includes(name),
  );
  if (channel) return `${channel} is a channel packages publish on`;
  return { path, users: steps.at(-1)?.to ?? null };
};

const PublishPackagesSchema = z.strictObject({
  channels: z.array(z.string()).min(1).optional(),
  onBranch: z.union([z.literal("snapshot"), z.literal(false)]).optional(),
});

/** `deployApps`: the way apps go to their users, and what a branch may do. */
const deployAppsOf = (value: unknown): Pick<Release, "appFlow" | "deployOnBranch"> => {
  if (value === undefined) return {};
  const parsed = DeployAppsSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      'deployApps takes promote, steps such as [{ from: "preview", to: "production" }], and onBranch, an environment or false',
    );
  }
  const { promote, onBranch } = parsed.data;
  const appFlow = promote && flowOfSteps(promote);
  if (typeof appFlow === "string") throw new Error(`deployApps.promote: ${appFlow}`);
  if (onBranch && !(appFlow ?? DEFAULT_FLOW).path.some((name) => name === onBranch)) {
    throw new Error(`deployApps.onBranch is ${onBranch}, and promote does not name it`);
  }
  if (onBranch && reachesUsers(appFlow ?? DEFAULT_FLOW, onBranch)) {
    throw new Error(
      `deployApps.onBranch is ${onBranch}, where users are: a branch never deploys there`,
    );
  }
  return {
    ...(appFlow ? { appFlow } : {}),
    ...(onBranch === undefined ? {} : { deployOnBranch: onBranch }),
  };
};

/** Why a name cannot be a channel of `publishPackages`, or null when it can. */
const channelRefused = (name: string, path: readonly Environment[]) => {
  if (path.includes(name)) return `${name} is an environment apps deploy to`;
  if (name === LIVE) return null;
  if (name === channels.snapshot) return "snapshot is what onBranch publishes, not a channel";
  return channelProblem(name);
};

/** `publishPackages`: the channels, and what a branch publishes. */
const publishPackagesOf = (
  value: unknown,
  path: readonly Environment[],
): Pick<Release, "channels" | "onBranch"> => {
  if (value === undefined) return {};
  const parsed = PublishPackagesSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      'publishPackages takes channels, a list of names, and onBranch, "snapshot" or false',
    );
  }
  const { channels: names, onBranch } = parsed.data;
  const problem = names?.map((name) => channelRefused(name, path)).find((found) => found !== null);
  if (problem) throw new Error(`publishPackages.channels: ${problem}`);
  return {
    ...(names ? { channels: [...new Set(names)] } : {}),
    ...(onBranch === undefined ? {} : { onBranch }),
  };
};

/** The config's `prepare`, its placeholders known; the first problem is thrown. */
const prepareOf = (value: unknown) => {
  if (value === undefined) return {};
  const parsed = PrepareSchema.safeParse(value);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message);
  return { prepare: parsed.data };
};

const testCommentOf = (value: unknown) => {
  if (value === undefined) return {};
  if (typeof value !== "string") {
    throw new Error('testComment is a template, such as comments.compact or "Try it: {install}"');
  }
  return { testComment: value };
};

/** The config's `testRelease`: a branch → channel map, every channel a name npm takes. */
const testReleaseOf = (value: unknown) => {
  if (value === undefined) return {};
  if (!isRecord(value)) {
    throw new Error(
      'testRelease maps a branch to a channel, such as testReleases.gitflow or { main: "nightly" }',
    );
  }
  const branches = Object.fromEntries(
    Object.entries(value).map(([branch, channel]) => {
      if (typeof channel !== "string")
        throw new Error(`testRelease "${branch}": not a channel name`);
      const problem = channelProblem(channel);
      if (problem) throw new Error(`testRelease "${branch}": ${problem}`);
      return [branch, channel];
    }),
  );
  return { testRelease: branches };
};

/** The config names a way by its port, never its provider: "ci" is whatever CI the flow uses. */
const viaOf = (via: unknown): DeployPath | undefined => {
  if (via === undefined) return undefined;
  if (via === "ci" || via === "local") return via;
  throw new Error('via is "ci" (the CI pipeline) or "local" (this machine)');
};

/** A config's mascot: true, false, frames per mood, or a function; anything else is ignored. */
const mascotOf = (value: unknown): DisplayChoice["mascot"] => {
  if (typeof value === "boolean" || typeof value === "function")
    return value as DisplayChoice["mascot"];
  if (!isRecord(value)) return undefined;
  const frames = Object.entries(value).filter(
    ([, list]) => Array.isArray(list) && list.every((frame) => typeof frame === "string"),
  );
  return frames.length > 0 ? Object.fromEntries(frames) : undefined;
};

interface Read {
  unit: ReleaseUnit;
  file: UnitFile;
}

/** Apps in release order: by module as the config lists them, then by name. */
const inReleaseOrder = (read: readonly Read[], modules: readonly ReleaseModule[]) => {
  const rank = (unit: ReleaseUnit) => modules.findIndex(({ name }) => name === unit.module);
  return [...read].sort(
    (left, right) =>
      rank(left.unit) - rank(right.unit) || left.unit.name.localeCompare(right.unit.name),
  );
};

const referenceProblems = ({ unit, file }: Read, ordered: readonly Read[]): ConfigProblem[] =>
  referencesIn(unit.options).flatMap(({ unit: name, key, at }) => {
    const other = ordered.find((candidate) => candidate.unit.name === name)?.unit;
    const line = file.lineOf(at);
    if (!other) {
      return [{ file: unit.file, line, message: `"${name}" has no ${UNIT_FILE} to read from` }];
    }
    if (valueAt(other.options, key.split(".")) === undefined) {
      return [{ file: unit.file, line, message: `"${name}" has no "${key}" in ${other.file}` }];
    }
    const position = (target: ReleaseUnit) =>
      ordered.findIndex((candidate) => candidate.unit === target);
    if (other !== unit && position(other) > position(unit)) {
      return [
        {
          file: unit.file,
          line,
          message: `"${unit.name}" reads ${name}.${key}, which is released after it`,
          hint:
            other.module === unit.module
              ? `${unit.name} and ${name} share ${unit.module}: give ${name} a module of its own, listed first`
              : `move ${other.module} before ${unit.module} in the modules of shiplane.config.ts`,
        },
      ];
    }
    return [];
  });

/**
 * The release as written: what `shiplane.config.ts` composes, and one app per folder that holds a
 * `shiplane.unit.yml`, in release order. Every problem is collected, never thrown.
 */
export const loadRelease = async (root: string, ports: LoadPorts): Promise<Release> => {
  const empty = (problems: ConfigProblem[]): Release => ({
    root,
    flow: unsetFlow(),
    tagFormat: DEFAULT_TAG_FORMAT,
    modules: [],
    features: [],
    units: [],
    problems,
  });
  const found = ports.configs.flatMap((reader) => {
    const file = reader.find(root);
    return file ? [{ reader, file }] : [];
  });
  if (found.length > 1) {
    const names = found.map(({ file }) => path.basename(file));
    return empty([
      {
        file: names[1] ?? "",
        message: `${names.join(" and ")} both hold the config: shiplane reads one`,
        hint: "keep one; shiplane migrate writes shiplane.yml from shiplane.config.ts",
      },
    ]);
  }
  const [chosen] = found;
  if (!chosen) {
    return empty([
      {
        file: "shiplane.config.ts",
        message: "No shiplane.config.ts in this repository",
        hint: "shiplane setup writes it, with a shiplane.unit.yml next to each app",
      },
    ]);
  }
  const configFile = chosen.file;
  let config: Composed;
  try {
    config = checkConfig(await chosen.reader.read(configFile));
  } catch (error) {
    const file = path.basename(configFile);
    if (error instanceof ConfigError) {
      return empty([
        {
          file,
          ...(error.line === undefined ? {} : { line: error.line }),
          message: error.message,
          ...(error.hint === undefined ? {} : { hint: error.hint }),
        },
      ]);
    }
    const reason = reasonOf(error);
    return empty([{ file, message: `it did not load: ${reason.split("\n")[0]}` }]);
  }
  const { manifests } = ports;
  const problems: ConfigProblem[] = [];
  const features = config.features.map(({ name }) => name);
  const read: Read[] = expandPatterns(root, config.units ?? workspacePatterns(root)).flatMap(
    (dir) => {
      const relative = UNIT_FILES.map((name) => path.posix.join(dir, name)).find((file) =>
        fs.existsSync(path.join(root, file)),
      );
      if (!relative) return [];
      const result = readUnitFile(
        relative,
        fs.readFileSync(path.join(root, relative), "utf8"),
        config.modules,
        features,
        keysOf(config.appFlow ?? DEFAULT_FLOW),
      );
      problems.push(...result.problems);
      const manifest = manifests.read(root, dir);
      if (!manifest) {
        problems.push({
          file: relative,
          message: fs.existsSync(path.join(root, dir, "package.json"))
            ? "the package.json next to it needs a name and a version"
            : "no package.json next to it to read its name and version",
        });
      }
      if (!result.unit || !manifest) return [];
      const unit: ReleaseUnit = {
        name: dir === "." ? manifest.name.replace(/^@[^/]+\//, "") : path.posix.basename(dir),
        dir,
        file: relative,
        packageName: manifest.name,
        version: manifest.version,
        module: result.unit.module,
        ...(result.unit.buildCommand ? { buildCommand: result.unit.buildCommand } : {}),
        ...(result.unit.checkEnvBeforeDeploy
          ? { checkEnvBeforeDeploy: result.unit.checkEnvBeforeDeploy }
          : {}),
        options: result.unit.options,
        after: [],
      };
      return [{ unit, file: result.unit }];
    },
  );

  const ordered = inReleaseOrder(read, config.modules);
  ordered.forEach((entry, index) => {
    const twin = ordered.findIndex(({ unit }) => unit.name === entry.unit.name);
    if (twin !== index) {
      problems.push({
        file: entry.unit.file,
        message: `two folders are both named "${entry.unit.name}"`,
        hint: `rename one of ${ordered[twin]?.unit.dir} and ${entry.unit.dir}`,
      });
    }
    problems.push(...referenceProblems(entry, ordered));
    entry.unit.after = [
      ...new Set(referencesIn(entry.unit.options).map(({ unit }) => unit)),
    ].filter((name) => name !== entry.unit.name && ordered.some(({ unit }) => unit.name === name));
  });

  // Such a platform builds what users get from what runs before it, under its own two names.
  const names = (config.appFlow ?? DEFAULT_FLOW).path;
  if (names.some((name, index) => name !== DEFAULT_FLOW.path[index])) {
    ordered
      .filter(({ unit }) =>
        config.modules.some(({ name, decidedBy }) => name === unit.module && decidedBy),
      )
      .forEach(({ unit }) =>
        problems.push({
          file: path.basename(configFile),
          message: `${unit.name} ships on a platform that knows ${DEFAULT_FLOW.path.join(" and ")} only`,
          hint: "name them in deployApps.promote, from the first to the second",
        }),
      );
  }

  if (ordered.length > 1 && !config.tagFormat.includes("{name}")) {
    problems.push({
      file: path.basename(configFile),
      message: `tag "${config.tagFormat}" names no unit, so ${ordered.length} units would share each tag`,
      hint: 'add {name} to the format, such as "{name}--v{version}", or release one unit',
    });
  }

  return {
    root,
    flow: config.flow,
    modules: config.modules,
    features: config.features,
    ...(config.via ? { via: config.via } : {}),
    ...(config.appFlow ? { appFlow: config.appFlow } : {}),
    ...(config.channels ? { channels: config.channels } : {}),
    ...(config.deployOnBranch === undefined ? {} : { deployOnBranch: config.deployOnBranch }),
    ...(config.onBranch === undefined ? {} : { onBranch: config.onBranch }),
    units: ordered.map(({ unit }) => unit),
    problems: sortProblems(problems),
    display: config.display,
    configFile: path.basename(configFile),
    renames: [path.basename(configFile), ...ordered.map(({ unit }) => unit.file)].flatMap(
      (file) => renameOf(file) ?? [],
    ),
    tagFormat: config.tagFormat,
    ...(config.testComment === undefined ? {} : { testComment: config.testComment }),
    ...(config.testRelease === undefined ? {} : { testRelease: config.testRelease }),
    ...(config.prepare === undefined ? {} : { prepare: config.prepare }),
  };
};
