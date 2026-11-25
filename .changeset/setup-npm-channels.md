---
"shiplane": minor
"@shiplane/github": minor
"@shiplane/npm": patch
---

Choose where a repository ships: `environments` for apps (`preview`, `production` or one of them)
and `channels` for npm packages. Both are optional and unset changes nothing. `shiplane setup`
writes a `ship.yml` listing them, with the permissions npm needs, and `shiplane doctor` keeps it in
step.
