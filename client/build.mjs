import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const destination = resolve(import.meta.dir, "../../public");
await mkdir(resolve(destination, "assets"), { recursive: true });
const result = await Bun.build({
  entrypoints: [resolve(import.meta.dir, "src/main.tsx")], outdir: resolve(destination, "assets"),
  target: "browser", minify: true, naming: "[name]-[hash].[ext]", define: { "process.env.NODE_ENV": JSON.stringify("production") },
});
if (!result.success) throw new AggregateError(result.logs, "Không build được giao diện");
const script = result.outputs.find(file => file.path.endsWith(".js"));
if (!script) throw new Error("Thiếu bundle giao diện");
const html = await Bun.file(resolve(import.meta.dir, "index.html")).text();
await writeFile(resolve(destination, "index.html"), html.replace('<script src="./src/main.tsx" type="module"></script>', `<link rel="stylesheet" href="/assets/theme.css"><script src="/assets/${script.path.split(/[\\/]/).pop()}" type="module"></script>`));
const css = Bun.spawnSync([process.execPath, resolve(import.meta.dir, "../node_modules/@tailwindcss/cli/dist/index.mjs"), "-i", resolve(import.meta.dir, "src/theme.css"), "-o", resolve(destination, "assets/theme.css"), "--minify"], { cwd: resolve(import.meta.dir, ".."), stdout: "inherit", stderr: "inherit", env: process.env });
if (css.exitCode !== 0) throw new Error("Không build được CSS");
console.log("Frontend ready:", destination);
