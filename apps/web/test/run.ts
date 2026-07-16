/**
 * Run each test file in its own `bun test` process.
 *
 * Bun shares one runtime across every file in a single `bun test` invocation,
 * and `mock.module` registrations are global and permanent within it — a mock a
 * file installs for `@/lib/db/repo` outlives that file and blanks the next one's
 * (`mock.restore()` does not undo a module mock, and a namespace import
 * enumerates the mock's keys at import time, so a proxy can't paper over it).
 * Two server suites that each mock the same module then pass alone and fail
 * together, purely on load order.
 *
 * One process per file is the only isolation Bun actually offers here. It costs
 * a fresh runtime per file — a few seconds across the suite — in exchange for a
 * result that doesn't depend on the order the files happen to load in.
 */
import { Glob } from "bun";
import { spawnSync } from "bun";

const passthrough = process.argv.slice(2);

const files: string[] = [];
for (const pattern of ["**/*.test.ts", "**/*.test.tsx"]) {
  for await (const f of new Glob(pattern).scan({ cwd: import.meta.dir + "/..", onlyFiles: true })) {
    if (f.startsWith("node_modules/") || f.startsWith(".next/")) continue;
    files.push(f);
  }
}
files.sort();

if (files.length === 0) {
  console.log("no test files found");
  process.exit(0);
}

let failed = 0;
for (const file of files) {
  const { exitCode } = spawnSync(["bun", "test", ...passthrough, file], {
    cwd: import.meta.dir + "/..",
    stdout: "inherit",
    stderr: "inherit",
  });
  if (exitCode !== 0) failed++;
}

if (failed > 0) {
  console.error(`\n${failed} of ${files.length} test file(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${files.length} test file(s) passed.`);
