import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import turboPlugin from "eslint-plugin-turbo";
import tseslint from "typescript-eslint";
import onlyWarn from "eslint-plugin-only-warn";

/**
 * Test files play by looser rules than product code. Stub signatures carry
 * params they never use (an `_`-prefixed name is the convention for "here to
 * match the shape, deliberately ignored"), and fixtures reach for `any` to build
 * malformed inputs a real caller's types would forbid. Neither is a smell in a
 * test the way it would be in the code under test.
 *
 * Exported so configs that re-apply `tseslint.configs.recommended` after the
 * base (next.js does) can re-append it last — otherwise the recommended set
 * turns `no-explicit-any` back on for everything, tests included.
 */
export const testOverrides = {
  files: ["**/*.test.ts", "**/*.test.tsx", "**/test/**"],
  rules: {
    "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    "@typescript-eslint/no-explicit-any": "off",
  },
};

/**
 * A shared ESLint configuration for the repository.
 *
 * @type {import("eslint").Linter.Config[]}
 * */
export const config = [
  js.configs.recommended,
  eslintConfigPrettier,
  ...tseslint.configs.recommended,
  {
    plugins: {
      turbo: turboPlugin,
    },
    rules: {
      "turbo/no-undeclared-env-vars": "warn",
    },
  },
  {
    plugins: {
      onlyWarn,
    },
  },
  testOverrides,
  {
    ignores: ["dist/**"],
  },
];
