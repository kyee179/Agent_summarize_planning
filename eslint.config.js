import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["dist", "release", "node_modules"] },
  js.configs.recommended,
  {
    files: ["**/*.{js,jsx,cjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2024
      }
    },
    rules: {
      "no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
      "no-console": "off"
    }
  },
  {
    files: ["electron/**/*.cjs", "server/**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs"
    }
  }
];
