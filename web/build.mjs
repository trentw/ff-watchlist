// Build the static site into web/dist. The data bundle in web/dist/data is
// written separately by `ff-watchlist export` and is left untouched here.
import { build } from "esbuild";
import { copyFile, cp, mkdir } from "node:fs/promises";

const out = new URL("./dist/", import.meta.url);
await mkdir(out, { recursive: true });
await build({
  entryPoints: [new URL("./src/app.ts", import.meta.url).pathname],
  outfile: new URL("app.js", out).pathname,
  bundle: true,
  format: "esm",
  target: "es2022",
  minify: true,
  sourcemap: true,
});
for (const file of ["index.html", "styles.css", "grain.svg", "site.webmanifest", "_headers"]) {
  await copyFile(new URL(`./${file}`, import.meta.url), new URL(file, out));
}
await cp(new URL("./fonts/", import.meta.url), new URL("fonts/", out), { recursive: true });
// Icon sources are full-size originals; only the derived sizes are published.
await cp(new URL("./icons/", import.meta.url), new URL("icons/", out), {
  recursive: true,
  filter: (path) => !path.includes("/icons/source"),
});
