/** The repository's files, by path relative to its root. */
export interface Files {
  exists: (file: string) => boolean;
  read: (file: string) => string | null;
  write: (file: string, text: string) => void;
  /**
   * Adds text at the end of a file, made when missing. An absolute path may sit outside the
   * repository, such as a runner's `GITHUB_STEP_SUMMARY`.
   */
  append: (file: string, text: string) => void;
  remove: (file: string) => void;
  /** Entries directly in a folder; empty when it does not exist. */
  list: (dir: string) => string[];
  /** The folders directly in a folder, by name; empty when it does not exist. */
  folders: (dir: string) => string[];
}
