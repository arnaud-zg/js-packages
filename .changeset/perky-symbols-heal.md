---
"expo-pnpm-catalog": patch
---

Stop with a clear error naming the file and field when package.json or pnpm-workspace.yaml is
malformed, instead of failing later or silently.

`check` now reports a failure to write the Expo app's `package.json` as that error, instead of as
"expo-doctor reported issues".
