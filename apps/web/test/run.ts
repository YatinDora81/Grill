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
