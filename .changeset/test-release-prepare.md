---
"shiplane": patch
---

A test release runs the config's `prepare` before each package publishes, as `shiplane ship` does,
so npm gets what the commit holds instead of a `dist` built earlier. A failed `prepare` publishes
nothing.
