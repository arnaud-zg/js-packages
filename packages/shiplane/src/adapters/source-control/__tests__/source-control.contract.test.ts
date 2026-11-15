import { SourceControlFake } from "../__fakes__/source-control.fake";
import { sourceControlContract } from "../source-control.contract";

sourceControlContract("the fake", () => {
  const fake = new SourceControlFake();
  const changed: string[] = [];
  const ignored: string[] = [];
  return Promise.resolve({
    port: fake,
    head: async () => (await fake.position()).head,
    change: (file) => {
      // The contract's .gitignore names the .env files: git lists them as ignored, not changed.
      if (file.startsWith(".env")) ignored.push(file);
      else changed.push(file);
      fake.seed({ changed: [...changed], ignored: [...ignored] });
      return Promise.resolve();
    },
  });
});
