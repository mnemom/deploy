import eslint from "@eslint/js";

export default [
  {
    ignores: ["node_modules/**", "scripts/__tests__/**"],
  },
  eslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        console: "readonly",
        process: "readonly",
        require: "readonly",
        module: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        fetch: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        clearTimeout: "readonly",
        clearInterval: "readonly",
        URL: "readonly",
      },
    },
    rules: {
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      eqeqeq: ["error", "always"],
      "prefer-const": "error",
      "no-var": "error",
      "no-constant-condition": ["error", { checkLoops: "allExceptWhileTrue" }],
    },
  },
];
