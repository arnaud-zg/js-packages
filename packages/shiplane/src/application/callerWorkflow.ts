import path from "node:path";

import type { CallerNeeds, CallerWorkflow } from "../ports/ci-pipeline.port";
import type { Release } from "./config/loadRelease";
import type { SetupContext } from "./setupContext";
import { RELEASE_CHANNEL } from "../domain/environment";
import { channels } from "../domain/testChannel";
import { deploysApps } from "./chooseEnvironments";
import { requirementsOf } from "./requirements";
import { paint, reasonOf } from "./say";

/** The step of a ship.yml that ships: shiplane's action, pinned, or `./` in shiplane's own repository. */
const SHIPS = /\/\.github\/actions\/ship(@|[ \t]*$)/m;
const LOCAL = /uses:[ \t]*\.\/\.github\/actions\/ship[ \t]*$/m;
const USES = /uses:[ \t]*\S*\/\.github\/actions\/ship(?:@.*)?$/m;
const PINNED = /\/actions\/ship@\S+[ \t]+#[ \t]*shiplane@(\S+)/;

/** What a runner may do to publish packages: sign in, tag and note a release, comment. */
const PUBLISHING = {
  contents: "write",
  "id-token": "write",
  issues: "write",
  "pull-requests": "write",
} as const;

