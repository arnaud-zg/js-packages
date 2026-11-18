// Every test file starts in an empty temp folder: a command that forgets its cwd, as a mutation
// test's mutant does, fails there instead of running git, a deploy or an install in this repository.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

const home = process.cwd();
const sandbox = mkdtempSync(join(tmpdir(), "test-cwd-"));
process.chdir(sandbox);

afterAll(() => {
  process.chdir(home);
  rmSync(sandbox, { recursive: true, force: true });
});
