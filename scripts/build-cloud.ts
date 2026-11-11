import { mkdir, cp, readdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { checkedRoot } from "../server/src/local-database";

const source = resolve(import.meta.dir, ".."), destination = checkedRoot(join(source, "dist", "cloud"));
await mkdir(destination, { recursive: true });
const client = Bun.spawnSync([process.execPath, "client/build.mjs"], { cwd: source,
  env: { ...process.env, KHO_CLIENT_OUTDIR: join(destination, "public"), KHO_DEPLOYMENT_MODE: "online" }, stdout: "inherit", stderr: "inherit" });
if (client.exitCode !== 0) throw new Error("Cloud frontend build failed.");
const server = await Bun.build({ entrypoints: [join(source, "server", "src", "cloud-main.ts")], outdir: destination, naming: "server.js", target: "bun", minify: true });
if (!server.success) throw new AggregateError(server.logs, "Cloud server build failed.");
await mkdir(join(destination, "migrations"), { recursive: true });
for (const name of await readdir(join(source, "drizzle"))) if (/^\d+_.*\.sql$/.test(name)) await cp(join(source, "drizzle", name), join(destination, "migrations", name));
await writeFile(join(destination, "BUILD-INFO.json"), JSON.stringify({ runtime: "bun", entrypoint: "server.js", publicDirectory: "public", migrationsDirectory: "migrations", dataIncluded: false }, null, 2));
console.log("Cloud application built:", destination);
