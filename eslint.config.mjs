import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
const configRequire = createRequire(import.meta.resolve("eslint-config-next"));
const { FlatCompat } = configRequire("@eslint/eslintrc");
const compat = new FlatCompat({ baseDirectory: path.dirname(fileURLToPath(import.meta.url)), resolvePluginsRelativeTo: path.dirname(import.meta.resolve("eslint-config-next").replace("file://", "")) });
export default [{ ignores: [".next/**", "node_modules/**"] }, ...compat.extends("next/core-web-vitals")];
