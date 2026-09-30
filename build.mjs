// Builds dist/code.js (Figma main thread) and dist/ui.html (UI with CSS + JS inlined,
// since Figma loads the UI as a single HTML string).
import * as esbuild from "esbuild";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";

const watch = process.argv.includes("--watch");
await mkdir("dist", { recursive: true });

async function writeUi(js) {
  const [template, css] = await Promise.all([readFile("src/ui/ui.html", "utf8"), readFile("src/ui/styles.css", "utf8")]);
  const html = template
    .replace("/*STYLE*/", () => css)
    .replace("/*SCRIPT*/", () => js.replace(/<\/script/gi, "<\/script"));
  await writeFile("dist/ui.html", html);
  // The showcase site (public/) embeds the same UI for its live demo.
  await mkdir("public/plugin", { recursive: true });
  await mkdir("public/brand", { recursive: true });
  await Promise.all([
    writeFile("public/plugin/ui.html", html),
    copyFile("brand/nomen-icon.svg", "public/brand/nomen-icon.svg"),
    copyFile("brand/nomen-cover.svg", "public/brand/nomen-cover.svg"),
  ]);
}

const mainOptions = {
  entryPoints: ["src/main/code.ts"],
  bundle: true,
  outfile: "dist/code.js",
  target: "es2017",
  format: "iife",
  logLevel: "info",
};

const uiOptions = {
  entryPoints: ["src/ui/ui.ts"],
  bundle: true,
  write: false,
  target: "es2020",
  format: "iife",
  minify: !watch,
  logLevel: "info",
  plugins: [
    {
      name: "inline-html",
      setup(build) {
        build.onEnd(async (result) => {
          if (result.errors.length === 0) await writeUi(result.outputFiles[0].text);
        });
      },
    },
  ],
  outfile: "dist/ui.js",
};

if (watch) {
  const contexts = await Promise.all([esbuild.context(mainOptions), esbuild.context(uiOptions)]);
  await Promise.all(contexts.map((c) => c.watch()));
  console.log("Watching for changes…");
} else {
  await Promise.all([esbuild.build(mainOptions), esbuild.build(uiOptions)]);
  console.log("Built dist/code.js and dist/ui.html");
}
