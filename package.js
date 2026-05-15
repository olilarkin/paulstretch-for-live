#!/usr/bin/env node
/**
 * Build + package paulstretch into:
 *   - <Name>-<version>.ablx          installable extension (all runtime assets)
 *
 * Includes the Vite-built dialog tree (dist/dialog) on top of the default
 * manifest + dist/extension.js.
 */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;

const manifest = JSON.parse(
  fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"),
);
const prettyName = (manifest.name || path.basename(ROOT)).replace(/\s+/g, "-");
const ablxName = `${prettyName}-${manifest.version}.ablx`;

// An .ablx is a plain zip containing the manifest, the manifest's `entry`,
// and any extra runtime assets. The host loads dist/dialog/index.html at
// command time, so the Vite-built dialog tree must be included verbatim.
// LICENSE ships too: the .ablx is a binary distribution of a GPL-2.0 program,
// so GPL §1/§3 require a copy of the license to travel with it. (The bundled
// fonts' OFL licenses ride along inside dist/dialog/licenses/.)
const ABLX_ENTRIES = ["manifest.json", manifest.entry, "dist/dialog", "LICENSE"];

function run(cmd) {
  execSync(cmd, { cwd: ROOT, stdio: "inherit" });
}

console.log("→ Building...");
run("npm run build");

console.log(`→ Packaging ${ablxName}...`);
const ablxPath = path.join(ROOT, ablxName);
fs.rmSync(ablxPath, { force: true });
const entryArgs = ABLX_ENTRIES.map((p) => `"${p}"`).join(" ");
run(`zip -rq "${ablxName}" ${entryArgs}`);

const kb = (n) => (n / 1024).toFixed(1) + " KB";
console.log();
console.log(`✓ ${ablxName}  (${kb(fs.statSync(ablxPath).size)})`);
