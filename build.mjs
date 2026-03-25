import * as esbuild from "esbuild";
import { cpSync, mkdirSync } from "fs";

const isWatch = process.argv.includes("--watch");

const commonOptions = {
  bundle: true,
  minify: false,
  sourcemap: true,
  target: "chrome120",
  format: "esm",
};

const entries = [
  {
    entryPoints: ["src/background/index.ts"],
    outfile: "dist/background.js",
    ...commonOptions,
  },
  {
    entryPoints: ["src/content/index.ts"],
    outfile: "dist/content.js",
    ...commonOptions,
    format: "iife",
  },
  {
    entryPoints: ["src/popup/index.ts"],
    outfile: "dist/popup.js",
    ...commonOptions,
  },
];

function copyStaticAssets() {
  mkdirSync("dist/data", { recursive: true });
  mkdirSync("dist/wasm", { recursive: true });
  cpSync("manifest.json", "dist/manifest.json");
  cpSync("src/popup/popup.html", "dist/popup.html");
  cpSync("data/seed.sql", "dist/data/seed.sql");
  cpSync(
    "node_modules/sql.js/dist/sql-wasm.wasm",
    "dist/wasm/sql-wasm.wasm"
  );
}

async function build() {
  copyStaticAssets();

  if (isWatch) {
    const contexts = await Promise.all(entries.map((e) => esbuild.context(e)));
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    console.log("Watching for changes...");
  } else {
    await Promise.all(entries.map((e) => esbuild.build(e)));
    console.log("Build complete.");
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
