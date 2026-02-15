// @ts-check

import { builtinModules } from "node:module";
import { defineConfig } from "rolldown";

/** @param {string} entry */
function actionConfig(entry) {
  const dir = entry.split("/")[1]; // e.g. "check-lsp-version"
  return {
    input: entry,
    platform: /** @type {const} */ ("node"),
    output: {
      format: /** @type {const} */ ("esm"),
      dir: `./${dir}/dist`,
      entryFileNames: "index.mjs",
    },
    resolve: {
      conditionNames: ["import"],
    },
    external: [
      ...builtinModules,
      ...builtinModules.map((m) => `node:${m}`),
    ],
  };
}

export default defineConfig([
  actionConfig("./check-lsp-version/index.ts"),
  actionConfig("./build-lsp/index.ts"),
  actionConfig("./create-draft-release/index.ts"),
  actionConfig("./create-pull-request/index.ts"),
  actionConfig("./promote-prerelease/index.ts"),
  actionConfig("./publish-release/index.ts"),
]);
