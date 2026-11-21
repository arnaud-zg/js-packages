---
"shiplane": minor
"@shiplane/git": minor
"@shiplane/github": minor
"@shiplane/changesets": minor
"@shiplane/npm": minor
"@shiplane/fly": minor
"@shiplane/cloudflare-pages": minor
"@shiplane/eas": minor
---

Each plugin exports a `catalog`: every adapter and feature it gives, the port each fills, and its
options as a zod schema. shiplane's own modules and the shell adapter have one too. A plugin of your
own builds its catalog with `adapterEntry`, `moduleEntry` and `featureEntry` from `shiplane/plugin`.
This is what a `shiplane.yml` config names, next.
