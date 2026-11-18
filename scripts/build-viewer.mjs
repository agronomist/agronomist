import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const out = await build({
  entryPoints: ["src/ui/app.ts"],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  write: false,
  legalComments: "none",
});
const js = out.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const html = readFileSync("src/ui/template.html", "utf8").replace("/*APP*/", () => js);
mkdirSync("dist", { recursive: true });
writeFileSync("dist/season-viewer.html", html);
console.log(`dist/season-viewer.html ${(html.length / 1024).toFixed(0)} KB`);
