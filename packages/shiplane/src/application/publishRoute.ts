import type { DeployPath } from "../domain/deploys";
import type { ReleaseContext } from "./context";
import { OTHER_PATH } from "../domain/shipRoute";
import { ciLabel, pathLabel } from "./askPath";
import { allows, callerNeedsOf } from "./callerWorkflow";
import { fail, paint } from "./say";
import { unattended } from "./unattended";

/** What a publish is about to do: where on the CI pipeline, from which ref, as a person reads it. */
interface Publish {
  /** The environment its workflow run ships to: a test release channel, or live. */
  environment: string;
  /** The branch the run goes on. */
  ref: string;
  /** The commit origin must hold on that branch; unchecked when absent. */
  head?: string;
  /** What publishes, such as `2 packages`. */
  what: string;
  via?: DeployPath;
}

/** Why the CI pipeline cannot publish it, or null when it can. */
const ciBlocked = async (
  { services, release }: ReleaseContext,
  { environment, ref, head }: Publish,
): Promise<string | null> => {
  const { ciPipeline, sourceControl } = services;
  const { shipWorkflow: workflow } = ciPipeline;
  const file = ciPipeline.workflowFile?.(workflow);
  if (file === undefined || !ciPipeline.offers) {
    return `${ciLabel(ciPipeline)} cannot publish packages`;
  }
  const content = await sourceControl.fileAt(ref, file);
  if (content === null) return `no ${workflow}`;
  if (!ciPipeline.offers(content, environment)) return `${workflow} does not offer ${environment}`;
  const lacking = Object.entries(callerNeedsOf(release).permissions ?? {}).filter(
    ([permission, level]) => !allows(content, permission, level),
  );
  if (lacking.length > 0) {
    return `${workflow} does not allow ${lacking.map(([name, level]) => `${name}: ${level}`).join(", ")}`;
  }
  if (head !== undefined && sourceControl.pushedHead) {
    const pushed = await sourceControl.pushedHead(ref);
    if (pushed !== head) return `${ref} is not pushed as it is here`;
  }
  return null;
};

/**
 * Where a publish runs, once for all its packages: `--via`, else the config's `via`, else asked
 * every time. With nobody to ask, this machine. Null when cancelled, `refused` when `--via ci` cannot.
 */
export const publishRoute = async (
  context: ReleaseContext,
  publish: Publish,
): Promise<DeployPath | "refused" | null> => {
  const { options, release, output, prompter, services } = context;
  if (options.ci) return "local";
  const wanted = publish.via ?? release.via;
  if (wanted === "local") return "local";
  if (wanted === undefined && unattended(context)) return "local";
  const blocked = await ciBlocked(context, publish);
  if (blocked && publish.via === "ci") {
    fail(context, blocked, "nothing published: fix it, or publish from this machine.", [
      "shiplane --via local",
    ]);
    return "refused";
  }
  if (blocked) {
    output.line(
      `  ${paint("dim", `· ${blocked}: publishes from ${pathLabel(services.ciPipeline, OTHER_PATH.ci)}`)}`,
    );
    return "local";
  }
  if (wanted) return wanted;
  return prompter.select<DeployPath>(
    `Where should ${publish.what} publish from?`,
    [
      {
        value: "ci",
        label: pathLabel(services.ciPipeline, "ci"),
        hint: `${services.ciPipeline.shipWorkflow} on ${publish.ref}, to ${publish.environment}`,
      },
      { value: "local", label: pathLabel(services.ciPipeline, "local") },
    ],
    "ci",
  );
};
