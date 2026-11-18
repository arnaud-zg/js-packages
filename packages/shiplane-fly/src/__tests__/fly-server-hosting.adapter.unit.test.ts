import { z } from "shiplane/plugin";
import { RecordingShell, testUnit } from "shiplane/testing";
import { describe, expect, it } from "vitest";

import { flyServerHosting } from "../fly-server-hosting.adapter";

const fly = flyServerHosting();

type Folder = Parameters<NonNullable<typeof fly.detect>>[0];

const folder = (files: Record<string, string>): Folder => ({
  dir: "apps/api",
  name: "api",
  files: Object.keys(files),
  has: (file) => file in files,
  read: (file) => files[file] ?? null,
});

describe("recognising an app Fly ships", () => {
  it("given one fly.toml, when init looks at the folder, then it is found with the app the toml names", () => {
    expect(fly.detect?.(folder({ "fly.toml": 'app = "acme-api"\n' }))).toEqual({
      certainty: "found",
      reason: "fly.toml",
      options: { app: "acme-api" },
    });
  });

  it("given a toml per environment, when init looks at the folder, then each environment gets its own app and toml", () => {
    const found = fly.detect?.(
      folder({
        "fly-preview.toml": 'app = "acme-api-preview"\n',
        "fly-production.toml": 'app = "acme-api"\n',
      }),
    );

    expect(found?.options).toEqual({
      app: { preview: "acme-api-preview", production: "acme-api" },
      config: { preview: "fly-preview.toml", production: "fly-production.toml" },
    });
  });

  it("given a Dockerfile and no fly.toml, when init looks at the folder, then Fly is only a possibility", () => {
    expect(fly.detect?.(folder({ Dockerfile: "FROM node:24\n" }))?.certainty).toBe("possible");
  });
});

describe("recognising an app Fly ships, from what its folder holds", () => {
  it("given a Dockerfile and no fly.toml, when init asks about the folder, then it offers the Fly app named after the repository and the folder", () => {
    const at = folder({ Dockerfile: "FROM node:24\n" });

    const found = fly.detect?.(at);
    const asked = fly.questions?.(at, found?.options ?? {}, "acme");

    expect(found).toEqual({ certainty: "possible", reason: "Dockerfile", options: {} });
    expect(asked).toEqual([{ key: "app", message: "Fly app?", initial: "acme-api" }]);
  });

  it("given a fly.toml that names no app, when init asks about the folder, then it still asks for the Fly app", () => {
    const at = folder({ "fly.toml": 'primary_region = "fra"\n' });

    const found = fly.detect?.(at);

    expect(found?.options).toEqual({ app: undefined });
    expect(fly.questions?.(at, found?.options ?? {}, "acme")).toHaveLength(1);
  });

  it("given a fly.toml that names its app, when init asks about the folder, then it asks nothing more", () => {
    const at = folder({ "fly.toml": 'app="acme-api"\nprimary_region = "fra"\n' });

    const found = fly.detect?.(at);

    expect(found?.options).toEqual({ app: "acme-api" });
    expect(fly.questions?.(at, found?.options ?? {}, "acme")).toEqual([]);
  });

  it("given only a preview toml, when init looks at the folder, then that toml is the config of a single app", () => {
    const found = fly.detect?.(
      folder({ "fly-preview.toml": 'app =  "acme-api-preview"\n', Dockerfile: "FROM node:24\n" }),
    );

    expect(found).toEqual({
      certainty: "found",
      reason: "fly-preview.toml",
      options: { app: "acme-api-preview", config: "fly-preview.toml" },
    });
  });

  it("given a toml per environment, when init looks at the folder, then the reason names both tomls", () => {
    const found = fly.detect?.(
      folder({
        "fly-production.toml": 'app = "acme-api"\n',
        "fly-preview.toml": '# app = "old"\napp = "acme-api-preview"\n',
      }),
    );

    expect(found?.reason).toBe("fly-preview.toml, fly-production.toml");
    expect(found?.options).toMatchObject({
      app: { preview: "acme-api-preview", production: "acme-api" },
    });
  });

  it("given only a backup and a renamed toml next to a Dockerfile, when init looks at the folder, then they are not Fly configs", () => {
    const found = fly.detect?.(
      folder({
        "fly.toml.bak": 'app = "acme-api"\n',
        "legacy-fly.toml": 'app = "acme-legacy"\n',
        Dockerfile: "FROM node:24\n",
      }),
    );

    expect(found?.certainty).toBe("possible");
  });
});

describe("checking this machine can deploy to Fly", () => {
  it("given doctor runs, when it lists what Fly needs, then flyctl must be signed in and signing in is the fix", () => {
    expect(fly.requirements?.(testUnit("api", { module: "backend-service" }))).toEqual([
      {
        label: "flyctl",
        check: { command: "flyctl", args: ["auth", "whoami"] },
        fix: { command: "flyctl", args: ["auth", "login"] },
      },
    ]);
  });
});

describe("the keys a Fly unit file takes", () => {
  it("given the editor schema or the docs, when the keys are read, then each says what it is for", () => {
    const keys = z.toJSONSchema(fly.settings, { io: "input" }).properties ?? {};
    const described = Object.fromEntries(
      Object.entries(keys).map(([key, property]) => [
        key,
        typeof property === "object" ? property.description : undefined,
      ]),
    );

    expect(fly.name).toBe("fly");
    expect(described).toEqual({
      app: "The Fly app, per environment",
      config: "Its fly.toml, relative to the unit's folder",
      dockerfile: "Relative to the unit's folder; the image builds from the repository root",
      url: "Where it answers, for other units to read",
      buildSecrets: "Variables its image build reads as secrets, passed by name when set",
    });
  });
});

describe("deploying to Fly", () => {
  const port = fly.create({ root: "/repo", shell: new RecordingShell() });

  it("given build secrets, when the deploy job is built, then each is passed by name and never by value", () => {
    const unit = testUnit("api", { module: "backend-service" });
    const [job] = port.jobs({
      unit,
      tag: "api@1.0.0",
      environment: "preview",
      commit: "abc1234",
      defaultBranch: "main",
      options: {
        app: "acme-api-preview",
        config: "fly.toml",
        dockerfile: "Dockerfile",
        buildSecrets: ["SENTRY_AUTH_TOKEN"],
      },
    });

    expect(job?.local[0]?.secrets).toEqual([{ flag: "--build-secret", name: "SENTRY_AUTH_TOKEN" }]);
    expect(job?.record).toBe(true);
  });

  it("given a unit file that sets only its app, when the deploy job is built, then flyctl deploys remotely from the unit's fly.toml and Dockerfile, waiting for the machines", () => {
    const unit = testUnit("api", { module: "backend-service", dir: "apps/api" });
    const options = fly.settings.parse({ app: "acme-api-preview" });

    const [job] = port.jobs({
      unit,
      tag: "api@1.0.0",
      environment: "preview",
      commit: "abc1234",
      defaultBranch: "main",
      options,
    });

    expect(job).toEqual({
      label: "deploy api@1.0.0 to acme-api-preview (Fly)",
      local: [
        {
          command: "flyctl",
          args: [
            "deploy",
            "--remote-only",
            "--config",
            "apps/api/fly.toml",
            "--dockerfile",
            "apps/api/Dockerfile",
          ],
          secrets: [],
        },
      ],
      ci: { ref: "api@1.0.0" },
      record: true,
    });
  });
});
