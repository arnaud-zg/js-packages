import { describe, expect, it } from "vitest";

import { testContext, testUnit } from "../../testing/releaseContext";
import { hostLabel } from "../say";
import { openPrStep } from "../steps";

const PR = { number: 7, url: "https://host.test/acme/repo/pull/7", head: "sha-7" };

const given = (said: { label?: string; closeLine?: () => string }) => {
  const { context } = testContext({ units: [testUnit("api")] });
  const codeHost = Object.assign(Object.create(context.services.codeHost), said);
  return { ...context, services: { ...context.services, codeHost } };
};

describe("what a person reads about a code host comes from its port", () => {
  it("given a host with a name, when it is mentioned, then its own name is said", () => {
    expect(hostLabel(given({ label: "Acme Host" }))).toBe("Acme Host");
  });

  it("given a host without a name, when it is mentioned, then it is the code host", () => {
    expect(hostLabel(given({ label: undefined }))).toBe("the code host");
  });

  it("given a host without a close command, when a pull request is left to close by hand, then its address is given", async () => {
    const step = openPrStep(given({ closeLine: undefined }), "open", () => Promise.resolve(PR));

    await step.run();

    expect(step.undo?.byHand()).toEqual([`close ${PR.url}`]);
  });
});
