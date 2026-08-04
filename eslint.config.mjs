// eslint.config.mjs — flat config (ESLint 9).
//
// Deliberately small. This is a single-purpose extension: a BibTeX parser, a
// REST client, and the VS Code glue between them. The rules worth having here
// are the ones that catch real defects (unused code, floating promises,
// unchecked `any`), not stylistic ones — Prettier is not wired up in this repo,
// so nothing here should argue about formatting.

import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // Replaces .eslintignore. `out/` is compiler output; linting it would
    // report on generated code nobody edits.
    ignores: ["out/**", "node_modules/**", "*.vsix"],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ["**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Unused code is the failure mode that actually bites here: a dropped
      // header or an orphaned helper reads as intentional until someone checks.
      // `_`-prefixed args stay legal so interface-shaped callbacks can ignore
      // parameters they do not need.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // The VS Code API surfaces plenty of `any`; warn rather than block so a
      // legitimate boundary cast does not fail the build.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },

  {
    // Tests may stub globals and assert on loosely-typed mock internals.
    files: ["test/**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
