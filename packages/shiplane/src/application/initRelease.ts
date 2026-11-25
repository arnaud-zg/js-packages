import path from "node:path";

import type { ReleaseModule } from "../modules/module";
import type { AnyDeliveryAdapter } from "../modules/suggest";
import type { Detection, FolderView } from "../ports/delivery.port";
import type { SetupContext } from "./setupContext";
import type { ModuleEntry } from "./setupFiles";
import { NO_APPS } from "../domain/environment";
import { moduleFor } from "../modules/suggest";
import { chooseEnvironments, needsEnvironments } from "./chooseEnvironments";
import { UNIT_FILE, UNIT_FILES } from "./config/readUnitFile";
import { isRecord } from "./config/values";
import { expandPatterns, workspacePatterns } from "./config/workspaceFolders";
import { doctor } from "./doctor";
import { paint } from "./say";
import {
  addToConfig,
  CONFIG_FILE,
  editorSettingsFile,
  folderView,
  githubRepository,
  placeModule,
  releasePackage,
  renderBlankUnit,
  renderConfig,
  renderUnit,
  repositoryName,
  SCHEMA_FILE,
  schemaLineFor,
  schemaText,
  withEditorSchema,
  withPromote,
} from "./setupFiles";

interface Candidate {
  folder: FolderView;
  /** The adapter that recognised it best: found, then likely, then possible. */
  guess: { adapter: AnyDeliveryAdapter; detection: Detection } | null;
}

interface Placed {
  folder: FolderView;
  adapter: AnyDeliveryAdapter;
  options: Record<string, unknown>;
  reason?: string;
  /** The environments its detection saw. */
  environments?: string[];
}

interface Write {
  file: string;
  text: string;
  created: boolean;
}

const bar = paint("dim", "│");

/** Sets `key`, dotted, in a nested object. */
const setAt = (target: Record<string, unknown>, key: string, value: unknown) => {
  const [head = "", ...rest] = key.split(".");
  if (rest.length === 0) {
    target[head] = value;
    return;
  }
  const child = isRecord(target[head]) ? target[head] : {};
  target[head] = child;
  setAt(child, rest.join("."), value);
};

/** Each workspace folder with a manifest and no unit file yet, with what adapters recognise in it. */
export const scanFolders = (
  context: SetupContext,
  adapters: readonly AnyDeliveryAdapter[],
): Candidate[] =>
  expandPatterns(context.root, workspacePatterns(context.root))
    .filter((dir) => dir !== "." && context.files.exists(path.posix.join(dir, "package.json")))
    .filter((dir) => !UNIT_FILES.some((name) => context.files.exists(path.posix.join(dir, name))))
    .map((dir) => {
      const folder = folderView(context.files, dir);
      const detections = adapters.flatMap((adapter) => {
        const detection = adapter.detect?.(folder);
        return detection ? [{ adapter, detection }] : [];
      });
      const strongest = (["found", "likely", "possible"] as const)
        .map((certainty) => detections.find(({ detection }) => detection.certainty === certainty))
        .find(Boolean);
      const guess = strongest ?? null;
      return { folder, guess };
    });

/** The options a placed folder needs that its folder did not say, asked or taken as suggested. */
export const askOptions = async (
  context: SetupContext,
  folder: FolderView,
  adapter: AnyDeliveryAdapter,
  found: Record<string, unknown>,
  yes: boolean,
) => {
  const options = structuredClone(found);
  const repository = repositoryName(context.files, context.root);
  const { stdout } = await context.shell.capture("git", ["remote", "get-url", "origin"], {
    cwd: context.root,
  });
  const remote = githubRepository(stdout) ?? undefined;
  for (const question of adapter.questions?.(folder, options, repository, remote) ?? []) {
    const answer = yes
      ? (question.initial ?? null)
      : await context.prompter.text(`${folder.dir} · ${question.message}`, question.initial);
    if (answer !== null && answer !== "") setAt(options, question.key, answer);
  }
  return options;
};

const candidateLine = ({ folder, guess }: Candidate, width: number) => {
  const target =
    guess?.detection.certainty === "found"
      ? paint("green", guess.adapter.name)
      : paint("yellow", "?");
  return `${folder.dir.padEnd(width)}${target.padEnd(18)}${paint("dim", guess?.detection.reason ?? "")}`;
};

