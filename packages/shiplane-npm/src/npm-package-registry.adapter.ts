import type {
  DecideContext,
  Decision,
  DeliveryAdapter,
  Job,
  JobInput,
  PackageRegistryPort,
  RegistryFacts,
  RegistryShip,
  Resolved,
  TaggedVersion,
} from "shiplane/plugin";
import {
  definePackageRegistry,
  onlyVersionFiles,
  parseJson,
  perEnv,
  registryDecision,
  z,
} from "shiplane/plugin";

const NpmOptions = z.object({
  publishAs: z
    .string()
    .optional()
    .describe("The name it publishes under, when its workspace name is not a valid npm name"),
  access: z.enum(["public", "restricted"]).default("public").describe("Who can install it"),
  tag: perEnv(z.string())
    .default({ preview: "latest", production: "latest" })
    .describe(
      "The dist-tag each environment moves: { preview: next, production: latest } to stage",
    ),
});

export interface NpmPackageRegistryOptions {
  /** Upload each release for a person to approve with 2FA on npm, instead of publishing it at once. */
  staged?: boolean;
}

/** The npm that stages: the one a Node release ships with may be too old. */
const STAGING_NPM = ["--yes", "npm@^11.15.0", "stage"];
const TARBALL = ".shiplane-stage.tgz";
const PUBLISH_SCRIPT = "prepublishOnly";

type Options = Resolved<z.output<typeof NpmOptions>>;

const ManifestSchema = z.object({
  private: z.boolean().optional(),
  bin: z.unknown().optional(),
  exports: z.unknown().optional(),
  main: z.unknown().optional(),
});

const nameOf = ({ unit, options }: JobInput<Options>) => options.publishAs ?? unit.packageName;

const published = async (context: DecideContext, name: string, version: string) => {
  const result = await context.shell.capture("npm", ["view", `${name}@${version}`, "version"]);
  return result.status === 0 && result.stdout.trim() === version;
};

const DistTags = z.record(z.string(), z.string());

/** The package's dist-tags, or none when npm failed or a notice took the JSON's place. */
const distTags = async (context: DecideContext, name: string) => {
  const result = await context.shell.capture("npm", ["view", name, "dist-tags", "--json"]);
  if (result.status !== 0) return {};
  const parsed = parseJson({ text: result.stdout || "{}", schema: DistTags });
  return parsed.success ? parsed.data : {};
};

const TagsAndTimes = z.object({
  "dist-tags": DistTags.default({}),
  time: z.record(z.string(), z.string()).default({}),
});

/** Every dist-tag with when its version was published; none when npm failed or never had it. */
const tags = async (context: DecideContext, input: JobInput<Options>): Promise<TaggedVersion[]> => {
  const result = await context.shell.capture("npm", [
    "view",
    nameOf(input),
    "dist-tags",
    "time",
    "--json",
  ]);
  if (result.status !== 0) return [];
  const parsed = parseJson({ text: result.stdout || "{}", schema: TagsAndTimes });
  if (!parsed.success) return [];
  const { "dist-tags": byTag, time } = parsed.data;
  return Object.entries(byTag).map(([tag, version]) => ({
    tag,
    version,
    publishedAt: time[version] ?? null,
  }));
};

/** Removes one dist-tag; the version stays installable by its number. */
const untagJob = (input: JobInput<Options>, tag: string, otp?: string): Job => ({
  label: `remove the ${tag} tag from ${nameOf(input)}`,
  local: [
    {
      command: "npm",
      args: ["dist-tag", "rm", nameOf(input), tag, ...(otp ? [`--otp=${otp}`] : [])],
    },
  ],
});

/** When npm took each version, plus `created` and `modified`: unpublished versions stay listed. */
const Times = z.record(z.string(), z.string());
const NOT_VERSIONS = new Set(["created", "modified"]);

/**
 * Every version npm ever took of the package, unpublished ones included: npm never takes a number
 * twice. None when it is not published yet or npm failed.
 */
