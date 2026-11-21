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
