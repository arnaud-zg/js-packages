---
"shiplane": patch
---

`shiplane-ship.yml` and the `setup-node-project` action cache `node_modules` with one
`actions/cache` step: it restores at setup and saves at the end of the job, in its post step, after
a miss and only when the job succeeded. setup-node still caches the package store.
