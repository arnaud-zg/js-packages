import path from "node:path";

import type { CallerNeeds, CallerWorkflow } from "../ports/ci-pipeline.port";
import type { Release } from "./config/loadRelease";
import type { SetupContext } from "./setupContext";
import { channels } from "../domain/testChannel";
import { requirementsOf } from "./requirements";
import { paint, reasonOf } from "./say";
import { skipsPreview } from "./targets";

/** What a workflow calling shiplane's own holds in its `uses:` line. */
const CALLS = "/.github/workflows/shiplane-ship.yml@";
/** The same workflow from the same commit: shiplane's own repository, with no version to pin. */
const CALLS_LOCAL = /^[ \t]*uses:[ \t]*\.\/\.github\/workflows\/shiplane-ship\.yml[ \t]*$/m;
const USES = /^([ \t]*)uses:[ \t]*\S*\/\.github\/workflows\/shiplane-ship\.yml(?:@.*)?$/m;
const PINNED = /shiplane-ship\.yml@\S+[ \t]+#[ \t]*shiplane@(\S+)/;

/** What a runner may do to publish: tag and note a release, comment on a pull request. */
const PUBLISHING = { contents: "write", issues: "write", "pull-requests": "write" } as const;

/**
 * What the release needs its caller workflow to pass: each secret its adapters read on a runner,
 * sorted, but `GH_TOKEN`, which shiplane's workflow sets itself; and its features' names.
 */
export const callerNeedsOf = (release: Release): CallerNeeds => {
  const requirements = requirementsOf(release);
  const permissions: Record<string, "read" | "write"> = {};
  for (const [name, level] of requirements.flatMap((r) => Object.entries(r.permissions ?? {}))) {
    if (permissions[name] !== "write") permissions[name] = level;
  }
  const variables = [...new Set(requirements.flatMap((r) => r.variables ?? []))].sort();
  return {
    secrets: [...new Set(requirements.flatMap(({ secrets = [] }) => secrets))]
      .filter((name) => name !== "GH_TOKEN")
      .sort(),
    features: release.features.map(({ name }) => name),
    ...(Object.keys(permissions).length > 0 ? { permissions } : {}),
    ...(variables.length > 0 ? { variables } : {}),
  };
};

/** The workflow a repository ships from, as its CI pipeline writes it; null when it writes none. */
const callerOf = ({ version, root, shell, files }: SetupContext, release: Release) => {
  const ci = release.flow.ciPipeline.create({ root, shell });
  const file = ci.workflowFile?.(ci.shipWorkflow);
  const make = ci.callerWorkflow;
  if (!version || !file || !make) return null;
  // A release that ships from this machine runs no workflow; one already there is still checked.
  if (release.via === "local" && !files.exists(file)) return null;
  const base = callerNeedsOf(release);
  const straight = skipsPreview({
    release,
    open: (adapter) => adapter.create({ root, shell }),
  });
  // The file's own list says where it ships: a test channel there publishes from a runner.
  const text = files.read(file);
  const offered = [...Object.values(channels), ...Object.values(release.testRelease ?? {})];
  const publishes =
    straight || (text !== null && offered.some((channel) => ci.offers?.(text, channel)));
  const needs: CallerNeeds = {
    ...base,
    ...(straight ? { environments: ["production"] } : {}),
    ...(publishes ? { permissions: { ...base.permissions, ...PUBLISHING } } : {}),
  };
  return {
    file,
    name: path.posix.basename(file),
    version,
    needs,
    make: (passing = needs) => make(version, passing),
  };
};

/** The made workflow, or null once why it could not be made is said. */
const madeOrSaid = async (
  { output }: SetupContext,
  make: () => Promise<CallerWorkflow | { error: string }>,
  bar: string,
) => {
  const made = await make().catch((error: unknown) => ({ error: reasonOf(error) }));
  if (!("error" in made)) return made;
  output.line(`${bar}${paint("yellow", "!")} ${paint("dim", made.error)}`);
  return null;
};