/** Whether the person writes, after seeing the list, the diff if asked. */
const review = async (context: SetupContext, writes: Write[], yes: boolean) => {
  const { output, prompter } = context;
  output.line(`${paint("cyan", "◆")}  ${paint("bold", "Write these files?")}`);
  writes.forEach(({ file, created }) =>
    output.line(`${bar}  ${created ? paint("green", "+") : paint("yellow", "~")} ${file}`),
  );
  if (yes) return true;
  for (;;) {
    const answer = await prompter.select(
      "Write these files?",
      [
        { value: "write", label: "Write" },
        { value: "diff", label: "Show the files" },
        { value: "cancel", label: "Cancel, write nothing" },
      ],
      "write",
    );
    if (answer !== "diff") return answer === "write";
    writes.forEach(({ file, text }) => {
      output.line();
      output.line(paint("bold", file));
      text.split("\n").forEach((line) => output.line(`  ${line}`));
    });
  }
};

/** The config: written whole the first time, else each new module added to the one there. */
const configWrites = (
  { files }: SetupContext,
  {
    existing,
    entries,
    pkg,
    path: environments,
  }: {
    existing: boolean;
    entries: readonly ModuleEntry[];
    pkg: string;
    /** The environments to write, when the config names none and an app needs them. */
    path: readonly string[] | null;
  },
): Write[] => {
  if (!existing) {
    const text = renderConfig(entries, pkg, undefined, undefined, environments);
    return [{ file: CONFIG_FILE, text, created: true }];
  }
  const before = files.read(CONFIG_FILE) ?? "";
  const added = entries.reduce((text, entry) => addToConfig(text, entry, pkg) ?? text, before);
  const config = (environments && withPromote(added, environments)) ?? added;
  if (config === files.read(CONFIG_FILE)) return [];
  return [{ file: CONFIG_FILE, text: config, created: false }];
};

/** The editor's settings mapping unit files to the schema, unless an earlier init mapped them. */
const editorWrites = ({ files, output }: SetupContext): Write[] => {
  const current = files.read(editorSettingsFile);
  if (current?.includes(`./${SCHEMA_FILE}`)) return [];
  const settings = withEditorSchema(current);
  if (settings) {
    return [
      { file: editorSettingsFile, text: settings, created: !files.exists(editorSettingsFile) },
    ];
  }
  output.line(
    `${bar}  ${paint("dim", `${editorSettingsFile} already maps yaml.schemas: add ./${SCHEMA_FILE} for **/${UNIT_FILE}`)}`,
  );
  return [];
};

/**
 * `shiplane init`: finds every workspace folder, guesses how each ships from what it holds, asks only
 * what it cannot tell, shows every file, writes them, then runs doctor. Run again, it offers the
 * folders added since and never rewrites a unit file. `--yes` takes every guess, `--blank` writes
 * commented templates.
 */
