import { FlatCompat } from "@eslint/eslintrc";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname
});

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "out/**",
      "output/**",
      "next-env.d.ts",
      // Cloudways worker build output, and the vendored copy of src/server +
      // src/lib, which is linted at its real location in the repository.
      "deploy/**/dist/**",
      "deploy/**/vendor/**",
      "deploy/**/node_modules/**",
    ]
  },
  ...compat.extends("next/core-web-vitals", "next/typescript")
];

export default eslintConfig;
