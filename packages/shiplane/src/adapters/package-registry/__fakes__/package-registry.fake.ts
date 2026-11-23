import { z } from "zod";

import type { Environment } from "../../../domain/environment";
import type { TaggedVersion } from "../../../domain/snapshotTags";
import type { DeliveryAdapter } from "../../../ports/adapter.port";
import type {
  DecideContext,
  Decision,
  Job,
  JobInput,
  Requirement,
} from "../../../ports/delivery.port";
import type { PackageRegistryPort } from "../../../ports/package-registry.port";

const PackageSettings = z.object({
  tag: z.string().default("latest").describe("The dist-tag a release moves"),
});

/** What a module asked of it. */
export interface Asked {
  stage: "jobs" | "decide";
  tag: string;
  environment: Environment;
}

/** A package registry held in memory: seed what is published, a version not there yet publishes. */
export class PackageRegistryFake implements PackageRegistryPort {
  readonly capability = "package-registry";

  /** `<package>@<version>` already published. */
  private published = new Set<string>();
  private needs: Requirement[] = [];
  /** Each package's dist-tags, by package name. */
  private tagged = new Map<string, TaggedVersion[]>();
  readonly received: Asked[] = [];

  seed({
    published = [],
    requirements = [],
    tags = {},
  }: {
    published?: string[];
    requirements?: Requirement[];
    /** Each package's dist-tags, by package name. */
    tags?: Record<string, TaggedVersion[]>;
  }) {
    this.published = new Set(published);
    this.needs = requirements;
    this.tagged = new Map(Object.entries(tags));
    return this;
  }

  describe = ({ unit, options }: JobInput<Record<string, unknown>>) =>
    `${unit.packageName} (fake, ${PackageSettings.parse(options).tag})`;

  jobs = ({ unit, tag, environment, options }: JobInput<Record<string, unknown>>): Job[] => {
    this.received.push({ stage: "jobs", tag, environment });
    return [
      {
        label: `publish ${unit.packageName}@${unit.version} under ${PackageSettings.parse(options).tag} (fake)`,
        local: [{ command: "echo", args: ["publish", unit.packageName, unit.version] }],
        needsBuild: true,
      },
    ];
  };

  decide = (_context: DecideContext, input: JobInput<Record<string, unknown>>) => {
    const { unit, tag, environment } = input;
    this.received.push({ stage: "decide", tag, environment });
    const decision: Decision = this.published.has(`${unit.packageName}@${unit.version}`)
      ? { action: "none", status: `${unit.packageName}@${unit.version} is published` }
      : { action: "ship", kind: "publish", jobs: this.jobs(input) };
    return Promise.resolve(decision);
  };

  publishedName = ({ unit }: JobInput<Record<string, unknown>>) => unit.packageName;

  /** Every `<version>` published of the unit's package, as the registry lists them. */
  publishedVersions = (_context: DecideContext, { unit }: JobInput<Record<string, unknown>>) =>
    Promise.resolve(
      [...this.published].flatMap((entry) => {
        const at = entry.lastIndexOf("@");
        return entry.slice(0, at) === unit.packageName ? [entry.slice(at + 1)] : [];
      }),
    );

  tags = (_context: DecideContext, { unit }: JobInput<Record<string, unknown>>) =>
    Promise.resolve(this.tagged.get(unit.packageName) ?? []);

  /** The job that removes a tag: an echo the shell records, the otp passed along. */
  untagJob = ({ unit }: JobInput<Record<string, unknown>>, tag: string, otp?: string): Job => ({
    label: `remove the ${tag} tag from ${unit.packageName}`,
    local: [
      {
        command: "echo",
        args: ["untag", unit.packageName, tag, ...(otp ? [`otp=${otp}`] : [])],
      },
    ],
  });

  /** Records a publish, as a test release's jobs would: the next numbering reads it. */
  publish(packageAt: string) {
    this.published.add(packageAt);
  }

  live = (_context: DecideContext, { unit }: JobInput<Record<string, unknown>>) =>
    Promise.resolve(this.published.has(`${unit.packageName}@${unit.version}`));

  requirements = () => this.needs;
}

/** The Fake as a config holds an adapter; `.fake` is what a test seeds and reads. */
export const packageRegistryFake = (
  fake = new PackageRegistryFake(),
): DeliveryAdapter<PackageRegistryPort> & { fake: PackageRegistryFake } => ({
  name: "fake",
  capability: "package-registry",
  settings: PackageSettings,
  typicalMinutes: 1,
  requirements: () => fake.requirements(),
  create: () => fake,
  fake,
});
