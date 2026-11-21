/**
 * Reads the release config a repository holds: `shiplane.config.ts` today, `shiplane.yml` next.
 * The reader only finds and reads; `loadRelease` checks what it read and makes it a release.
 */
export interface ConfigReader {
  /** The config file this folder holds, as a path; null when it holds none. */
  find: (root: string) => string | null;
  /** What the file declares, as written. Throws when the file does not load. */
  read: (file: string) => Promise<unknown>;
}

/** A config that reads but says something wrong: where, and how to fix it. */
export class ConfigError extends Error {
  /** The keys and indexes down to the wrong value, such as ["flow", "versioning", "use"]. */
  readonly path: readonly (string | number)[];
  readonly hint: string | undefined;
  /** The line it is on, once a reader that knows the file's lines sets it. */
  line: number | undefined;

  constructor(
    message: string,
    { path = [], hint }: { path?: readonly (string | number)[]; hint?: string } = {},
  ) {
    super(message);
    this.name = "ConfigError";
    this.path = path;
    this.hint = hint;
    this.line = undefined;
  }
}
