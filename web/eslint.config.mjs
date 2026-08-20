import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // This codebase's standard data-fetching pattern is a shared
      // `refresh()` async function — called once from a mount effect and
      // reused after mutations — whose first synchronous statement is
      // usually setLoading(true)/setError(null). That's exactly what this
      // rule (new in eslint-plugin-react-hooks v6/v7) flags, but it's a
      // deliberate, safe, and consistent convention across every page in
      // this app (see e.g. ParticipantsPage, SeasonsPage, MatchdayPage),
      // not a bug — disabling per-callsite would just scatter identical
      // eslint-disable comments everywhere instead of fixing anything.
      "react-hooks/set-state-in-effect": "off",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  }
);