const publishedVersions = async (context: DecideContext, input: JobInput<Options>) => {
  const result = await context.shell.capture("npm", ["view", nameOf(input), "time", "--json"]);
  if (result.status !== 0) return [];
  const parsed = parseJson({ text: result.stdout || "{}", schema: Times });
  return parsed.success ? Object.keys(parsed.data).filter((key) => !NOT_VERSIONS.has(key)) : [];
};

const StagedVersions = z.array(z.object({ version: z.string() }));

/**
 * Whether the version waits for approval. False when npm cannot say, as on a runner signed in by
 * OIDC: npm then refuses a second upload of the version itself.
 */
const waitsForApproval = async (context: DecideContext, input: JobInput<Options>) => {
  const result = await context.shell.capture("npx", [
    ...STAGING_NPM,
    "list",
    nameOf(input),
    "--json",
  ]);
  if (result.status !== 0) return false;
  const parsed = parseJson({ text: result.stdout, schema: StagedVersions });
  return parsed.success && parsed.data.some(({ version }) => version === input.unit.version);
};

/** Packed by pnpm, which resolves `workspace:` and `catalog:`, then staged by npm. */
const stageCommands = ({ unit, options }: JobInput<Options>) => [
  // pnpm publish runs this script; pnpm pack and a tarball's publish do not.
  { command: "pnpm", args: ["run", "--if-present", PUBLISH_SCRIPT], cwd: unit.dir },
  { command: "pnpm", args: ["pack", "--out", TARBALL], cwd: unit.dir },
  {
    command: "npx",
    args: [
      ...STAGING_NPM,
      "publish",
      `./${TARBALL}`,
      "--access",
      options.access,
      "--tag",
      options.tag,
    ],
    cwd: unit.dir,
  },
];

/** Upload the version, public once a person approves it; renamed for the registry and back after. */
const stageJob = (input: JobInput<Options>): Job => {
  const { unit, options } = input;
  const name = nameOf(input);
  const rename = (to: string) => ({
    command: "npm",
    args: ["pkg", "set", `name=${to}`],
    cwd: unit.dir,
  });
  return {
    label: `stage ${name}@${unit.version} under ${options.tag}, public once approved on npmjs.com`,
    local: [...(options.publishAs ? [rename(options.publishAs)] : []), ...stageCommands(input)],
    needsBuild: true,
    cleanup: [
      { command: "rm", args: ["-f", TARBALL], cwd: unit.dir },
      ...(options.publishAs ? [rename(unit.packageName)] : []),
    ],
  };
};

/**
 * Publish the version under the environment's tag, or a branch release's own, renamed for the
 * registry and back after.
 */
const publishJob = (input: JobInput<Options>): Job => {
  const { unit, options } = input;
  const name = nameOf(input);
  const distTag = input.distTag ?? options.tag;
  const rename = (to: string) => ({
    command: "npm",
    args: ["pkg", "set", `name=${to}`],
    cwd: unit.dir,
  });
  // npm needs a tag to publish under, so an untagged version goes out under one and loses it after.
  const untag = { command: "npm", args: ["dist-tag", "rm", name, distTag] };
  return {
    label: input.dropTag
      ? `publish ${name}@${unit.version}, no tag kept`
      : `publish ${name}@${unit.version} under ${distTag}`,
    local: [
      ...(options.publishAs ? [rename(options.publishAs)] : []),
      {
        command: "pnpm",
        args: ["publish", "--no-git-checks", "--access", options.access, "--tag", distTag],
        cwd: unit.dir,
      },
      ...(input.dropTag ? [untag] : []),
    ],
    needsBuild: true,
    ...(options.publishAs ? { cleanup: [rename(unit.packageName)] } : {}),
  };
};

const moveTagJob = (input: JobInput<Options>): Job => ({
  label: `move ${input.options.tag} to ${nameOf(input)}@${input.unit.version}`,
  local: [
    {
      command: "npm",
      args: ["dist-tag", "add", `${nameOf(input)}@${input.unit.version}`, input.options.tag],
    },
  ],
});

