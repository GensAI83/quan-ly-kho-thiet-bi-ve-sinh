import { cp, mkdir, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { checkedRoot } from "../server/src/local-database";

const source = resolve(import.meta.dir, "..");
const root = checkedRoot(resolve(source, ".."));
process.env.TEMP = join(root, "temp");
process.env.TMP = join(root, "temp");
process.env.BUN_INSTALL_CACHE_DIR = join(root, "cache", "bun");
process.env.BUN_RUNTIME_TRANSPILER_CACHE_PATH = join(root, "cache", "transpiler");
for (const dir of ["public", "migrations", "temp", "logs", "exports", "checks", "windows", "browser-profile"]) await mkdir(join(root, dir), { recursive: true });

const client = Bun.spawnSync([process.execPath, "client/build.mjs"], { cwd: source, env: process.env, stdout: "inherit", stderr: "inherit" });
if (client.exitCode !== 0) throw new Error("Frontend build failed");
const executable = Bun.spawnSync([process.execPath, "build", "server/src/local-main.ts", "--compile", "--outfile", join(root, "QuanLyKho.exe")], { cwd: source, env: process.env, stdout: "inherit", stderr: "inherit" });
if (executable.exitCode !== 0) throw new Error("Executable build failed");
for (const name of await readdir(join(source, "drizzle"))) if (/^\d+_.*\.sql$/.test(name)) await cp(join(source, "drizzle", name), join(root, "migrations", name));
for (const name of ["Open-Kho.ps1", "Stop-Kho.ps1", "Chuyen-Du-Lieu-Online.ps1"]) await cp(join(source, "windows", name), join(root, "windows", name));
for (const name of ["MoKho.cmd", "TatKho.cmd", "HUONG-DAN.txt", "ChuyenDuLieuOnline.cmd"]) await cp(join(source, "windows", name), join(root, name));
if (!existsSync(join(root, "cau-hinh.json"))) await writeFile(join(root, "cau-hinh.json"), JSON.stringify({ port: 17830 }, null, 2));
console.log("Ready:", join(root, "MoKho.cmd"));
