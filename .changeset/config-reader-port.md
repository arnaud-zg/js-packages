---
"shiplane": patch
---

The config is read through a port, `ConfigReader`, with `shiplane.config.ts` as its first adapter.
Nothing changes for a repository: the same files load the same way, with the same problems. It makes
room for a `shiplane.yml` reader next.