/** What setup writes for the caller workflow: nothing when one is there, or none can be made. */
export const callerWrite = async (context: SetupContext, release: Release) => {
  const caller = callerOf(context, release);
  if (!caller || context.files.exists(caller.file)) return null;
  const made = await madeOrSaid(context, () => caller.make(), "  ");
  return made ? { file: made.file, text: made.content, created: true } : null;
};

const SECRETS = /^[ \t]*secrets:/;
const PERMISSIONS = /^permissions:/;
const INPUTS = /^[ \t]+inputs:[ \t]*$/;
const WITH = /^[ \t]+with:[ \t]*$/;
const REF_INPUT = /^[ \t]+ref:[ \t]*$/;
const PASSES_REF = /^[ \t]+ref:[ \t]*\$\{\{[ \t]*inputs\.ref[ \t]*\}\}/m;
const indentOf = (line = "") => /^[ \t]*/.exec(line)?.[0] ?? "";

/** The lines of the block `opens` starts, as [start, end), or null when there is none. */
const blockOf = (lines: readonly string[], opens: RegExp) => {
  const start = lines.findIndex((line) => opens.test(line));
  if (start === -1) return null;
  const indent = indentOf(lines[start]);
  let end = start + 1;
  while (end < lines.length && lines[end]?.trim() && indentOf(lines[end]).length > indent.length) {
    end += 1;
  }
  return { start, end, indent };
};

