---
"shiplane": patch
---

The reusable ship workflow sets up Node in a repository whose package.json names a pnpm or yarn
`packageManager`, and installs any pnpm version, instead of failing before pnpm runs. It also caches
`node_modules` on the exact lockfile and Node version, so a run with nothing changed skips the
install.
