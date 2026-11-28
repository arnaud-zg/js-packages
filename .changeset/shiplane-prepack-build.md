---
"shiplane": patch
"@shiplane/changesets": patch
"@shiplane/cloudflare-pages": patch
"@shiplane/eas": patch
"@shiplane/fly": patch
"@shiplane/git": patch
"@shiplane/github": patch
"@shiplane/github-pages": patch
"@shiplane/npm": patch
---

Each shiplane package builds itself on `pnpm pack` and `pnpm publish`, so a publish run by hand
outside `pnpm release` or the Ship workflow never ships a stale `dist`.