/** Each fact the decision may read, each read at most once and only when it is asked for. */
const registryFacts = (context: DecideContext, input: JobInput<Options>): RegistryFacts => {
  const { unit, tag, options } = input;
  const name = nameOf(input);
  const tagged = context.sourceControl.tagCommit(tag);
  return {
    tagged: async () => (await tagged) !== null,
    published: () => published(context, name, unit.version),
    // npm publishes this checkout: it has to be the code the tag named.
    sinceTagOnlyVersionFiles: async () =>
      onlyVersionFiles(
        await context.sourceControl.diffNames((await tagged) ?? tag, input.commit),
        context.versionFiles,
      ),
    onDistTag: async () => (await distTags(context, name))[options.tag] === unit.version,
  };
};

const decide = async (
  context: DecideContext,
  input: JobInput<Options>,
  staged: boolean,
): Promise<Decision> => {
  const { tag, environment, options } = input;
  const ship = await registryDecision({ environment, facts: registryFacts(context, input) });
  if (staged && ship === "publish" && (await waitsForApproval(context, input))) {
    return { action: "none", status: "staged on npm: approve it on npmjs.com" };
  }
  const releaseJob = staged ? stageJob : publishJob;
  const decisions: Record<RegistryShip, () => Decision> = {
    "not-released": () => ({ action: "none", status: "not released yet" }),
    "not-on-preview": () => ({
      action: "none",
      status: "not on npm yet: ship it to preview first",
    }),
    "moved-past": () => ({
      action: "fail",
      title: `main moved past ${tag}`,
      detail: "npm publishes this checkout, which now holds code no release named.",
      commands: [`git switch --detach ${tag}`, "shiplane ship"],
    }),
    publish: () => ({ action: "ship", kind: "publish", jobs: [releaseJob(input)] }),
    "on-tag": () => ({ action: "none", status: `on npm under ${options.tag}` }),
    "move-tag": () => ({ action: "ship", kind: "publish", jobs: [moveTagJob(input)] }),
  };
  return decisions[ship]();
};

const live = async (context: DecideContext, input: JobInput<Options>) => {
  const name = nameOf(input);
  if (!(await published(context, name, input.unit.version))) return false;
  return (await distTags(context, name))[input.options.tag] === input.unit.version;
};

/**
 * A package on npm. A release publishes the version straight under `latest`; with
 * `tag: { preview: next, production: latest }`, preview publishes under `next` and production moves
 * `latest` to it, never publishing twice. With `staged`, a release waits on npm for a person's
 * approval; a test release still publishes at once.
 */
export type NpmPackageRegistryAdapter = DeliveryAdapter<PackageRegistryPort>;

export const npmPackageRegistry = (
  options: NpmPackageRegistryOptions = {},
): NpmPackageRegistryAdapter => {
  const { staged = false } = options;
  const releaseJob = staged ? stageJob : publishJob;
  const adapter = definePackageRegistry({
    name: "npm",
    settings: NpmOptions,
    describe: (input) => `${nameOf(input)} on npm (${input.options.tag})`,
    // A branch release publishes once under its own tag: there is no tag to move.
    publishedName: nameOf,
    // A numbered test release, such as 0.6.0-beta.<n>, takes the next number npm does not hold.
    publishedVersions,
    // shiplane prune-snapshots reads every tag and removes the old snapshots' ones.
    tags,
    untagJob,
    jobs: (input) => (input.distTag ? [publishJob(input)] : [releaseJob(input), moveTagJob(input)]),
    decide: (context, input) => decide(context, input, staged),
    live,
    detect: (folder) => {
      const manifest = ManifestSchema.safeParse(JSON.parse(folder.read("package.json") ?? "{}"));
      if (!manifest.success || manifest.data.private) return null;
      const entry = (["bin", "exports", "main"] as const).find(
        (key) => manifest.data[key] !== undefined,
      );
      return entry
        ? { certainty: "found", reason: `package.json, public, ${entry}`, options: {} }
        : null;
    },
    requirements: () => [
      {
        label: "npm",
        check: { command: "npm", args: ["whoami"] },
        fix: { command: "npm", args: ["login"] },
        // A runner stages with a short-lived OIDC token, no secret.
        ...(staged ? { permissions: { "id-token": "write" as const } } : {}),
      },
    ],
  });
  return { ...adapter, options };
};