/** Where a release ships: its apps' environments, and its packages' channels. */
const placesOf = (release: Release) => {
  const shipping = release.units.flatMap((unit) => {
    const module = release.modules.find(({ name }) => name === unit.module);
    return module && !module.releaseOnly ? [module] : [];
  });
  const isPackage = ({ capability }: (typeof shipping)[number]) =>
    capability === "package-registry";
  const packages = shipping.some(isPackage);
  const onBranch = release.onBranch === false ? [] : [channels.snapshot];
  const every = [
    ...Object.values(channels),
    ...Object.values(release.testRelease ?? {}),
    RELEASE_CHANNEL,
  ];
  const named = release.channels ?? every.filter((name) => name !== channels.snapshot);
  return {
    apps: shipping.some(deploysApps) ? [...release.appFlow.path] : [],
    channels: packages ? [...new Set([...onBranch, ...named])] : [],
  };
};

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
  const { apps, channels: named } = placesOf(release);
  const environments = [...apps, ...named];
  return {
    apps,
    // A repository with nothing to ship still has a list to write.
    environments: environments.length > 0 ? environments : [RELEASE_CHANNEL],
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
  // One already there lists the channels its person chose, unless the config names them.
  const written = files.read(file);
  const channelsNamed =
    written === null || release.channels !== undefined || release.onBranch !== undefined;
  const environments = base.environments.filter(
    (name) => base.apps.includes(name) || channelsNamed || ci.offers?.(written, name),
  );
  const publishes = channelsNamed && placesOf(release).channels.length > 0;
  const needs: CallerNeeds = {
    ...base,
    environments,
    ...(publishes ? { permissions: { ...base.permissions, ...PUBLISHING } } : {}),
  };
  return {
    file,
    name: path.posix.basename(file),
    version,
    needs,
    offers: ci.offers?.bind(ci),
    make: () => make(version, needs),
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

const PERMISSIONS = /^permissions:/;
const WITH = /^[ \t]+with:[ \t]*$/;
/** A secret given to the action, by name. */
const SECRET = /^[ \t]+([A-Z][A-Z0-9_]*):[ \t]*\$\{\{[ \t]*secrets\.\w+[ \t]*\}\}/;
const VARIABLE = /\$\{\{[ \t]*vars\.(\w+)/g;
const OPTIONS = /^([ \t]*)options:[ \t]*\[.*\][ \t]*$/m;
/** The job environment once written, named on a run and left off a dry run: its secrets too. */
const HIDING =
  /^([ \t]+)(?:# A dry run names none.*\n\1)?environment:[ \t]*\$\{\{[ \t]*!inputs\.dry-run && inputs\.environment \|\| ''[ \t]*\}\}[ \t]*$/m;
const indentOf = (line = "") => /^[ \t]*/.exec(line)?.[0] ?? "";

/** The block that starts at `start`, as [start, end): the lines indented under it. */
const blockAt = (lines: readonly string[], start: number) => {
  const indent = indentOf(lines[start]).length;
  let end = start + 1;
  while (end < lines.length && lines[end]?.trim() && indentOf(lines[end]).length > indent) end += 1;
  return lines.slice(start, end);
};

/** The top-level permissions of `lines`, none when it asks for none. */
const permissionsOf = (lines: readonly string[]) => {
  const start = lines.findIndex((line) => PERMISSIONS.test(line));
  return start === -1 ? [] : blockAt(lines, start);
};

/** Whether the top-level permissions of `text` allow this one. */
export const allows = (text: string, permission: string, level: string) => {
  const body = permissionsOf(text.split("\n")).join("\n");
  return /write-all/.test(body) || new RegExp(`\\b${permission}:[ \\t]*${level}\\b`).test(body);
};

/** `text` pinned as `content` is, everything else as the person wrote it. */
const repinned = (text: string, content: string) =>
  text.replace(USES, () => USES.exec(content)?.[0] ?? "");

/** `text` asking for the permissions `content` does; one that asks for none is left to the person. */
const repermitted = (text: string, content: string) => {
  const theirs = permissionsOf(content.split("\n")).join("\n");
  const ours = permissionsOf(text.split("\n")).join("\n");
  return ours && theirs ? text.replace(ours, () => theirs) : text;
};

/** `text` giving the action the secrets `content` does; without a `with:`, left to the person. */
const resecreted = (text: string, content: string) => {
  const lines = text.split("\n").filter((line) => !SECRET.test(line));
  const uses = lines.findIndex((line) => USES.test(line));
  const start = lines.findIndex((line, index) => index > uses && WITH.test(line));
  if (start === -1) return text;
  const secrets = content
    .split("\n")
    .filter((line) => SECRET.test(line))
    .map((line) => `${indentOf(lines[start])}  ${line.trim()}`);
  const end = start + blockAt(lines, start).length;
  const given = [...lines.slice(0, end), ...secrets, ...lines.slice(end)].join("\n");
  return repermitted(given, content);
};

/** `text` with the variables in its job's `env:`, before its steps. */
const withVariables = (text: string, names: readonly string[]) =>
  text.replace(/^([ \t]+)(env:[ \t]*\n|steps:)/m, (found, indent: string, key: string) => {
    const lines = names.map((name) => `${indent}  ${name}: \${{ vars.${name} }}\n`).join("");
    return key.startsWith("env") ? `${found}${lines}` : `${indent}env:\n${lines}${found}`;
  });

/** `text` offering the environments `content` does; a list written another way is left as it is. */
const reoffered = (text: string, content: string) => {
  const line = OPTIONS.exec(content)?.[0].trim();
  return line ? text.replace(OPTIONS, (_line, indent: string) => `${indent}${line}`) : text;
};

/** `text` binding its job to the environment on a dry run too, recording no deployment then. */
const unhidden = (text: string) =>
  text.replace(HIDING, (_found, indent: string) =>
    [
      `${indent}# A dry run reads the environment's secrets and records no deployment.`,
      `${indent}environment:`,
      `${indent}  name: \${{ inputs.environment }}`,
      `${indent}  deployment: \${{ !inputs.dry-run }}`,
    ].join("\n"),
  );

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
  const passed = text.split("\n").flatMap((line) => SECRET.exec(line)?.[1] ?? []);
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
  if (!SHIPS.test(text)) {
    return [
      {
        said: `${name} does not ship with shiplane`,
        ask: `Replace ${file} with one that does? Your workflow is lost.`,
        fix: (_text, content) => content,
        overwrites: true,
      },
    ];
  }
  const problems: Problem[] = [];
  const pinned = PINNED.exec(text)?.[1];
  if (!LOCAL.test(text) && pinned !== version) {
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
      fix: repermitted,
    });
  }
  const missing = needs.environments.filter(
    (environment) => OPTIONS.test(text) && caller.offers && !caller.offers(text, environment),
  );
  if (missing.length > 0) {
    problems.push({
      said: `${name} does not offer ${missing.join(", ")}`,
      ask: `Let ${file} ship to ${missing.join(", ")}?`,
      fix: reoffered,
    });
  }
  if (HIDING.test(text)) {
    problems.push({
      said: `${name} names no environment on a dry run, so the run cannot read its secrets`,
      ask: `Let a dry run of ${file} read the environment's secrets?`,
      fix: unhidden,
    });
  }
  const read = [...text.matchAll(VARIABLE)].map(([, variable]) => variable);
  const unread = (needs.variables ?? []).filter((variable) => !read.includes(variable));
  if (unread.length > 0) {
    problems.push({
      said: `${name} passes no ${unread.join(", ")}`,
      ask: `Pass ${file} the variables its builds read?`,
      fix: (current) => withVariables(current, unread),
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
  const problems = problemsOf(release, caller, text);
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
  const made = await madeOrSaid(context, () => caller.make(), bar);
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
 * Renovate's part once ship.yml ships with shiplane (`shipText`, else as on disk): the write
 * adding the preset to a JSON config's `extends`, else null once what to do is said. A config is
 * never created, and one setup cannot safely edit is named, never touched.
 */
export const renovateWrite = (context: SetupContext, release: Release, shipText?: string) => {
  const caller = callerOf(context, release);
  const text = shipText ?? (caller ? context.files.read(caller.file) : null);
  if (!text || !SHIPS.test(text)) return null;
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
