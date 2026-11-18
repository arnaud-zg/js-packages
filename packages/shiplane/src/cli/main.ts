import { parseArgs } from "node:util";
import { z } from "zod";

import type { ReleaseContext } from "../application/context";
import type { ContextIo } from "./compose";
import { nodeFiles } from "../adapters/files/node-files.adapter";
import { addUnit, removeUnit } from "../application/addUnit";
import { branchRelease } from "../application/branchRelease";
import { docsFor } from "../application/docsFor";
import { doctor } from "../application/doctor";
import { doctorCi } from "../application/doctorCi";
import { initRelease } from "../application/initRelease";
import { newAdapter } from "../application/newAdapter";
import { openReleasePr } from "../application/openReleasePr";
import { pickScope } from "../application/pickScope";
import { planShips } from "../application/planShips";
import { prepareRelease } from "../application/prepareRelease";
import { promote } from "../application/promote";
import { paint } from "../application/say";
import { setup } from "../application/setup";
import { CONFIG_FILE, refreshEditorSchema } from "../application/setupFiles";
import { shipTo } from "../application/ship";
import { missingTags, tagRelease } from "../application/tagRelease";
import { ENVIRONMENTS } from "../domain/environment";
import { composeContext, composeSetup, loadReleaseOnDisk } from "./compose";
import { findRoot } from "./findRoot";
import { out, printProblems } from "./output";
import { pluginsCommand } from "./pluginsCommand";
import { statusCommand } from "./statusCommand";

/** What `shiplane help` shows: the commands a person runs day to day, and where the rest are. */
const SHORT_HELP = `${paint("bold", "shiplane")}: detect what changed, version it, trigger each app's deploy.

  shiplane                        the next step to preview: release PR, merge, tags, ship
  shiplane promote                production, from what preview runs
  shiplane test-release [channel] publish what the changesets release for testers: a snapshot, or beta, nightly…
  shiplane status                 where every unit stands, and what to run next
  shiplane setup                  set up releases, or add an app
  shiplane doctor                 check the config, tools and sign-ins, offer each fix
  shiplane docs <name>            every key a module's or an adapter's unit files take

  shiplane help all               every command and flag: version, tag, ship, remove and the rest
`;

const HELP = `${paint("bold", "shiplane")}: detect what changed, version it, trigger each app's deploy.

  shiplane                        the next step to preview: release PR, merge, tags, ship
                                  (on a branch: a test release, asked first)
  shiplane test-release [channel] publish what the changesets release for testers, npm packages only:
                                  a snapshot (0.6.0-main.329aafb) or a numbered channel (0.6.0-beta.2)
  shiplane promote                production, from what preview runs (--channel production too)
  shiplane status [--json]        where every unit stands, and what to run next
  shiplane version                open the release PR for what is pending
  shiplane tag                    tag merged versions and publish their release notes
  shiplane ship [unit...]         trigger each tagged unit's deploy, then return
  shiplane plugins [--json]       the flow, the modules in release order and who uses each, the features

  shiplane setup [--yes]          set up, check, or add an app: asks only what it can't tell, rehearses, then writes
                                  (shiplane init and shiplane add are now setup; both still run for now)
  shiplane remove <unit>          stop shipping a unit; it stays versioned
  shiplane doctor                 check the config, tools and sign-ins, offer each fix
  shiplane doctor --ci [unit...]  on a runner: units, --channel, tools (installed when missing), secrets
  shiplane adapter new <name>     scaffold a server hosting adapter, its contract test and its module
  shiplane docs <name>            every key a module's or an adapter's unit files take
  shiplane help [all]             the main commands; all: this, every command and flag

  --channel preview|production    where status reads (preview by default)
  --via ci|local                  ship through the CI pipeline (such as GitHub Actions) or this machine, without asking
  --yes                           answer yes to every question (never on production)
  --dry-run                       with shiplane, ship or promote: every command it would run, run nothing;
                                  with test-release: each package's version and npm tag, publish nothing
                                  (shiplane plan before)
  --verbose / --no-verbose        say each thing it reads and runs, with a progress bar (on by default)
  --mascot / --no-mascot          the mascot beside it, still in CI or under NO_MOTION=1 (on by default)
                                  Both defaults live in shiplane.config.ts: display: { verbose, mascot }
`;

/** The commands `--dry-run` previews instead of running. */
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

/** The CLI as a person runs it, from its arguments and folder; resolves to its exit code. */
export const runCli = async (argv: string[], cwd: string, io: ContextIo = {}): Promise<number> => {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    allowNegative: true,
    options: {
      verbose: { type: "boolean" },
      mascot: { type: "boolean" },
      "dry-run": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      yes: { type: "boolean", short: "y", default: false },
      channel: { type: "string", default: "preview" },
      via: { type: "string" },
      blank: { type: "boolean", default: false },
      ci: { type: "boolean", default: false },
    },
  });

  const [command = "next", ...units] = positionals;
  // doctor --ci says an unknown channel itself, with the environments it knows.
  const environment = command === "doctor" ? "preview" : z.enum(ENVIRONMENTS).parse(values.channel);
  const via = viaFlag(values.via);
  // shiplane test-release [channel] [--dry-run]
  const testRelease = {
    onDefault: "publish" as const,
    dryRun: values["dry-run"],
    ...(units[0] === undefined ? {} : { channel: units[0] }),
  };

  const commands: Record<string, (context: ReleaseContext) => Promise<boolean | void>> = {
    next: (context) =>
      environment === "preview"
        ? branchRelease(context, { onDefault: "release" })
        : promote(context, via),
    "test-release": (context) => branchRelease(context, testRelease),
    // The command's first name, kept working, left out of the help.
    branch: (context) => branchRelease(context, testRelease),
    promote: (context) => promote(context, via),
    status: (context) => statusCommand(context, { environment, json: values.json }),
    version: async (context) => {
      const picked = await pickScope(context, "preview");
      if (!picked || picked.scope.size === 0) return true;
      return (await openReleasePr(context, await prepareRelease(context, picked.scope))) !== null;
    },
    tag: async (context) => tagRelease(context, await missingTags(context)),
    ship: (context) =>
      shipTo(context, environment, { via, ...(units.length > 0 ? { scope: new Set(units) } : {}) }),
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
  const setupCommands: Record<
    string,
    (context: Awaited<ReturnType<typeof composeSetup>>) => Promise<boolean>
  > = {
    setup: (context) => setup(context, { yes: values.yes }),
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
        ? doctorCi(context, { units, channel: values.channel })
        : doctor(context, { yes: values.yes }),
    adapter: (context) => {
      if (first === "new" && units[1]) return newAdapter(context, units[1]);
      out(`${paint("red", "✗")}  shiplane adapter new <name>`);
      return Promise.resolve(false);
    },
    docs: (context) => docsFor(context, first),
  };

  const root = findRoot(cwd);
  const files = io.setup?.files ?? nodeFiles(root);
  const firstRun = command === "next" && !files.exists(CONFIG_FILE);
  // A dry run prints every command a ship would run, the way it would go, and runs none.
  const run =
    values["dry-run"] && DRY_RUNS.has(command)
      ? (context: ReleaseContext) =>
          planShips(context, command === "promote" ? "production" : environment)
      : commands[command];
  const setUp = setupCommands[firstRun ? "setup" : command];
  if (setUp) {
    const load = () => loadReleaseOnDisk(root, { aliases: io.aliases });
    return (await setUp(await composeSetup(root, { load, ...io.setup }))) ? 0 : 1;
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
