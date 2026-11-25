import { describe, expect, it } from "vitest";

import type { RegistryFacts } from "../registry";
import { TEST_FLOW } from "../../testing/flow";
import { registryDecision } from "../registry";

const facts = (known: Partial<Record<keyof RegistryFacts, boolean>>) => {
  const read: string[] = [];
  const fact = (name: keyof RegistryFacts) => () => {
    read.push(name);
    return Promise.resolve(known[name] ?? false);
  };
  return {
    read,
    facts: {
      tagged: fact("tagged"),
      published: fact("published"),
      sinceTagOnlyVersionFiles: fact("sinceTagOnlyVersionFiles"),
      onDistTag: fact("onDistTag"),
    },
  };
};

describe("shipping a package to its registry", () => {
  it("given a version with no release tag, when it ships, then nothing is released and nothing else is read", async () => {
    const subject = facts({});

    expect(
      await registryDecision({ flow: TEST_FLOW, environment: "preview", facts: subject.facts }),
    ).toBe("not-released");
    expect(subject.read).toEqual(["tagged"]);
  });

  it("given a tagged version not published yet, when it ships to production, then preview has to publish it first", async () => {
    const subject = facts({ tagged: true });

    expect(
      await registryDecision({ flow: TEST_FLOW, environment: "production", facts: subject.facts }),
    ).toBe("not-on-previous");
    expect(subject.read).toEqual(["tagged", "published"]);
  });

  it("given main moved past the tag with code, when preview publishes, then it refuses to publish code no release named", async () => {
    const subject = facts({ tagged: true });

    expect(
      await registryDecision({ flow: TEST_FLOW, environment: "preview", facts: subject.facts }),
    ).toBe("moved-past");
  });

  it("given the checkout is the tagged code, when preview publishes, then it publishes", async () => {
    const subject = facts({ tagged: true, sinceTagOnlyVersionFiles: true });

    expect(
      await registryDecision({ flow: TEST_FLOW, environment: "preview", facts: subject.facts }),
    ).toBe("publish");
  });

  it("given a published version its dist-tag already names, when it ships, then it is already there", async () => {
    const subject = facts({ tagged: true, published: true, onDistTag: true });

    expect(
      await registryDecision({ flow: TEST_FLOW, environment: "production", facts: subject.facts }),
    ).toBe("on-tag");
    expect(subject.read).not.toContain("sinceTagOnlyVersionFiles");
  });

  it("given a published version under another dist-tag, when production ships, then it moves the tag to it", async () => {
    const subject = facts({ tagged: true, published: true });

    expect(
      await registryDecision({ flow: TEST_FLOW, environment: "production", facts: subject.facts }),
    ).toBe("move-tag");
  });
});
