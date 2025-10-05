import { build, context } from "esbuild";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, watch } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = join(__dirname, "..");
const isWatch = process.argv.includes("--watch");
const staticDir = join(packageRoot, "static");

// Determine target browser from command line arguments
const targetBrowser = process.argv.includes("--firefox") ? "firefox" : "chrome";
const outDir = join(packageRoot, `dist-${targetBrowser}`);

const entryPoints = {
  sidepanel: join(packageRoot, "src/sidepanel.ts"),
  background: join(packageRoot, "src/background.ts"),
  content: join(packageRoot, "src/content.ts")
};

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const buildOptions = {
  absWorkingDir: packageRoot,
  entryPoints,
  bundle: true,
  outdir: outDir,
  format: "esm",
  target: targetBrowser === "firefox" ? ["firefox115"] : ["chrome120"],
  platform: "browser",
  sourcemap: isWatch ? "inline" : true,
  entryNames: "[name]",
  loader: {
    ".ts": "ts",
    ".tsx": "tsx"
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? (isWatch ? "development" : "production")),
    "process.env.TARGET_BROWSER": JSON.stringify(targetBrowser)
  }
};

// Get all files from static directory
const getStaticFiles = () => {
  return readdirSync(staticDir).map(file => join("static", file));
};

const copyStatic = () => {
  // Use browser-specific manifest
  const manifestSource = join(packageRoot, `manifest.${targetBrowser}.json`);
  const manifestDest = join(outDir, "manifest.json");
  copyFileSync(manifestSource, manifestDest);

  // Copy all files from static/ directory
  const staticFiles = getStaticFiles();
  for (const relative of staticFiles) {
    const source = join(packageRoot, relative);
    const filename = relative.replace("static/", "");
    const destination = join(outDir, filename);
    copyFileSync(source, destination);
  }

  // Copy PDF.js worker from node_modules (check both local and monorepo root)
  let pdfWorkerSource = join(packageRoot, "node_modules/pdfjs-dist/build/pdf.worker.min.mjs");
  if (!existsSync(pdfWorkerSource)) {
    pdfWorkerSource = join(packageRoot, "../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs");
  }
  const pdfWorkerDestDir = join(outDir, "pdfjs-dist/build");
  mkdirSync(pdfWorkerDestDir, { recursive: true });
  const pdfWorkerDest = join(pdfWorkerDestDir, "pdf.worker.min.mjs");
  copyFileSync(pdfWorkerSource, pdfWorkerDest);

  console.log(`Built for ${targetBrowser} in ${outDir}`);
};

const run = async () => {
  if (isWatch) {
    const ctx = await context(buildOptions);
    await ctx.watch();
    copyStatic();

    // Watch the entire static directory
    watch(staticDir, { recursive: true }, (eventType) => {
      if (eventType === 'change') {
        console.log(`\nStatic files changed, copying...`);
        copyStatic();
      }
    });

    process.stdout.write("Watching for changes...\n");
  } else {
    await build(buildOptions);
    copyStatic();
  }
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
