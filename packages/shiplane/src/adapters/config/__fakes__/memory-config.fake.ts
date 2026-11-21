import type { ConfigReader } from "../../../ports/config.port";

/**
 * A config held in memory: what a config file would declare, found at `<root>/<file>`. `declared`
 * as an Error makes the read throw it, as a file that does not load would.
 */
export const memoryConfig = (
  declared: unknown,
  { file = "shiplane.config.ts" }: { file?: string } = {},
): ConfigReader & { reads: string[] } => {
  const reads: string[] = [];
  return {
    reads,
    find: (root) => (declared === undefined ? null : `${root}/${file}`),
    read: (path) => {
      reads.push(path);
      return declared instanceof Error ? Promise.reject(declared) : Promise.resolve(declared);
    },
  };
};
