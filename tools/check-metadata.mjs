// Display-resource regression checks. No browser or plugin activation needed.
// Run: node tools/check-metadata.mjs
import assert from "node:assert/strict";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = realpathSync(fileURLToPath(new URL("../", import.meta.url)));
const manifest = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
const TITLE = "dsh-thinking-effort-rheostat";
let passed = 0;
function check(name, condition) {
  assert.ok(condition, name);
  passed += 1;
}

check("the installation identifier stays unchanged", manifest.name === "@local/" + TITLE);
for (const [entry, target] of Object.entries({
  ".": "./index.js",
  "./client": "./client.js",
  "./package.json": "./package.json",
  "./locale/*.json": "./locale/*.json",
  "./icon": "./icon.svg"
})) {
  check("export: " + entry, manifest.exports[entry] === target);
}

for (const locale of ["en", "zh"]) {
  const meta = JSON.parse(readFileSync(resolve(ROOT, "locale", locale + ".json"), "utf8")).meta;
  check(locale + ": the title is explicit, not a package-name fallback", meta.title === TITLE);
  check(locale + ": the description explains the feature", typeof meta.description === "string" && meta.description.trim().length > 20);
}

for (const asset of ["index.js", "config-declare.js", "client.js", "cordis.patch.yml", "locale/*.json", "icon.svg", "LICENSE", "README.md"]) {
  check("the distribution includes " + asset, manifest.files.includes(asset));
}

const iconPath = realpathSync(resolve(ROOT, manifest.exports["./icon"]));
const iconRelative = relative(ROOT, iconPath);
check("the icon stays inside the package", !isAbsolute(iconRelative) && iconRelative !== ".." && !iconRelative.startsWith("..\\") && !iconRelative.startsWith("../"));
const iconSize = statSync(iconPath).size;
check("the icon fits the Harness size limit", iconSize > 0 && iconSize <= 256 * 1024);
check("the exported icon resolves to the intended resource", dirname(fileURLToPath(import.meta.resolve(manifest.name + "/icon"))) === ROOT);

console.log("OK: " + passed + " metadata checks passed");
