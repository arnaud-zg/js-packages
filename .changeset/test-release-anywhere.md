---
"shiplane": minor
---

`shiplane test-release` publishes a test version of your npm packages for testers, with no changeset
and no pull request needed. On a branch, each package the branch changed goes out as
`<version>-<branch>.<sha>` under the npm tag `snapshot`, shared by every branch; on the default
branch, what the next release ships goes out at its next version, as `<next>-main.<sha>` under the
npm tag `snapshot` too. With an open pull request, one comment on it gives the install lines and is
edited on each run; pick its layout with `defineRelease({ testComment })`: `comments.table` (the
default), `comments.compact`, or your own text with `{branch}`, `{commit}`, `{table}` and
`{install}`. Nothing reaches git: no tag, no commit.
