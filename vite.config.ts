import { cp } from "node:fs/promises";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

function copyPdfJsAssets() {
  let projectRoot = process.cwd();
  let outputDirectory = "dist";

  async function copyAssets(destinationRoot: string) {
    const assetDirectories = ["cmaps", "standard_fonts", "wasm", "iccs"];
    await Promise.all(
      assetDirectories.map((directory) =>
        cp(
          resolve(projectRoot, "node_modules/pdfjs-dist", directory),
          resolve(projectRoot, destinationRoot, "pdfjs", directory),
          { recursive: true },
        ),
      ),
    );
  }

  return {
    name: "copy-pdfjs-assets",
    configResolved(config: { root: string; build: { outDir: string } }) {
      projectRoot = config.root;
      outputDirectory = config.build.outDir;
    },
    async configureServer() {
      await copyAssets("public");
    },
    async closeBundle() {
      await copyAssets(outputDirectory);
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), copyPdfJsAssets()],
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1500,
  },
  test: {
    environment: "node",
  },
});
