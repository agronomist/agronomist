// Build the site as content-addressed chunks so a small code change only changes a few files.
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
process.chdir("/home/claude/cropmodel");
// identifiers stay unminified: renaming by frequency would change every chunk on every edit
const out = await build({ entryPoints: ["src/ui/app.ts"], bundle: true, minifyWhitespace: true, minifySyntax: true, format: "iife", target: "es2020", write: false, legalComments: "none", charset: "utf8" });
const js = out.outputFiles[0].text.replace(/\n$/, "");
const tpl = readFileSync("src/ui/template.html", "utf8");
const html = tpl.replace(/<script>\s*\/\*APP\*\/\s*<\/script>/, '<script src="app.js"></script>');
if (html === tpl) throw new Error("no APP marker replaced");
const dir = process.argv[2] ?? "dist/parts5";
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const sha = (b) => createHash("sha1").update(b).digest("hex");
// content-defined chunk boundaries: cut after a ';' or '}' when a hash of the last 24 chars hits a target
const MIN = 500, MAX = 3000, MASK = 0x3f;
const parts = [];
let start = 0, h = 0;
for (let i = 0; i < js.length; i++) {
  h = (Math.imul(h, 31) + js.charCodeAt(i)) | 0;
  // rolling window of 24 via recompute on candidate boundaries only
  const len = i + 1 - start;
  const c = js[i];
  if (len >= MIN && (c === ";" || c === "}")) {
    let w = 0;
    for (let k = Math.max(start, i - 23); k <= i; k++) w = (Math.imul(w, 131) + js.charCodeAt(k)) | 0;
    if ((w & MASK) === 0 || len >= MAX) { parts.push(js.slice(start, i + 1)); start = i + 1; }
  }
}
if (start < js.length) parts.push(js.slice(start));
const names = parts.map((p) => `c${sha(Buffer.from(p)).slice(0, 8)}.js`);
const files = {};
parts.forEach((p, i) => { writeFileSync(`${dir}/${names[i]}`, p); files[names[i]] = p; });
const loader = 'Promise.all(' + JSON.stringify(names) + '.map(function(u){return fetch(u).then(function(r){if(!r.ok)throw new Error(u+" "+r.status);return r.text()})})).then(function(t){var s=document.createElement("script");s.textContent=t.join("");document.head.appendChild(s)}).catch(function(e){document.body.insertAdjacentHTML("afterbegin","<p style=\'padding:16px\'>Could not load the viewer: "+e.message+"</p>")});';
writeFileSync(`${dir}/app.js`, loader); files["app.js"] = loader;
writeFileSync(`${dir}/index.html`, html); files["index.html"] = html;
const manifest = Object.entries(files).map(([n, c]) => ({ file: n, sha: sha(Buffer.from(c)), size: Buffer.byteLength(c) }));
writeFileSync(`${dir}/manifest.json`, JSON.stringify(manifest, null, 1));
console.log("chunks", parts.length, "js bytes", Buffer.byteLength(js), "max chunk", Math.max(...parts.map((p) => Buffer.byteLength(p))));
console.log("nonascii in js:", /[^\x00-\x7f]/.test(js), "backslash-u:", /\\u[0-9a-f]{4}/i.test(js));
