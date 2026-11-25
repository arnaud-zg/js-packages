import path from "node:path";

import type { SetupContext } from "./setupContext";
import type { ModuleEntry } from "./setupFiles";
import { moduleFor } from "../modules/suggest";
import { chooseEnvironments, needsEnvironments } from "./chooseEnvironments";
import { UNIT_FILE } from "./config/readUnitFile";
import { askOptions, scanFolders } from "./initRelease";
import { paint } from "./say";
import {
  addToConfig,
  CONFIG_FILE,
  moduleCall,
  placeModule,
  releasePackage,
  renderUnit,
  SCHEMA_FILE,
  schemaText,
  withPromote,
} from "./setupFiles";

/** A new module joins the config's modules, or the person is told where to add it. */
const addModule = (
  { files, output }: SetupContext,
  { entry, pkg }: { entry: ModuleEntry; pkg: string },
) => {
  const config = addToConfig(files.read(CONFIG_FILE) ?? "", entry, pkg);
  if (config) {
    files.write(CONFIG_FILE, config);
    return;
  }
  output.line(`${paint("yellow", "!")}  add ${moduleCall(entry)} to the modules in ${CONFIG_FILE}`);
};

/** `shiplane add <folder>`: init's questions for one folder, its unit file written. */
export const addUnit = async (context: SetupContext, dir: string): Promise<boolean> => {
  const { output, prompter, files } = context;
  const folderDir = path.posix.normalize(dir).replace(/\/$/, "");
  const candidate = scanFolders(context, context.adapters).find(
    ({ folder }) => folder.dir === folderDir,
  );
  if (!candidate) {
    output.line(
      `${paint("red", "✗")}  ${folderDir} is not a workspace folder without a ${UNIT_FILE}`,
    );
    return false;
  }
  const { folder, guess } = candidate;
  const name =
    guess?.detection.certainty === "found"
      ? guess.adapter.name
      : await prompter.select(
          `How does ${folder.dir} ship?`,
          context.adapters.map((adapter) => ({
            value: adapter.name,
            label: adapter.name,
            hint:
              adapter.name === guess?.adapter.name ? `${guess.detection.reason} (recommended)` : "",
          })),
          guess?.adapter.name,
        );
  const adapter = context.adapters.find((offered) => offered.name === name);
  if (!adapter) return false;
  const found = guess?.adapter === adapter ? guess.detection.options : {};
  const options = await askOptions(context, folder, adapter, found, false);
  const file = path.posix.join(folder.dir, UNIT_FILE);
  if (!(await prompter.confirm(`Write ${file}?`))) {
    output.line(paint("dim", "Nothing written."));
    return true;
  }
  const release = await context.load();
  const pkg = releasePackage(files);
  const placed = placeModule(adapter, release.modules, pkg);
  const module = moduleFor(adapter, placed.name);
  const needed = needsEnvironments({
    modules: [...release.modules, module],
    entries: [],
    placed: [{ module: placed.name }],
    existing: release,
  });
  const environments = needed
    ? await chooseEnvironments(context, {
        found: guess?.detection.environments ?? [],
        yes: false,
        needsPerson: [],
      })
    : null;
  if (needed && !environments) {
    output.line(paint("dim", "Nothing written."));
    return false;
  }
  files.write(file, renderUnit(placed.name, options, { reason: guess?.detection.reason }));
  if (placed.entry) addModule(context, { entry: placed.entry, pkg });
  const named = environments && withPromote(files.read(CONFIG_FILE) ?? "", environments);
  if (named) files.write(CONFIG_FILE, named);
  const modules = placed.entry ? [...release.modules, module] : release.modules;
  files.write(SCHEMA_FILE, schemaText(modules, environments ?? release.appFlow.path));
  output.line(`${paint("green", "◇")}  Wrote ${file}`);
  return true;
};

/** `shiplane remove <unit>`: its unit file goes; changesets still version it. */
export const removeUnit = async (context: SetupContext, name: string): Promise<boolean> => {
  const { output, prompter, files } = context;
  const unit = (await context.load()).units.find((candidate) => candidate.name === name);
  if (!unit) {
    output.line(`${paint("red", "✗")}  no unit named "${name}"`);
    return false;
  }
  if (!(await prompter.confirm(`Stop shipping ${name}? It stays versioned.`))) return true;
  files.remove(unit.file);
  output.line(`${paint("green", "◇")}  Removed ${unit.file}`);
  return true;
};
