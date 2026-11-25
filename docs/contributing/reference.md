[🏠 Home](../../README.md) · [📚 Docs](../README.md) · Contributing: [🛠️ How-to](./how-to.md) · **📖
Reference** · [💡 Explanation](./explanation.md)

# 📖 Reference: Contributing

## Package layout

```
packages/
  expo-native-guard/        src/index.ts (barrel), src/core.ts (no React import)
  expo-pnpm-catalog/        src/index.ts (programmatic API), src/cli.ts (bin entry point)
  vite-workspace-resolver/  src/index.ts (Vite plugin)
  agent-context-budget/     src/index.ts (programmatic API), src/cli.ts (bin entry point)
  shiplane/                 src/cli.ts (bin entry point), the release core
  shiplane-<host>/          one plugin per host: changesets, cloudflare-pages, eas, fly, git, github, github-pages, npm
  shiplane-integration/     private: tests across several plugins
docs/                       this documentation
```

Every package `tsconfig` extends `@arnaud-zg/configs`, then the root `tsconfig.base.json`, which
turns `noUncheckedIndexedAccess` back on: an indexed read stays `T | undefined`, so guards on it
keep checking a real case.

Each package's `dist/` (gitignored) is what its `package.json` `exports` actually resolve to. Every
package builds through `tsdown`, from `tsdown.library.mjs` at the root: the shared
`@arnaud-zg/configs/tsdown` build, minified. The output stays ES modules with `sideEffects: false`,
so a bundler still drops what a consumer does not import; functions and classes keep their names;
source maps map back to the source. `expo-pnpm-catalog` and `agent-context-budget` build CommonJS
(`format: ["cjs"]`) and keep their hand-written `exports` and `bin` (`exports: false`), since their
`dist/cli.js` isn't part of the `exports` map `tsdown` would generate.

## Scripts (for contributors to this repo)

| Script (from repo root)        | Runs                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------- |
| `pnpm lint`                    | `eslint .`                                                                      |
| `pnpm lint:md`                 | `remark . --frail --quiet`                                                      |
| `pnpm format` / `format:check` | `prettier --write .` / `prettier --check .`                                     |
| `pnpm typecheck`               | `tsc` (or the package's typecheck config) in every package                      |
| `pnpm test`                    | `vitest run` in every package                                                   |
| `pnpm test:mutate`             | Stryker mutation testing, one package at a time; fails under 70%, by hand only  |
| `pnpm build`                   | builds every package with `tsdown`, minified                                    |
| `pnpm verify`                  | typecheck, lint, lint:md, format:check, test, build                             |
| `pnpm changeset`               | records a pending version bump, see [How-to](./how-to.md#release-a-new-version) |
| `pnpm release`                 | `pnpm build && shiplane`, see [How-to](./how-to.md#release-a-new-version)       |
| `pnpm shiplane status`         | what each package would release next                                            |

## Package lifecycle

A package gets a **maturity score out of 8**: one point per sign it has reached.

1. Count the 5 [stability](#stability-indicators) points.
2. At 5 of 5, add the 3 [traction](#traction-indicators) points. Below 5, traction adds nothing yet.
3. Read what to do:

| Score  | Level      | Version | What to do                                      |
| ------ | ---------- | ------- | ----------------------------------------------- |
| 0 to 4 | Incubating | `0.x`   | Stay here and work on the missing stability     |
| 5 or 6 | Stable     | `1.x`   | Release `1.0.0` and stay here, for good if fine |
| 7 or 8 | Outgrown   | `1.x`   | Release `1.0.0`, then discuss its own repo      |

The same decision as a matrix:

|                             | Stability under 5                     | Stability 5 of 5               |
| --------------------------- | ------------------------------------- | ------------------------------ |
| **Traction under 2 of 3**   | Incubating: stay, `0.x`               | Stable: stay, `1.x`            |
| **Traction 2 of 3 or more** | Incubating: stay, reach `1.0.0` first | Outgrown: discuss its own repo |

**A package must be stable (`1.0.0` or later) before it gets its own repo.** The score opens each
decision; the maintainer makes it.

Example: stability 4 and traction 3 scores **4**, Incubating. With the fifth stability point it
scores **8**, Outgrown.

### Stability indicators

One point each. Why: see [Explanation](./explanation.md#when-a-package-is-stable). A serious bug
loses data, blocks a release or has no workaround: label it `bug` and `priority: high`.

| Point              | Reached at                                                                     | Where to look                                                       |
| ------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| API is quiet       | No breaking change in the last 3 months, with at least 3 releases in that time | `CHANGELOG.md`                                                      |
| Proven in real use | 2,000 npm downloads a month, 3 months in a row, and 10 releases in total       | `https://npm-stat.com/charts.html?package=<pkg>` and `CHANGELOG.md` |
| No serious bug     | None open, and none opened in the last 3 months                                | Issues labelled `bug`, `priority: high` and `pkg: <name>`           |
| Tested             | Mutation score of at least 70%, and tests pass on every supported runtime      | `pnpm test:mutate` and CI                                           |
| Documented         | Every public export and command; the first example works when pasted           | The package README and its docs                                     |

After `1.0.0`, two majors within 6 months mean it went stable too early.

### Traction indicators

One point each, counted from people outside. Why: see
[Explanation](./explanation.md#why-this-repo-is-an-incubator).

| Point                | Reached at                                         | Where to look                                    |
| -------------------- | -------------------------------------------------- | ------------------------------------------------ |
| npm downloads        | 5,000 a month, 3 months in a row                   | `https://npm-stat.com/charts.html?package=<pkg>` |
| Issues from users    | 10 in total, not opened by the maintainer or a bot | The `pkg: <name>` label                          |
| Outside contributors | 3 people with a merged pull request                | Merged pull requests touching `packages/<dir>`   |

A family gets one score: `shiplane` and its `@shiplane/*` plugins share one version, so every plugin
must reach the stability points, and they move together.

## Findability rules

For every published package. Why: see
[Explanation](./explanation.md#why-every-package-is-written-to-be-found).

| Where                         | Rule                                                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `description`                 | One plain sentence, under 160 characters: what it does and the tool it works with. No error messages                   |
| `keywords`                    | 3 to 7 tags with a big community (`expo`, `vite`, `monorepo`, `claude-code`...). Plugins: `shiplane` + the host's tags |
| `homepage`, `repository`      | The package's README on GitHub, and `directory: packages/<dir>`                                                        |
| README, top                   | The problem in the reader's words, then one picture of the result (screenshot, diagram or terminal output)             |
| README, "Fixes" section       | The exact error text, when the package fixes one                                                                       |
| README, first code example    | Complete, `import` line included                                                                                       |
| Root README and `docs/README` | One symptom line per top-level package, linking to its README. Details stay in the package README                      |

A private package needs no search work, but still a README: what it is for, how to run it, and when
to add to it.

## Link rules

A reader goes from one page to the next without landing on a folder listing.

| Link                     | Rule                                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| To a doc or a package    | A specific `.md` file (`docs/<pkg>/how-to.md`, `packages/<pkg>/README.md`), never its folder   |
| Package README to docs   | One link per page: `📚 Guides: 🚀 Tutorial · 🛠️ How-to · 📖 Reference · 💡 Explanation`        |
| In a published README    | An absolute `https://github.com/arnaud-zg/packages/blob/main/...` URL, so it also works on npm |
| Top of every `docs` page | The nav bar: 🏠 Home, 📚 Docs, then every sibling page of that package                         |
| To an example            | The file to read first (`examples/shiplane.config.ts`), not the `examples/` folder             |
