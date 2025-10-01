import { build, context } from "esbuild";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = join(__dirname, "..");
const isWatch = process.argv.includes("--watch");

// Determine target browser from command line arguments
const targetBrowser = process.argv.includes("--firefox") ? "firefox" : "chrome";
const outDir = join(packageRoot, `dist-${targetBrowser}`);

const entryPoints = {
  sidepanel: join(packageRoot, "src/sidepanel.ts"),
  background: join(packageRoot, "src/background.ts")
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

const copyStatic = () => {
  // Use browser-specific manifest
  const manifestSource = join(packageRoot, `manifest.${targetBrowser}.json`);
  const manifestDest = join(outDir, "manifest.json");
  copyFileSync(manifestSource, manifestDest);

  // Copy other static files
  const filesToCopy = [
    "icon-16.png",
    "icon-48.png",
    "icon-128.png",
    join("src", "sidepanel.html"),
    join("src", "sandbox.html")
  ];

  for (const relative of filesToCopy) {
    const source = join(packageRoot, relative);
    let destination = join(outDir, relative);
    if (relative.startsWith("src/")) {
      destination = join(outDir, relative.slice(4)); // Remove "src/" prefix
    }
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