export const initRelease = async (
  context: SetupContext,
  { yes, blank }: { yes: boolean; blank: boolean },
): Promise<boolean> => {
  const { output, prompter, files } = context;
  const existing = files.exists(CONFIG_FILE) ? await context.load() : null;
  const adapters = context.adapters;
  const candidates = scanFolders(context, adapters);
  output.line(`${paint("dim", "┌")}  ${paint("bold", "shiplane init")}`);
  output.line(bar);
  output.line(
    `${paint("green", "◇")}  Workspace  ${paint("dim", workspacePatterns(context.root).join(", "))}`,
  );
  output.line(bar);
  if (existing) {
    output.line(`${paint("cyan", "◆")}  ${paint("bold", "Since the last init")}`);
    candidates
      .filter(({ guess }) => guess)
      .forEach(({ folder, guess }) =>
        output.line(
          `${bar}  ${paint("green", "+")} ${folder.dir.padEnd(14)}${paint("dim", `new folder, ${guess?.detection.reason ?? ""}`)}`,
        ),
      );
    output.line(
      `${bar}  ${paint("dim", "=")} ${`${existing.units.length} folders`.padEnd(14)}${paint("dim", "unchanged, your edits kept")}`,
    );
    output.line(bar);
  }
  const placeable = candidates.filter(({ guess }) => guess !== null);
  const width = Math.max(14, ...placeable.map(({ folder }) => folder.dir.length)) + 2;
  placeable.forEach((candidate) => output.line(`${bar}  ${candidateLine(candidate, width)}`));
  const unplaced = candidates.length - placeable.length;
  if (unplaced > 0) {
    const folders = `${unplaced} folder${unplaced === 1 ? "" : "s"}`;
    output.line(
      `${bar}  ${paint("dim", `◻ ${folders} with nothing to ship them, versioned only (shiplane add <folder> ships one)`)}`,
    );
  }
  output.line(bar);
  const offered = placeable;
  const pickedDirs = yes
    ? offered.map(({ folder }) => folder.dir)
    : await prompter.multiselect(
        "Which folders ship somewhere?",
        offered.map(({ folder, guess }) => ({
          value: folder.dir,
          label: folder.dir,
          hint: guess ? `${guess.adapter.name} · ${guess.detection.reason}` : "",
        })),
        offered.map(({ folder }) => folder.dir),
      );
  if (pickedDirs === null) {
    output.line(paint("dim", "Nothing written."));
    return true;
  }
  const placed: Placed[] = [];
  for (const candidate of candidates.filter(({ folder }) => pickedDirs.includes(folder.dir))) {
    const { folder, guess } = candidate;
    const sure = guess?.detection.certainty === "found";
    const name =
      sure || yes
        ? (guess?.adapter.name ?? "skip")
        : await prompter.select(
            `How does ${folder.dir} ship?`,
            [
              ...adapters.map((adapter) => ({
                value: adapter.name,
                label: adapter.name,
                hint:
                  adapter.name === guess?.adapter.name
                    ? `${guess.detection.reason} (recommended)`
                    : "",
              })),
              { value: "skip", label: "skip", hint: "versioned, never shipped" },
            ],
            guess?.adapter.name,
          );
    const adapter = adapters.find((candidateAdapter) => candidateAdapter.name === name);
    if (!adapter) continue;
    const found = guess?.adapter === adapter ? guess.detection.options : {};
    const options = blank ? {} : await askOptions(context, folder, adapter, found, yes);
    placed.push({
      folder,
      adapter,
      options,
      reason: guess?.adapter === adapter ? guess.detection.reason : undefined,
      environments: guess?.adapter === adapter ? guess.detection.environments : undefined,
    });
  }
  const extras = [
    ...(files.exists(".vscode")
      ? [{ value: "editor", label: "editor autocompletion", hint: editorSettingsFile }]
      : []),
  ];
  const chosen = yes
    ? extras.map(({ value }) => value)
    : extras.length === 0
      ? []
      : await prompter.multiselect(
          "Also set up",
          extras,
          extras.map(({ value }) => value),
        );
  const editor = (chosen ?? []).includes("editor");
  const modules: ReleaseModule[] = [...(existing?.modules ?? [])];
  const entries: ModuleEntry[] = [];
  const pkg = releasePackage(files);
  const named = placed.map((entry) => {
    const { name, entry: added } = placeModule(entry.adapter, modules, pkg);
    if (added) {
      entries.push(added);
      modules.push(moduleFor(entry.adapter, name));
    }
    return { ...entry, module: name };
  });
  const needsPerson: string[] = [];
  const environments = needsEnvironments({ modules, entries, placed: named, existing })
    ? await chooseEnvironments(context, {
        found: placed.flatMap(({ environments: names = [] }) => names),
        yes,
        needsPerson,
      })
    : [];
  if (environments === null) {
    needsPerson.forEach((item) => output.line(`${paint("red", "✗")}  ${item}`));
    output.line(paint("dim", "Nothing written."));
    return false;
  }
  const writes: Write[] = configWrites(context, {
    existing: existing !== null,
    entries,
    pkg,
    path: environments.length > 0 ? environments : null,
  });
  named.forEach(({ folder, adapter, module, options, reason }) => {
    const schemaLine = editor ? undefined : schemaLineFor(folder.dir);
    writes.push({
      file: path.posix.join(folder.dir, UNIT_FILE),
      text: blank
        ? renderBlankUnit(module, adapter.settings, schemaLine)
        : renderUnit(module, options, { reason, schemaLine }),
      created: true,
    });
  });
  writes.push({
    file: SCHEMA_FILE,
    text: schemaText(
      modules,
      existing && environments.length === 0
        ? existing.appFlow.path
        : environments.length > 0
          ? environments
          : NO_APPS.path,
    ),
    created: !files.exists(SCHEMA_FILE),
  });
  if (editor) writes.push(...editorWrites(context));
  if (!(await review(context, writes, yes))) {
    output.line(paint("dim", "Nothing written."));
    return true;
  }
  writes.forEach(({ file, text }) => files.write(file, text));
  output.line(
    `${paint("green", "◇")}  Wrote ${writes.length} file${writes.length === 1 ? "" : "s"}`,
  );
  return doctor(context);
};
