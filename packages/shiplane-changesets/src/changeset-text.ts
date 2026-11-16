import type { PlannedChangeset } from "shiplane/plugin";

/** A changeset file as changesets reads it: each package's bump, then the summary. */
export const changesetText = ({ releases, summary }: PlannedChangeset) =>
  `---\n${releases.map(({ name, type }) => `"${name}": ${type}`).join("\n")}\n---\n\n${summary}\n`;
