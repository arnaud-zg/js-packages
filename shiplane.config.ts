// How this repository releases its own packages, with shiplane itself.
import { changesetsVersioning, lines, presets } from "@shiplane/changesets";
import { gitSourceControl } from "@shiplane/git";
import { gitHubActionsCiPipeline, gitHubCodeHost } from "@shiplane/github";
import { npmPackageRegistry } from "@shiplane/npm";
import { defineRelease, publishedPackage, releaseFlow } from "shiplane";

export default defineRelease({
  flow: releaseFlow({
    sourceControl: gitSourceControl(),
    codeHost: gitHubCodeHost(),
    ciPipeline: gitHubActionsCiPipeline(),
    versioning: changesetsVersioning({ line: lines.whatsChanged, thanks: presets.none }),
  }),
  modules: [publishedPackage({ packageRegistry: npmPackageRegistry({ staged: true }) })],
  // Packages only: nothing here deploys. From the earliest channel to the release.
  publishPackages: {
    channels: ["nightly", "alpha", "beta", "rc", "live"],
    onBranch: "snapshot",
  },
  // Each package is built before it publishes: npm gets what this commit holds, not an older dist.
  prepare: "pnpm --filter ./{dir} build",
});
