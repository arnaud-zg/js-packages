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

Two questions decide what happens to a package: is it stable, and has it outgrown this repo?

|                                                | Not stable: under 5 of 5 stability          | Stable: 5 of 5 stability                           |
| ---------------------------------------------- | ------------------------------------------- | -------------------------------------------------- |
| **Little traction**: under 2 of 3 maturity     | **Stay here, `0.x`**: keep experimenting    | **Stay here, `1.x`**: release `1.0.0`, a fine home |
| **Outside traction**: at least 2 of 3 maturity | **Stay here, `0.x`**: work on `1.0.0` first | **Discuss its own repo**, once `1.0.0` is released |

**A package must be stable (`1.0.0` or later) before it gets its own repo.** The numbers open each
decision; the maintainer makes it. A family counts as one package: `shiplane` and its `@shiplane/*`
plugins share one version, so every plugin must qualify, and they move together.

### Stability indicators

All 5 are required. Why: see [Explanation](./explanation.md#when-a-package-is-stable).

| Indicator            | Reached at                                                                | Where to look                     |
| -------------------- | ------------------------------------------------------------------------- | --------------------------------- |
| API is quiet         | No breaking change for 3 months, with at least 3 releases in that time    | `CHANGELOG.md`                    |
| Proven in real use   | 2 projects used it for 3 months, at least one outside this repo           | Their `package.json` and lockfile |
| No known serious bug | 0 open bugs that lose data, block a release or have no workaround         | The `pkg: <name>` label           |
| Tested               | Mutation score of at least 70%, and tests pass on every supported runtime | `pnpm test:mutate` and CI         |
| Documented           | Every public export and command; the first example works when pasted      | The package README and its docs   |

After `1.0.0`, two majors within 6 months mean it went stable too early.

### Maturity indicators

Three signs of outside traction, per package. Not strict: **2 of the 3** open the discussion about a
dedicated repo. Why: see [Explanation](./explanation.md#why-this-repo-is-an-incubator).

| Indicator            | Reached at                                         | Where to look                                    |
| -------------------- | -------------------------------------------------- | ------------------------------------------------ |
| npm downloads        | 5,000 a month, 3 months in a row                   | `https://npm-stat.com/charts.html?package=<pkg>` |
| Issues from users    | 10 in total, not opened by the maintainer or a bot | The `pkg: <name>` label                          |
| Outside contributors | 3 people with a merged pull request                | Merged pull requests touching `packages/<dir>`   |

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
