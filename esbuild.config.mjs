import esbuild from "esbuild";
import { rmSync, mkdirSync, copyFileSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

const outDir = "dist";
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
mkdirSync(path.join(outDir, "webview"), { recursive: true });

const sharedDefine = {
  "process.env.NODE_ENV": JSON.stringify(production ? "production" : "development"),
};

const extensionConfig = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: path.join(outDir, "extension.js"),
  platform: "node",
  format: "cjs",
  target: ["node18"],
  external: ["vscode"],
  sourcemap: !production,
  minify: production,
  logLevel: "info",
  define: sharedDefine,
};

const webviewConfig = {
  entryPoints: ["src/webview/index.tsx"],
  bundle: true,
  outfile: path.join(outDir, "webview", "main.js"),
  platform: "browser",
  format: "iife",
  target: ["es2020"],
  sourcemap: !production,
  minify: production,
  logLevel: "info",
  jsx: "automatic",
  loader: { ".css": "css", ".svg": "dataurl", ".png": "dataurl" },
  define: { ...sharedDefine, global: "globalThis" },
};

function runTailwind() {
  return new Promise((resolve, reject) => {
    const args = [
      "tailwindcss",
      "-i",
      "src/webview/styles/index.css",
      "-o",
      path.join(outDir, "webview", "main.css"),
    ];
    if (production) args.push("--minify");
    const proc = spawn("npx", args, { stdio: "inherit", shell: process.platform === "win32" });
    proc.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`tailwind exited ${code}`))));
  });
}

function copyStaticAssets() {
  const htmlSrc = "src/webview/index.html";
  const htmlDst = path.join(outDir, "webview", "index.html");
  if (existsSync(htmlSrc)) {
    let html = readFileSync(htmlSrc, "utf8");
    writeFileSync(htmlDst, html);
  }
  if (existsSync("media")) {
    for (const f of ["icon.png", "sidebar-icon.svg"]) {
      const src = path.join("media", f);
      if (existsSync(src)) copyFileSync(src, path.join(outDir, path.basename(src)));
    }
  }
}

async function main() {
  await runTailwind().catch((e) => {
    console.warn("[tailwind] failed:", e.message);
  });
  copyStaticAssets();

  if (watch) {
    const ext = await esbuild.context(extensionConfig);
    const wv = await esbuild.context(webviewConfig);
    await Promise.all([ext.watch(), wv.watch()]);
    console.log("[esbuild] watching…");
  } else {
    await Promise.all([esbuild.build(extensionConfig), esbuild.build(webviewConfig)]);
    console.log("[esbuild] build complete");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
