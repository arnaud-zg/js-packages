---
"shiplane": patch
---

`shiplane-ship.yml` and the `setup-node-project` action no longer turn on setup-node's package store
cache. `node_modules`, cached on the same lockfile, already covers it, so the "Post Set up Node"
step no longer uploads a second cache after a miss or warns about an empty store path after a hit.
