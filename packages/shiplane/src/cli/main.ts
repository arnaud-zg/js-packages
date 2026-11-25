import { parseArgs } from "node:util";
import { z } from "zod";

import type { ReleaseContext } from "../application/context";
import type { SetupContext } from "../application/setupContext";
import type { ContextIo } from "./compose";
import { tsConfig } from "../adapters/config/ts-config.adapter";
import { YAML_CONFIG_FILES } from "../adapters/config/yaml-config.adapter";
import { nodeFiles } from "../adapters/files/node-files.adapter";
import { addUnit, removeUnit } from "../application/addUnit";
import { branchRelease } from "../application/branchRelease";
import { writeConfigSchema } from "../application/configSchemaFile";
import { docsFor } from "../application/docsFor";
import { doctor } from "../application/doctor";
import { doctorCi } from "../application/doctorCi";
import { initRelease } from "../application/initRelease";
import { migrate } from "../application/migrate";
import { newAdapter } from "../application/newAdapter";
import { openReleasePr } from "../application/openReleasePr";
import { pickScope } from "../application/pickScope";
import { planShips } from "../application/planShips";
import { prepareRelease } from "../application/prepareRelease";
import { promote } from "../application/promote";
import { pruneSnapshots } from "../application/pruneSnapshots";
import { paint, reasonOf } from "../application/say";
import { setup } from "../application/setup";
import { CONFIG_FILE, refreshEditorSchema } from "../application/setupFiles";
import { shipTo } from "../application/ship";
import { shipPackages } from "../application/shipPackages";
import { missingTags, tagRelease } from "../application/tagRelease";
import { entry, flowOf } from "../application/targets";
import { RELEASE_CHANNEL } from "../domain/environment";
import { composeContext, composeSetup, loadReleaseFrom, loadReleaseOnDisk } from "./compose";
import { findRoot } from "./findRoot";
import { out, printProblems } from "./output";
import { schemaCatalog } from "./plugins";
import { pluginsCommand } from "./pluginsCommand";
import { statusCommand } from "./statusCommand";

/** What `shiplane help` shows: the commands a person runs day to day, and where the rest are. */
const SHORT_HELP = `${paint("bold", "shiplane")}: detect what changed, version it, trigger each app's deploy.

  shiplane                        the next release step: release PR, merge, tags, ship
  shiplane promote                the next environment, from what the one before runs
  shiplane test-release [channel] publish what the changesets release for testers: a snapshot, or beta, nightly…
  shiplane status                 where every unit stands, and what to run next
  shiplane setup                  set up releases, or add an app
  shiplane doctor                 check the config, tools and sign-ins, offer each fix
  shiplane docs <name>            every key a module's or an adapter's unit files take

  shiplane help all               every command and flag: version, tag, ship, remove and the rest
`;

const HELP = `${paint("bold", "shiplane")}: detect what changed, version it, trigger each app's deploy.

  shiplane                        the next release step: release PR, merge, tags, ship
                                  (on a branch: a test release, asked first)
  shiplane test-release [channel] [unit...]
                                  publish what the changesets release for testers, npm packages only:
                                  a snapshot (0.6.0-main.329aafb) or a numbered channel (0.6.0-beta.2)
  shiplane prune-snapshots        remove the npm tags of snapshots published 30 days ago or more:
                                  --older-than <days> (7 or more), --otp <code>, --dry-run, --yes
  shiplane promote                the next environment, from what the one before runs
  shiplane status [--json]        where every unit stands, and what to run next
  shiplane version                open the release PR for what is pending
  shiplane tag                    tag merged versions and publish their release notes
  shiplane ship [unit...]         trigger each tagged unit's deploy, then return
  shiplane plugins [--json]       the flow, the modules in release order and who uses each, the features

  shiplane setup [--yes]          set up, check, or add an app: asks only what it can't tell, rehearses, then writes
                                  --environments a,b names what apps go through, in order, unasked
                                  --format yaml writes shiplane.yml instead of shiplane.config.ts
                                  (shiplane init and shiplane add are now setup; both still run for now)
  shiplane remove <unit>          stop shipping a unit; it stays versioned
  shiplane doctor                 check the config, tools and sign-ins, offer each fix
  shiplane doctor --ci [unit...]  on a runner: units, --channel, tools (installed when missing), secrets
  shiplane adapter new <name>     scaffold a server hosting adapter, its contract test and its module
  shiplane docs <name>            every key a module's or an adapter's unit files take
  shiplane migrate                write shiplane.yml from shiplane.config.ts, the same release, and remove the TS
  shiplane schema                 the editor schema of shiplane.yml, with the plugins installed and your own adapters
  shiplane help [all]             the main commands; all: this, every command and flag

  --channel <environment>         one deployApps.promote names; the first by default
                                  ship also takes latest, the released packages, or a test release channel
  --via ci|local                  ship through the CI pipeline (such as GitHub Actions) or this machine, without asking
  --yes                           answer yes to every question (never where users are)
  --dry-run                       with shiplane, ship or promote: every command it would run, run nothing;
                                  with test-release: each package's version and npm tag, publish nothing
                                  (shiplane plan before)
  --verbose / --no-verbose        say each thing it reads and runs, with a progress bar (on by default)
  --mascot / --no-mascot          the mascot beside it, still in CI or under NO_MOTION=1 (on by default)
                                  Both defaults live in shiplane.config.ts: display: { verbose, mascot }
`;

