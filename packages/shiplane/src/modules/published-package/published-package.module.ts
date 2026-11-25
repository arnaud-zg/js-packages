import type { DeliveryAdapter } from "../../ports/adapter.port";
import type { PackageRegistryPort } from "../../ports/package-registry.port";
import type { Named } from "../deliveryModule";
import type { ReleaseModule } from "../module";
import { deliveryModule } from "../deliveryModule";

/** A package others install: its registry, not deploy records, knows what is out. */
export const publishedPackage = ({
  name,
  packageRegistry,
}: Named & { packageRegistry: DeliveryAdapter<PackageRegistryPort> }): ReleaseModule => ({
  ...deliveryModule("published-package", packageRegistry, name),
  decide: (context, input) => context.open(packageRegistry).decide(context, input),
  live: (context, input) => context.open(packageRegistry).live(context, input),
  stages: ({ open }, options) => open(packageRegistry).stages?.(options) ?? true,
  publishedName: (context, input) =>
    context.open(packageRegistry).publishedName?.(input) ?? input.unit.packageName,
  publishedVersions: async (context, input) => {
    const registry = context.open(packageRegistry);
    if (!registry.publishedVersions) {
      throw new Error(
        `the ${packageRegistry.name} registry cannot list its versions: publish a snapshot instead`,
      );
    }
    return registry.publishedVersions(context, input);
  },
  tags: async (context, input) =>
    (await context.open(packageRegistry).tags?.(context, input)) ?? [],
  untagJob: (context, input, tag, otp) =>
    context.open(packageRegistry).untagJob?.(input, tag, otp) ?? null,
});
