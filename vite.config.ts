import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

function copyPdfJsAssets() {
  let projectRoot = process.cwd();
  let outputDirectory = "dist";

  async function copyAssets(destinationRoot: string) {
    const assetDirectories = ["cmaps", "standard_fonts", "wasm", "iccs"];
    const licensesDirectory = resolve(
      projectRoot,
      destinationRoot,
      "pdfjs",
      "licenses",
    );
    await mkdir(licensesDirectory, { recursive: true });
    const thirdPartyNotices = await readFile(
      resolve(projectRoot, "THIRD_PARTY_NOTICES.md"),
      "utf8",
    );
    await Promise.all(
      [
        ...assetDirectories.map((directory) =>
          cp(
            resolve(projectRoot, "node_modules/pdfjs-dist", directory),
            resolve(projectRoot, destinationRoot, "pdfjs", directory),
            { recursive: true },
          ),
        ),
        cp(
          resolve(projectRoot, "LICENSE"),
          resolve(licensesDirectory, "PDFender-MIT.txt"),
        ),
        writeFile(
          resolve(licensesDirectory, "THIRD_PARTY_NOTICES.txt"),
          `\uFEFF${thirdPartyNotices}`,
          "utf8",
        ),
        cp(
          resolve(projectRoot, "node_modules/pdfjs-dist/LICENSE"),
          resolve(licensesDirectory, "pdfjs-dist-Apache-2.0.txt"),
        ),
        cp(
          resolve(projectRoot, "node_modules/react/LICENSE"),
          resolve(licensesDirectory, "react-MIT.txt"),
        ),
      ],
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
