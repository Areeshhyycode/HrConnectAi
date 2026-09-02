// Bundles the extension into dist/. That folder is what you load in Chrome —
// the repo root is not a loadable extension on purpose, so there is no way to
// accidentally load the unbundled sources.

import * as esbuild from "esbuild";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";

const watch = process.argv.includes("--watch");
const OUT = "dist";

const STATIC_FILES = [
  ["src/manifest.json", `${OUT}/manifest.json`],
  ["src/popup.html", `${OUT}/popup.html`],
  ["src/popup.css", `${OUT}/popup.css`],
  ["src/options.html", `${OUT}/options.html`],
  ["src/options.css", `${OUT}/options.css`],
];

async function copyStatic() {
  mkdirSync(OUT, { recursive: true });
  for (const [from, to] of STATIC_FILES) cpSync(from, to);

  // The icons are drawn, not checked in, so generate them on first build.
  if (!existsSync("icons/icon128.png")) await import("./make-icons.mjs");
  cpSync("icons", `${OUT}/icons`, { recursive: true });
}

const options = {
  entryPoints: [
    "src/background.js",
    "src/popup.js",
    "src/options.js",
    "src/content.js",
  ],
  outdir: OUT,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome116"],
  // The Anthropic SDK reads NODE_ENV; without this the bundle references a
  // `process` that does not exist in a service worker.
  define: {
    "process.env.NODE_ENV": '"production"',
    "process.env.ANTHROPIC_LOG": "undefined",
    global: "globalThis",
  },
  logLevel: "info",
  sourcemap: watch ? "inline" : false,
  minify: !watch,
  legalComments: "none",
};

rmSync(OUT, { recursive: true, force: true });
await copyStatic();

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("watching src/ — reload the extension in chrome://extensions after each change");
} else {
  await esbuild.build(options);
  console.log(`\nBuilt ${OUT}/ — load it with "Load unpacked" at chrome://extensions`);
}