/** The secret names a caller workflow passes, null for `secrets: inherit`, which passes them all. */
const passedOf = (lines: readonly string[]) => {
  const block = blockOf(lines, SECRETS);
  if (!block) return [];
  const body = lines.slice(block.start, block.end).map((line) => line.replace(/#.*/, ""));
  const [first = "", ...rest] = body;
  const value = first.replace(SECRETS, "").trim();
  if (value === "inherit") return null;
  return [...[value, ...rest].join("\n").matchAll(/(?:^|[{,\s])([A-Za-z_]\w*)[ \t]*:/g)].map(
    ([, name = ""]) => name,
  );
};

/**
 * `lines` with the block `opens` starts as `content` has it, re-indented, or dropped when `content`
 * has none. A block `lines` lacks goes at `absent`, or nowhere when that is null.
 */
const withBlock = (
  lines: readonly string[],
  content: readonly string[],
  opens: RegExp,
  absent: { start: number; indent: string } | null,
) => {
  const place = blockOf(lines, opens) ?? (absent && { ...absent, end: absent.start });
  if (!place) return [...lines];
  const theirs = blockOf(content, opens);
  const block = theirs
    ? content
        .slice(theirs.start, theirs.end)
        .map((line) => `${place.indent}${line.slice(theirs.indent.length)}`)
    : [];
  return [...lines.slice(0, place.start), ...block, ...lines.slice(place.end)];
};

/** `block`'s lines moved from the indent of its first line to `indent`. */
const reindented = (block: readonly string[], indent: string) => {
  const from = indentOf(block[0]).length;
  return block.map((line) => `${indent}${line.slice(from)}`);
};

/**
 * `text` taking the `ref` input and passing it on, as `content` does: a ship then runs from the
 * default branch, today's workflow, and checks out the tag. Unchanged when it already does, when
 * `content` does not, or when `text` declares no inputs to add it to.
 */
const withRef = (text: string, content: string) => {
  if (!PASSES_REF.test(content) || PASSES_REF.test(text)) return text;
  const lines = text.split("\n");
  const made = content.split("\n");
  const inputs = blockOf(lines, INPUTS);
  const declared = blockOf(made, REF_INPUT);
  const passes = made.find((line) => PASSES_REF.test(line));
  if (!inputs || !declared || !passes || inputs.end === inputs.start + 1) return text;
  const input = reindented(
    made.slice(declared.start, declared.end),
    indentOf(lines[inputs.start + 1]),
  );
  const added = [...lines.slice(0, inputs.end), ...input, ...lines.slice(inputs.end)];
  const passing = blockOf(added, WITH);
  if (passing && passing.end > passing.start + 1) {
    const line = `${indentOf(added[passing.start + 1])}${passes.trim()}`;
    return [...added.slice(0, passing.end), line, ...added.slice(passing.end)].join("\n");
  }
  const { start, indent } = afterUses(added);
  return [
    ...added.slice(0, start),
    `${indent}with:`,
    `${indent}  ${passes.trim()}`,
    ...added.slice(start),
  ].join("\n");
};

/**
 * `text` with its `uses:` line pinned as `content`'s is, taking the tag to ship when `content`
 * does; everything else as the person wrote it.
 */
const repinned = (text: string, content: string) => {
  const uses = USES.exec(content)?.[0].trim() ?? "";
  return withRef(
    text.replace(USES, (_line, indent: string) => `${indent}${uses}`),
    content,
  );
};

/** Where a job's `secrets:` goes when it has none: after the keys beside its `uses:` line. */
const afterUses = (lines: readonly string[]) => {
  const uses = lines.findIndex((line) => USES.test(line));
  const indent = indentOf(lines[uses]);
  let start = uses + 1;
  while (
    start < lines.length &&
    lines[start]?.trim() &&
    indentOf(lines[start]).length >= indent.length
  ) {
    start += 1;
  }
  return { start, indent };
};

/** `text` passing the secrets and asking the permissions `content` does, the rest as written. */
const resecreted = (text: string, content: string) => {
  const lines = text.split("\n");
  const made = content.split("\n");
  const secreted = withBlock(lines, made, SECRETS, afterUses(lines));
  return withBlock(secreted, made, PERMISSIONS, null).join("\n");
};

/** Whether the top-level permissions of `text` allow this one. */
export const allows = (text: string, permission: string, level: string) => {
  const lines = text.split("\n");
  const block = blockOf(lines, PERMISSIONS);
  const body = block ? lines.slice(block.start, block.end).join("\n") : "";
  return /write-all/.test(body) || new RegExp(`\\b${permission}:[ \\t]*${level}\\b`).test(body);
};

const VARIABLES = /^[ \t]+variables:[ \t]*["']?([^"'\n]*)["']?[ \t]*$/m;
const variablesOf = (text: string) => (VARIABLES.exec(text)?.[1] ?? "").split(/\s+/);

/** `text` passing the variables `content` does, the rest as written. */
const withVariables = (text: string, content: string) => {
  const passes = VARIABLES.exec(content)?.[0].trim();
  if (!passes) return text;
  if (VARIABLES.test(text)) return text.replace(VARIABLES, (line) => `${indentOf(line)}${passes}`);
  const lines = text.split("\n");
  const passing = blockOf(lines, WITH);
  if (passing && passing.end > passing.start + 1) {
    const line = `${indentOf(lines[passing.start + 1])}${passes}`;
    return [...lines.slice(0, passing.end), line, ...lines.slice(passing.end)].join("\n");
  }
  // `with: { … }` on one line is left to the person: a second `with:` would be no workflow at all.
  if (lines.some((line) => /^[ \t]+with:[ \t]*\S/.test(line))) return text;
  const { start, indent } = afterUses(lines);
  return [
    ...lines.slice(0, start),
    `${indent}with:`,
    `${indent}  ${passes}`,
    ...lines.slice(start),
  ].join("\n");
};

/** `needs`, plus the GitHub App secrets `text` passes by hand: shiplane's own, kept as they are. */
const withAppSecrets = (needs: CallerNeeds, text: string | null): CallerNeeds => {
  const app = (text === null ? [] : (passedOf(text.split("\n")) ?? [])).filter((name) =>
    name.startsWith("SHIPLANE_APP_"),
  );
  return { ...needs, secrets: [...new Set([...needs.secrets, ...app])].sort() };
};

/** Which app needs a secret, and what it ships with, as a person reads it. */
const whoNeeds = (release: Release, secret: string) => {
  for (const module of release.modules) {
    const unit = release.units.find(
      (app) =>
        app.module === module.name &&
        (module.requirements?.([app]) ?? []).some(({ secrets = [] }) => secrets.includes(secret)),
    );
    if (unit) return `${unit.dir} ships with ${module.provider}`;
  }
  return "the release needs it";
};

/** What is wrong with the secrets a caller workflow passes, said by name; null when nothing is. */
const secretsSaid = (release: Release, name: string, text: string, needed: readonly string[]) => {
  const passed = passedOf(text.split("\n"));
  if (passed === null) {
    return needed.length === 0
      ? `${name} passes every secret (inherit), and its adapters need none`
      : `${name} passes every secret (inherit), not only ${needed.join(", ")}`;
  }
  const said = [
    ...needed
      .filter((secret) => !passed.includes(secret))
      .map((secret) => `passes no ${secret}, and ${whoNeeds(release, secret)}`),
    ...passed
      .filter((secret) => !needed.includes(secret))
      .map((secret) => `passes ${secret}, which no adapter needs`),
  ];
  return said.length === 0 ? null : `${name} ${said.join("; ")}`;
};

interface Problem {
  said: string;
  ask: string;
  /** The file once fixed, given it as it stands and as the pipeline makes it. */
  fix: (text: string, content: string) => string;
  /** Set when fixing it loses the person's own workflow. */
  overwrites?: boolean;
}

type Caller = NonNullable<ReturnType<typeof callerOf>>;

/** What is wrong with the caller workflow, each with its fix; one that overwrites comes alone. */
const problemsOf = (release: Release, caller: Caller, text: string | null): Problem[] => {
  const { file, name, version, needs } = caller;
  if (text === null) {
    return [{ said: `${name} missing`, ask: `Write ${file}?`, fix: (_text, content) => content }];
  }
  const local = CALLS_LOCAL.test(text);
  if (!local && !text.includes(CALLS)) {
    return [
      {
        said: `${name} does not call shiplane-ship.yml`,
        ask: `Replace ${file} with one that calls shiplane-ship.yml? Your workflow is lost.`,
        fix: (_text, content) => content,
        overwrites: true,
      },
    ];
  }
  const problems: Problem[] = [];
  const pinned = PINNED.exec(text)?.[1];
  if (!local && pinned !== version) {
    problems.push({
      said: `${name} pins ${pinned ? `shiplane@${pinned}` : "no shiplane version"}, installed ${version}`,
      ask: `Re-pin ${file} to shiplane@${version}?`,
      fix: repinned,
    });
  }
  const said = secretsSaid(release, name, text, needs.secrets);
  if (said) {
    problems.push({
      said,
      ask: `Pass ${file} only the secrets its adapters need, with the permissions they need?`,
      fix: resecreted,
    });
  }
  const lacking = Object.entries(needs.permissions ?? {}).filter(
    ([permission, level]) => !allows(text, permission, level),
  );
  if (lacking.length > 0 && !said) {
    problems.push({
      said: `${name} does not allow ${lacking.map(([p, level]) => `${p}: ${level}`).join(", ")}`,
      ask: `Give ${file} the permissions its adapters need?`,
      fix: resecreted,
    });
  }
  const unread = (needs.variables ?? []).filter((v) => !variablesOf(text).includes(v));
  if (unread.length > 0) {
    problems.push({
      said: `${name} passes no ${unread.join(", ")}`,
      ask: `Pass ${file} the variables its builds read?`,
      fix: withVariables,
    });
  }
  return problems;
};

/**
 * Doctor's check of the caller workflow, on a laptop only: there, pinned to the shiplane installed,
 * passing the secrets the configured adapters need, each problem said with its fix offered.
 * Replacing a person's own workflow is asked, never assumed; re-pinning and the secrets are not.
 */
export const checkCallerWorkflow = async (
  context: SetupContext,
  release: Release,
  { yes }: { yes: boolean },
): Promise<boolean> => {
  const { shell, files, output, prompter } = context;
  if (shell.env("GITHUB_ACTIONS") === "true" || shell.env("CI") === "true") return true;
  const caller = callerOf(context, release);
  if (!caller) return true;
  const { file, name, version } = caller;
  const bar = `${paint("dim", "│")}  `;
  const text = files.read(file);
  const needs = withAppSecrets(caller.needs, text);
  const problems = problemsOf(release, { ...caller, needs }, text);
  if (problems.length === 0) {
    output.line(`${bar}${paint("green", "✓")} ${name}  ${paint("dim", `shiplane@${version}`)}`);
    return true;
  }
  problems.forEach(({ said }) => output.line(`${bar}${paint("red", "✗")} ${said}`));
  const agreed: Problem[] = [];
  for (const problem of problems) {
    const fixing = problem.overwrites
      ? !yes && prompter.interactive && (await prompter.confirm(problem.ask, false))
      : yes || (prompter.interactive && (await prompter.confirm(problem.ask, true)));
    if (fixing) agreed.push(problem);
  }
  if (agreed.length === 0) return false;
  const made = await madeOrSaid(context, () => caller.make(needs), bar);
  if (!made) return false;
  files.write(
    file,
    agreed.reduce((fixed, { fix }) => fix(fixed, made.content), text ?? ""),
  );
  output.line(`${bar}${text === null ? paint("green", "+") : paint("yellow", "~")} ${file}`);
  return agreed.length === problems.length;
};

/** The Renovate preset that keeps the caller workflow's pin, commit and comment, current. */
export const SHIPLANE_RENOVATE_PRESET = "github>arnaud-zg/js-packages//renovate/shiplane";

/** Where Renovate looks for its config, in its order; JSON5 ones setup leaves to the person. */
const RENOVATE_CONFIGS = [
  "renovate.json",
  "renovate.json5",
  ".github/renovate.json",
  ".github/renovate.json5",
  ".gitlab/renovate.json",
  ".gitlab/renovate.json5",
  ".renovaterc",
  ".renovaterc.json",
  ".renovaterc.json5",
];

type RenovateConfig = Record<string, unknown> & { extends?: unknown };

/** The config a JSON text holds, or null when it is not JSON. */
const jsonObject = (text: string) => {
  try {
    return JSON.parse(text) as RenovateConfig | null;
  } catch {
    return null;
  }
};

/** The repository's Renovate config: its file, its text, its JSON when setup may edit it. */
const renovateConfigOf = ({ files }: SetupContext) => {
  const file = RENOVATE_CONFIGS.find((name) => files.exists(name));
  const text = files.read(file ?? "package.json") ?? "";
  if (file) return { file, text, config: file.endsWith(".json5") ? null : jsonObject(text) };
  return jsonObject(text)?.renovate === undefined
    ? null
    : { file: "package.json", text, config: null };
};

/**
 * Renovate's part once ship.yml calls shiplane-ship.yml (`shipText`, else as on disk): the write
 * adding the preset to a JSON config's `extends`, else null once what to do is said. A config is
 * never created, and one setup cannot safely edit is named, never touched.
 */
export const renovateWrite = (context: SetupContext, release: Release, shipText?: string) => {
  const caller = callerOf(context, release);
  const text = shipText ?? (caller ? context.files.read(caller.file) : null);
  if (!text?.includes(CALLS)) return null;
  const found = renovateConfigOf(context);
  const entry = `"${SHIPLANE_RENOVATE_PRESET}"`;
  if (!found) {
    context.output.line(
      `  ${paint("dim", `shiplane doctor keeps the ship.yml pin current; on Renovate, add ${entry} to extends`)}`,
    );
    return null;
  }
  const { file, config } = found;
  if (found.text.includes(entry)) return null;
  if (!config) {
    context.output.line(
      `  ${paint("yellow", "!")} ${file}: add ${entry} to extends to keep the ship.yml pin current`,
    );
    return null;
  }
  const presets = Array.isArray(config.extends) ? (config.extends as unknown[]) : [];
  const extended = { ...config, extends: [...presets, SHIPLANE_RENOVATE_PRESET] };
  return {
    file,
    text: `${JSON.stringify(extended, null, 2)}\n`,
    created: false,
    reason: "Renovate keeps the ship.yml pin current",
  };
};
