import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";

// ─── Defaults ─────────────────────────────────────────────────────────────────

const ROOT_DEFAULTS = {
  file: "CLAUDE.md",
  referencePattern: "`(\\.planning/codebase/[^`]+\\.md)`",
  threshold: 3500,
} as const;

const REF_DEFAULTS = {
  threshold: 2000,
  failOnExceed: false,
} as const;

const SUBDIR_DEFAULTS = {
  dirs: ["apps", "packages"],
  threshold: 1500,
  failOnExceed: false,
} as const;

const HEALTH_DEFAULTS = {
  goodBelow: 0.6,
  normalBelow: 0.85,
} as const;

export const ConfigSchema = z.object({
  charsPerToken: z.number().int().positive().default(4),
  root: z
    .object({
      file: z.string().default(ROOT_DEFAULTS.file),
      referencePattern: z.string().default(ROOT_DEFAULTS.referencePattern),
      threshold: z.number().int().positive().default(ROOT_DEFAULTS.threshold),
    })
    .default(ROOT_DEFAULTS),
  references: z
    .object({
      threshold: z.number().int().positive().default(REF_DEFAULTS.threshold),
      failOnExceed: z.boolean().default(REF_DEFAULTS.failOnExceed),
    })
    .default(REF_DEFAULTS),
  subdir: z
    .object({
      dirs: z.array(z.string()).default([...SUBDIR_DEFAULTS.dirs]),
      threshold: z.number().int().positive().default(SUBDIR_DEFAULTS.threshold),
      failOnExceed: z.boolean().default(SUBDIR_DEFAULTS.failOnExceed),
    })
    .default({ ...SUBDIR_DEFAULTS, dirs: [...SUBDIR_DEFAULTS.dirs] }),
  health: z
    .object({
      goodBelow: z.number().min(0).max(1).default(HEALTH_DEFAULTS.goodBelow),
      normalBelow: z.number().min(0).max(1).default(HEALTH_DEFAULTS.normalBelow),
    })
    .refine((health) => health.goodBelow < health.normalBelow, {
      message: "health.goodBelow must be lower than health.normalBelow",
    })
    .default(HEALTH_DEFAULTS),
  // Directory scanned for orphaned reference docs (files not linked from `root.file`).
  planningDir: z.string().default(".planning/codebase"),
});

export type Config = z.infer<typeof ConfigSchema>;

const CONFIG_FILE = "agent-context-budget.config.json";
const LEGACY_CONFIG_FILE = "context-budget.config.json";

// The legacy name is read only while it is the sole config file, so a rename never loses settings.
export function defaultConfigPath(): string {
  return !existsSync(CONFIG_FILE) && existsSync(LEGACY_CONFIG_FILE)
    ? LEGACY_CONFIG_FILE
    : CONFIG_FILE;
}

function warnAboutLegacyConfigFile(): void {
  if (!existsSync(LEGACY_CONFIG_FILE)) return;
  console.warn(
    existsSync(CONFIG_FILE)
      ? `⚠ ${LEGACY_CONFIG_FILE} is ignored because ${CONFIG_FILE} exists. Delete it.`
      : `⚠ ${LEGACY_CONFIG_FILE} is deprecated and will be removed in the next release. Rename it to ${CONFIG_FILE}.`,
  );
}

// Per-field schema defaults let a partial file override only the fields it names.
export function loadConfig(configPath?: string): Config {
  if (configPath === undefined) warnAboutLegacyConfigFile();
  const resolvedPath = configPath ?? defaultConfigPath();
  if (!existsSync(resolvedPath)) return ConfigSchema.parse({});

  const overrides: unknown = JSON.parse(readFileSync(resolvedPath, "utf-8"));
  return ConfigSchema.parse(overrides);
}
