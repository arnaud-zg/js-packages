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
  modules: [publishedPackage({ packageRegistry: npmPackageRegistry() })],
});
