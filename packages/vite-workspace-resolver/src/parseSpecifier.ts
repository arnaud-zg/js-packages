export type ParsedSpecifier = {
  packageName: string;
  /** Exports-map key: "." for the bare package, "./sub/path" otherwise. */
  subpath: string;
  /** The `<rest>` of a `<package>/src/<rest>` import, which bypasses the exports map. */
  deepSrcPath: string | null;
};

// Splits "@scope/name/sub/path" or "name/sub/path" into the package name and the rest.
const SPECIFIER_PATTERN = /^((?:@[^/]+\/)?[^/@][^/]*)(\/.*)?$/;
const DEEP_SRC_PATTERN = /^\/src\/(.+)$/;

export const parseSpecifier = (source: string): ParsedSpecifier | null => {
  const match = SPECIFIER_PATTERN.exec(source);
  const packageName = match?.[1];
  if (!packageName) {
    return null;
  }

  const rest = match[2] ?? "";
  return {
    packageName,
    subpath: `.${rest}`,
    deepSrcPath: DEEP_SRC_PATTERN.exec(rest)?.[1] ?? null,
  };
};
