import type { CodeHostPort, SourceControlPort } from "shiplane";
import type { CatalogEntry } from "shiplane/plugin";
import { z } from "shiplane";
import { adapterEntry, featureEntry, serviceIn } from "shiplane/plugin";

import { gitHubActionsCiPipeline } from "./github-actions-ci-pipeline.adapter";
import { gitHubCodeHost } from "./github-code-host.adapter";
import { releaseComments } from "./release-comments.feature";

/**
 * What a shiplane.yml names from this plugin: `codeHost: github`, `ciPipeline: github-actions`,
 * and the `release-comments` feature.
 */
export const catalog: readonly CatalogEntry[] = [
  adapterEntry({
    name: "github",
    port: "codeHost",
    description: "Pull requests, releases and deploy records on GitHub, through the gh CLI",
    options: z.object({}),
    make: () => gitHubCodeHost(),
  }),
  adapterEntry({
    name: "github-actions",
    port: "ciPipeline",
    description: "Ships through a GitHub Actions workflow, through the gh CLI",
    options: z.object({
      shipWorkflow: z
        .string()
        .optional()
        .describe("The workflow a ship through CI dispatches: ship.yml by default"),
    }),
    make: (options) => gitHubActionsCiPipeline(options),
  }),
  featureEntry({
    name: "release-comments",
    description: "Comments on each pull request and issue a ship releases",
    options: z.object({
      apps: z
        .array(z.string())
        .optional()
        .describe("The apps whose ships comment; every app when absent"),
    }),
    slots: {
      codeHost: { port: "codeHost" },
      sourceControl: { port: "sourceControl" },
    },
    make: ({ apps }, { codeHost, sourceControl }) => {
      if (!codeHost || !sourceControl) {
        throw new Error("release-comments needs a codeHost and a sourceControl");
      }
      return releaseComments({
        codeHost: serviceIn<CodeHostPort>(codeHost),
        sourceControl: serviceIn<SourceControlPort>(sourceControl),
        ...(apps ? { apps } : {}),
      });
    },
  }),
];
