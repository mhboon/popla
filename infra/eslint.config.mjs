import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "cdk.out/**",
      "node_modules/**",
      // AppSync JS resolvers run in AppSync's restricted JS runtime, not
      // Node — different globals (ctx, util) and import semantics. They're
      // small and hand-reviewed rather than linted here.
      "graphql/resolvers/**",
      // tsc build output (gitignored, but `npm run build` leaves it on
      // disk) — lint the .ts sources, not their compiled .js.
      "**/*.js",
      "**/*.d.ts",
    ],
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
