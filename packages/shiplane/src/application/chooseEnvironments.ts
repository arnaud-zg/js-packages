import type { Environment } from "../domain/environment";
import type { ReleaseModule } from "../modules/module";
import type { Release } from "./config/loadRelease";
import type { SetupContext } from "./setupContext";
import type { ModuleEntry } from "./setupFiles";
import { paint } from "./say";

const NAME = /^[a-z][a-z0-9-]*$/;

/** Whether a module deploys apps: it neither publishes packages nor only releases. */
export const deploysApps = ({ capability, releaseOnly }: ReleaseModule) =>
  capability !== "package-registry" && releaseOnly !== true;

/** Whether what setup adds deploys apps: the modules it made, and the adapters to fill in. */
const addsApps = (
  modules: readonly ReleaseModule[],
  entries: readonly ModuleEntry[],
  placed: readonly { module: string }[],
) =>
  placed.some(({ module: name }) => {
    const module = modules.find((candidate) => candidate.name === name);
    if (module) return deploysApps(module);
    return entries.some((entry) => entry.name === name && entry.port !== "packageRegistry");
  });

/** Whether setup has to name environments: it adds an app to a release that had none. */
export const needsEnvironments = ({
  modules,
  entries,
  placed,
  existing,
}: {
  modules: readonly ReleaseModule[];
  entries: readonly ModuleEntry[];
  placed: readonly { module: string }[];
  existing: Pick<Release, "units"> | null;
}) =>
  addsApps(modules, entries, placed) &&
  !existing?.units.some((unit) =>
    modules.some((module) => module.name === unit.module && deploysApps(module)),
  );

const read = (text: string) => [
  ...new Set(
    text
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean),
  ),
];

/**
 * The environments apps go through, as the person names them: never assumed. Named on the command
 * line, or asked with what the repository shows to start from. Null when cancelled, or when there is
 * nobody to ask: `needsPerson` then says so.
 */
export const chooseEnvironments = async (
  { prompter, output, environments }: SetupContext,
  {
    found,
    yes,
    needsPerson,
  }: { found: readonly Environment[]; yes: boolean; needsPerson: string[] },
): Promise<readonly Environment[] | null> => {
  if (environments) return environments;
  const seen = [...new Set(found)].join(", ");
  if (yes || !prompter.interactive) {
    needsPerson.push(
      `the environments apps go through, in order${seen ? ` (found: ${seen})` : ""}: add --environments <first>,<where users are>`,
    );
    return null;
  }
  for (;;) {
    const typed = await prompter.text(
      "Which environments do your apps go through, in order, where users are last? (comma separated)",
      seen,
    );
    if (typed === null) return null;
    const names = read(typed);
    if (names.length > 0 && names.every((name) => NAME.test(name))) return names;
    output.line(`  ${paint("red", "✗")} lowercase words, such as a-name: try again`);
  }
};

/** The steps of a path: one to the next, or straight to the only one. */
export const stepsOf = (path: readonly Environment[]): { from?: string; to?: string }[] => {
  const [first] = path;
  if (path.length === 1 && first !== undefined) return [{ to: first }];
  return path.slice(1).map((to, index) => ({ from: path[index], to }));
};
