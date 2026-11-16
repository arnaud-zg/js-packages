[🏠 Home](../../README.md) · [📚 Docs](../README.md) · `expo-pnpm-catalog`:
[🚀 Tutorial](./tutorial.md) · [🛠️ How-to](./how-to.md) · **📖 Reference** ·
[💡 Explanation](./explanation.md)

# 📖 Reference: `expo-pnpm-catalog`

## Exports

| Package             | Subpath                 | Resolves to     | Needs                                                                 |
| ------------------- | ----------------------- | --------------- | --------------------------------------------------------------------- |
| `expo-pnpm-catalog` | `.`                     | `dist/index.js` | nothing extra (bundles `chalk`, `commander`, `js-yaml`, `ora`, `zod`) |
| `expo-pnpm-catalog` | bin `expo-pnpm-catalog` | `dist/cli.js`   | same                                                                  |

## API

### CLI

```
Usage: expo-pnpm-catalog check [options]

Options:
  --dry-run         show resolved versions per package without running expo-doctor
  --app-dir <path>  path to the Expo app (defaults to the current working directory)
```

```
Usage: expo-pnpm-catalog sync [options]

Options:
  --dry-run         show what would change without applying it
  -y, --yes         skip the confirmation prompt
  --app-dir <path>  path to the Expo app (defaults to the current working directory)
```

## Programmatic

```ts
type CatalogPaths = {
  rootDir: string; // root of the pnpm workspace (directory containing pnpm-workspace.yaml)
  appDir: string; // directory of the Expo app being checked/synced
  workspaceYamlPath: string; // absolute path to pnpm-workspace.yaml
  packageJsonPath: string; // absolute path to the Expo app's package.json
};

type CheckOptions = { dryRun: boolean; interrupts?: InterruptGuard };
type InterruptGuard = {
  run<Result>(task: { work: () => Result; onInterrupt: () => void }): Result;
};
type SyncOptions = { dryRun: boolean; yes: boolean };

function findWorkspaceRoot(startDir: string): string;
function runCheck(paths: CatalogPaths, options: CheckOptions): boolean;
function runSync(paths: CatalogPaths, options: SyncOptions): Promise<void>;
```

- `findWorkspaceRoot`: walks up from `startDir` until it finds a `pnpm-workspace.yaml`; throws if it
  reaches the filesystem root without finding one.
- `runCheck`: returns `true` if `expo-doctor` passed against the resolved manifest (`dryRun: true`
  always returns `true` without running it).
- `CheckOptions.interrupts`: wraps the `expo-doctor` run, so `onInterrupt` can put the Expo app's
  `package.json` back if the process is killed mid-run. By default it listens for `SIGINT` and
  `SIGTERM`, restores the file and exits with code 1. Pass your own to handle your process's signals
  yourself.
- `runSync`: writes to `pnpm-workspace.yaml` and runs `pnpm install` unless `dryRun: true`.
- Packages under `expo.install.exclude` in the Expo app's `package.json` are skipped by `runSync`,
  matching `expo install --fix`'s own exclusion behavior. See
  [How-to § Exclude a package from sync](./how-to.md#exclude-a-package-from-sync).

## How workspace packages are discovered

Top-level workspace directories to scan (e.g. `apps`, `packages`) come from the `packages:` globs
declared in `pnpm-workspace.yaml`. If none are declared, it falls back to `apps`, `packages`,
`tooling`.

## Malformed input

`check` and `sync` validate `pnpm-workspace.yaml`, the Expo app's `package.json` and every scanned
workspace `package.json` before using them. A file whose `packages`, `catalog`, `catalogs`,
`dependencies`, `devDependencies` or `expo.install.exclude` has the wrong shape stops the run with
`<path> is malformed:` and the offending field, and the command exits with code 1. A catalog version
written as a bare YAML number (`react: 19`) is read as the string `"19"`.
