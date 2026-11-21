import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { yamlText } from "../yamlText";

const CONFIG = {
  flow: {
    sourceControl: {
      use: "git",
      with: {
        format: ["pnpm", "exec", "prettier", "--write", "--ignore-unknown", "--log-level=warn"],
      },
    },
    versioning: { use: "changesets", with: { version: ["pnpm", "-s", "changeset:version"] } },
  },
  modules: [{ use: "web-app", with: { staticHosting: "cloudflare-pages" } }],
};

describe("shiplane.yml as shiplane writes it", () => {
  it("given a command and its arguments, when written, then the list is on one line", () => {
    const text = yamlText(CONFIG);

    expect(text).toContain(
      "format: [pnpm, exec, prettier, --write, --ignore-unknown, --log-level=warn]",
    );
    expect(text).toContain("version: [pnpm, -s, changeset:version]");
  });

  it("given a list of maps, when written, then each item stays a block", () => {
    expect(yamlText(CONFIG)).toContain("modules:\n  - use: web-app\n");
  });

  it("given any config, when written and read back, then it holds the same values", () => {
    expect(parse(yamlText(CONFIG))).toEqual(CONFIG);
  });
});
