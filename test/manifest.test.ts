import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync("vss-extension.json", "utf8"));
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const build = readFileSync("build.mjs", "utf8");
const byId = new Map<string, any>(manifest.contributions.map((c: any) => [c.id, c]));

test("package.json and vss-extension.json versions match", () => {
  assert.equal(pkg.version, manifest.version);
});

test("every contribution page exists and loads a bundle the build produces", () => {
  const entries = [...build.matchAll(/(\w+): "src\/[^"]+\.ts"/g)].map((m) => m[1]);
  for (const c of manifest.contributions) {
    const uri: string = c.properties.uri;
    assert.match(uri, /^dist\/\w+\.html$/, `${c.id} uri`);
    const html = readFileSync(uri.replace(/^dist\//, "static/"), "utf8");
    const scripts = [...html.matchAll(/<script src="([^"]+)\.js"><\/script>/g)].map((m) => m[1]);
    assert.equal(scripts.length, 1, `${uri} has one script`);
    assert.ok(entries.includes(scripts[0]), `${uri} loads ${scripts[0]}.js, which build.mjs builds`);
  }
});

test("images referenced by the manifest exist", () => {
  const paths = [manifest.icons.default, manifest.content.details.path];
  for (const c of manifest.contributions) for (const k of ["catalogIconUrl", "previewImageUrl"]) if (c.properties[k]) paths.push(c.properties[k]);
  for (const p of paths) assert.ok(existsSync(p), p);
});

test("the widget points at its configuration contribution", () => {
  const widget = byId.get("aging-wip-widget");
  const config = widget.targets.find((t: string) => t.startsWith("."));
  assert.ok(byId.has(config.slice(1)), `${config} exists`);
  assert.equal(byId.get(config.slice(1)).type, "ms.vss-dashboards-web.widget-configuration");
});

test("objects registered with the SDK use the manifest's contribution ids", () => {
  for (const [file, id] of [["src/widget/widget.ts", "aging-wip-widget"], ["src/widget/config.ts", "aging-wip-widget-config"]]) {
    assert.ok(readFileSync(file, "utf8").includes(`SDK.register("${id}"`), `${file} registers "${id}"`);
    assert.ok(byId.has(id), `manifest has ${id}`);
  }
});

test("scopes cover the REST calls (work items, teams)", () => {
  assert.deepEqual([...manifest.scopes].sort(), ["vso.project", "vso.work"]);
});
