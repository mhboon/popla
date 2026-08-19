import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // AppSync JS resolvers run in AppSync's restricted JS runtime, not
    // Node — different globals (ctx, util) and import semantics. They're
    // small and hand-reviewed rather than linted here.
    ignores: ["cdk.out/**", "node_modules/**", "graphql/resolvers/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  }
);
