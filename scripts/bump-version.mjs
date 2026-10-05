/**
 * Bump the extension version in vss-extension.json and package.json together.
 *   node scripts/bump-version.mjs [patch|minor|major|X.Y.Z]   (default: patch)
 * The Marketplace rejects an upload whose version it has already seen, so bump before every release.
 */
import { readFileSync, writeFileSync } from "node:fs";

const files = ["vss-extension.json", "package.json"];
const current = JSON.parse(readFileSync(files[0], "utf8")).version;
const arg = process.argv[2] ?? "patch";

let next;
if (/^\d+\.\d+\.\d+$/.test(arg)) {
  next = arg;
} else {
  const [ma, mi, pa] = current.split(".").map(Number);
  next = { major: `${ma + 1}.0.0`, minor: `${ma}.${mi + 1}.0`, patch: `${ma}.${mi}.${pa + 1}` }[arg];
  if (!next) throw new Error(`Usage: bump-version.mjs [patch|minor|major|X.Y.Z], got "${arg}"`);
}

for (const f of files) {
  const text = readFileSync(f, "utf8");
  // Replace in place to keep the files' formatting.
  writeFileSync(f, text.replace(/("version":\s*")[^"]+(")/, `$1${next}$2`));
}
console.log(`${current} → ${next}`);