/** The commands `--dry-run` shows instead of running. */
const DRY_RUNS = new Set(["next", "ship", "promote"]);

/** --via ci|local; the older --via github still means the CI pipeline, said once. */
const viaFlag = (value: string | undefined) => {
  if (value === undefined) return undefined;
  if (value === "github") {
    out(paint("dim", "--via github is now --via ci: the flow's CI pipeline"));
    return "ci" as const;
  }
  return z.enum(["ci", "local"]).parse(value);
};

const parse = (argv: string[]) =>
  parseArgs({
    args: argv,
    allowPositionals: true,
    allowNegative: true,
    options: {
      verbose: { type: "boolean" },
      mascot: { type: "boolean" },
      "dry-run": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      yes: { type: "boolean", short: "y", default: false },
      channel: { type: "string" },
      via: { type: "string" },
      blank: { type: "boolean", default: false },
      ci: { type: "boolean", default: false },
      "older-than": { type: "string" },
      otp: { type: "string" },
      format: { type: "string" },
      environments: { type: "string" },
    },
  });

/** The arguments read, or why they cannot be, in one line. */
const readArgs = (argv: string[]) => {
  try {
    return parse(argv);
  } catch (error) {
    return reasonOf(error).split(". ")[0] ?? "";
  }
};

/** The CLI as a person runs it, from its arguments and folder; resolves to its exit code. */
export const runCli = async (argv: string[], cwd: string, io: ContextIo = {}): Promise<number> => {
  if (argv.includes("--help") || argv.includes("-h")) {
    out(SHORT_HELP);
    return 0;
  }
  const parsed = readArgs(argv);
  if (typeof parsed === "string") {
    out(`${paint("red", "✗")}  ${parsed}`);
    out(SHORT_HELP);
    return 1;
  }
  const { values, positionals } = parsed;

  const [command = "next", ...units] = positionals;
  // What --channel names is the release's to say: read once it is loaded.
  let environment = "";
  const via = viaFlag(values.via);
  // shiplane test-release [channel] [--dry-run]
  const testRelease = {
    onDefault: "publish" as const,
    dryRun: values["dry-run"],
    units: units.slice(1),
    via,
    ...(units[0] === undefined ? {} : { channel: units[0] }),
  };

  const commands: Record<string, (context: ReleaseContext) => Promise<boolean | void>> = {
    next: (context) =>
      environment === entry(context)
        ? branchRelease(context, { onDefault: "release", via })
        : promote(context, via, environment),
    "test-release": (context) => branchRelease(context, testRelease),
    "prune-snapshots": (context) =>
      pruneSnapshots(context, {
        dryRun: values["dry-run"],
        ...(values["older-than"] === undefined
          ? {}
          : { olderThanDays: Number(values["older-than"]) }),
        ...(values.otp === undefined ? {} : { otp: values.otp }),
      }),
    // The command's first name, kept working, left out of the help.
    branch: (context) => branchRelease(context, testRelease),
    promote: (context) => promote(context, via, values.channel),
    status: (context) => statusCommand(context, { environment, json: values.json }),
    version: async (context) => {
      const picked = await pickScope(context, entry(context));
      if (!picked || picked.scope.size === 0) return true;
      return (await openReleasePr(context, await prepareRelease(context, picked.scope))) !== null;
    },
    tag: async (context) => tagRelease(context, await missingTags(context)),
    // Where it ships says what: an environment apps, live the released packages, a channel test ones.
    ship: (context) => {
      if (values.channel === RELEASE_CHANNEL) return shipPackages(context, units);
      if (flowOf(context).path.includes(environment)) {
        const scope = units.length > 0 ? { scope: new Set(units) } : {};
        return shipTo(context, environment, { via, ...scope });
      }
      return branchRelease(context, { ...testRelease, channel: environment, units });
    },
    // Deprecated: --dry-run does it. Kept working, left out of the help.
    plan: (context) => {
      out(
        paint("dim", "plan is now --dry-run: shiplane ship --dry-run, shiplane promote --dry-run"),
      );
      return planShips(context, environment);
    },
    plugins: (context) => Promise.resolve(pluginsCommand(context.release, { json: values.json })),
  };

  const [first = ""] = units;
  // A shiplane.yml setup or migrate wrote gets its editor schema too: autocomplete works at once.
  const withSchema = async (context: SetupContext, done: boolean) =>
    done && YAML_CONFIG_FILES.some((file) => context.files.exists(file))
      ? writeConfigSchema(context, await schemaCatalog(context.root, io.aliases))
      : done;
  const setupCommands: Record<
    string,
    (context: Awaited<ReturnType<typeof composeSetup>>) => Promise<boolean>
  > = {
    setup: (context) => {
      if (values.format !== undefined && values.format !== "ts" && values.format !== "yaml") {
        out(
          `${paint("red", "✗")}  --format is ts (shiplane.config.ts, the default) or yaml (shiplane.yml)`,
        );
        return Promise.resolve(false);
      }
      const format = values.format === "yaml" ? "yaml" : "ts";
      return setup(context, { yes: values.yes, format }).then((done) => withSchema(context, done));
    },
    init: (context) => {
      if (values.blank) return initRelease(context, { yes: values.yes, blank: true });
      out(paint("dim", "init is now shiplane setup"));
      return setup(context, { yes: values.yes });
    },
    add: (context) => {
      out(paint("dim", "add is now shiplane setup: run it again to add an app"));
      return addUnit(context, first);
    },
    remove: (context) => removeUnit(context, first),
    doctor: (context) =>
      values.ci
        ? doctorCi(context, { units, channel: values.channel ?? "" })
        : doctor(context, { yes: values.yes }),
    adapter: (context) => {
      if (first === "new" && units[1]) return newAdapter(context, units[1]);
      out(`${paint("red", "✗")}  shiplane adapter new <name>`);
      return Promise.resolve(false);
    },
    docs: (context) => docsFor(context, first),
    migrate: async (context) => {
      const ts = tsConfig({ aliases: io.aliases });
      const tsFile = ts.find(context.root);
      const done = await migrate(context, {
        tsFile,
        declared: () => (tsFile ? ts.read(tsFile) : Promise.resolve(undefined)),
        catalog: await schemaCatalog(context.root, io.aliases),
        load: (from) => loadReleaseFrom(context.root, from, { aliases: io.aliases }),
      });
      return withSchema(context, done);
    },
    schema: async (context) =>
      writeConfigSchema(context, await schemaCatalog(context.root, io.aliases)),
  };

  const root = findRoot(cwd);
  const files = io.setup?.files ?? nodeFiles(root);
  const firstRun =
    command === "next" && ![CONFIG_FILE, ...YAML_CONFIG_FILES].some((file) => files.exists(file));
  // A dry run prints every command a ship would run, the way it would go, and runs none.
  const run =
    values["dry-run"] && DRY_RUNS.has(command)
      ? (context: ReleaseContext) => {
          const { path } = flowOf(context);
          if (command === "promote")
            return planShips(context, values.channel ?? path[1] ?? environment);
          if (environment === RELEASE_CHANNEL) return planShips(context, entry(context));
          return path.includes(environment)
            ? planShips(context, environment)
            : branchRelease(context, { ...testRelease, channel: environment, units });
        }
      : commands[command];
  const setUp = setupCommands[firstRun ? "setup" : command];
  if (setUp) {
    const load = () => loadReleaseOnDisk(root, { aliases: io.aliases });
    const named = values.environments
      ? { environments: values.environments.split(",").map((name) => name.trim()) }
      : {};
    return (await setUp(await composeSetup(root, { load, ...named, ...io.setup }))) ? 0 : 1;
  }
  if (command === "help") {
    out(first === "all" ? HELP : SHORT_HELP);
    return 0;
  }
  if (!run) {
    out(`${paint("red", "✗")}  no command "${command}"`);
    out(HELP);
    return 1;
  }
  const release = await loadReleaseOnDisk(root, { aliases: io.aliases });
  if (release.problems.length > 0) {
    printProblems(release.problems);
    return 2;
  }
  const { path } = flowOf({ release });
  environment = values.channel ?? entry({ release });
  // Only a ship goes anywhere but an environment: to latest, or to a test release's channel.
  const unknown = command !== "ship" && !path.includes(environment);
  const nowhere = command === "promote" && (path.length < 2 || values.channel === path[0]);
  if (unknown || nowhere) {
    out(
      `${paint("red", "✗")}  ${nowhere ? "nothing to promote to" : `unknown environment "${environment}"`}: ${path.join(", ")}`,
    );
    return 1;
  }
  (release.renames ?? []).forEach(({ from, to }) =>
    out(`${paint("yellow", "!")}  rename ${from} to ${to}: the old name still works for now`),
  );
  refreshEditorSchema(nodeFiles(release.root), release);
  const context = composeContext(
    release,
    { yes: values.yes, display: { verbose: values.verbose, mascot: values.mascot } },
    io,
  );
  return (await run(context)) === false ? 1 : 0;
};
