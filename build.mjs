/**
 * node build.mjs                    production bundle → dist/ (packaged into the .vsix)
 * node build.mjs --watch            same, rebuilding on change
 * node build.mjs --mock             bundle against the fake Azure DevOps host → dev-dist/
 * node build.mjs --mock --serve     …and serve it with live rebuilds (default port 8080, --port N)
 */
import * as esbuild from "esbuild";
import { cpSync, mkdirSync, rmSync, watch as fsWatch } from "node:fs";

const args = process.argv.slice(2);
const mock = args.includes("--mock");
const serve = args.includes("--serve");
const watch = args.includes("--watch") || serve;
const port = Number(args[args.indexOf("--port") + 1]) || 8080;
const outdir = mock ? "dev-dist" : "dist";

function copyStatic() {
  cpSync("static", outdir, { recursive: true });
  if (mock) cpSync("dev/index.html", `${outdir}/index.html`);
}

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });
copyStatic();

/** @type {esbuild.BuildOptions} */
const options = {
  entryPoints: { hub: "src/hub/hub.ts", widget: "src/widget/widget.ts", config: "src/widget/config.ts" },
  outdir,
  bundle: true,
  format: "iife",
  target: "es2020",
  minify: !watch && !mock,
  sourcemap: watch || mock ? "inline" : false,
  logLevel: "info",
  // The fake host replaces the real SDK; everything else is the production code.
  alias: mock ? { "azure-devops-extension-sdk": "./dev/mock/sdk.ts" } : {},
};

if (!watch) {
  await esbuild.build(options);
} else {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  for (const dir of ["static", ...(mock ? ["dev"] : [])]) {
    fsWatch(dir, { recursive: true }, () => { try { copyStatic(); } catch { /* mid-write; next event retries */ } });
  }
  if (serve) {
    const { port: p } = await ctx.serve({ servedir: outdir, port });
    console.log(`\n  Mock Azure DevOps: http://localhost:${p}/\n`);
  }
}
