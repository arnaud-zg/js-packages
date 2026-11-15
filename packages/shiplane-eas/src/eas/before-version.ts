import type { MobileDistributionPort } from "shiplane/plugin";

import type { Options } from "./options";
import { analyse, planWhy, verdictLines } from "./analyse";
import { clientFor } from "./client";
import { mobileRelease, releaseChangesets } from "./decide";
import { binaryVersion, setBinaryVersion } from "./version-file";
import { mobileChoice, ON_MERGE } from "./wording";

type BeforeVersion = NonNullable<MobileDistributionPort<Options>["beforeVersion"]>;

/**
 * What the release pull request does for the app, from preview's verdict: a new native layer gets a
 * new version, written to the preview binary version.
 */
export const beforeVersion: BeforeVersion = async (context, input) => {
  const { unit, options, bump } = input;
  const analysis = await analyse({
    client: clientFor({ context, unit }),
    source: context.sourceControl,
    environment: "preview",
    version: binaryVersion({ root: context.root, unit, options, environment: "preview" }),
    unit: unit.name,
  });
  const forced = input.chosen === "build" && analysis.plan.action !== "build";
  const mobile = mobileRelease(forced ? "build" : analysis.plan.action, bump, unit.version);
  const summary = forced
    ? ["↑ build  asked for, an update would do", ...verdictLines(analysis)]
    : verdictLines(analysis);
  if (mobile.ships === "blocked") {
    return {
      blocked: {
        title: "No release",
        detail:
          mobile.why === "build-running"
            ? "a preview build is still running: release once it's done, the native layer it carries decides the version."
            : "main is behind the last preview build's version.",
        commands: ["shiplane"],
      },
      added: [],
      writes: [],
      summary,
      onMerge: "Nothing ships",
    };
  }
  const changes = [...new Set(analysis.checked.flatMap(({ changes: lines }) => lines))];
  const version =
    mobile.ships === "build" || mobile.ships === "update" ? mobile.version : unit.version;
  return {
    choice: mobileChoice({
      action: analysis.plan.action,
      why: planWhy(analysis),
      app: unit.name,
    }),
    added: releaseChangesets(mobile, changes, unit.packageName),
    writes:
      mobile.ships === "build"
        ? [
            {
              label: `preview app version → ${version}`,
              run: async () => {
                setBinaryVersion({
                  root: context.root,
                  unit,
                  options,
                  environment: "preview",
                  version,
                });
                await Promise.resolve();
              },
            },
          ]
        : [],
    summary: mobile.ships === "nothing" ? ["– nothing changed"] : summary,
    onMerge: ON_MERGE[mobile.ships] ?? "Nothing ships",
    ...(mobile.ships === "build"
      ? {
          step: `Build iOS and Android ${version} on EAS, submitted to TestFlight and Play internal when done`,
        }
      : mobile.ships === "update"
        ? { step: `Publish ${version} over the air to preview` }
        : {}),
  };
};
