---
"shiplane": minor
---

`shiplane/testing` exports `platformEnvContract`, the suite every adapter's `env` passes: it lists
names only, fails saying why, and names each variable in its set command. The delivery contracts
also run `decide` and `live` on a repository with nothing tagged; a case passes `decide: false` when
its decision reads what the empty fakes cannot answer.
