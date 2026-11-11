import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const project = resolve(import.meta.dir, "..");
const root = resolve(project, "..");
mkdirSync(join(root, "checks"), { recursive: true });
const suites = [["test", "tests/local-app.test.ts"], ["test", "tests/cloud-app.test.ts", "tests/cloud-transfer.test.ts", "tests/cloud-backups.test.ts"], ...["repro-5-bugs.ts", "repro-4-bugs.ts", "repro-2-bugs-round3.ts", "repro-money-batch.ts", "verify-extra-4.ts"].map(name => ["tests/" + name])];
for (const args of suites) {
  const result = Bun.spawnSync([process.execPath, ...args], { cwd: project, env: { ...process.env, TEMP: join(root, "temp"), TMP: join(root, "temp"), BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(root, "cache", "transpiler") }, stdout: "pipe", stderr: "pipe" });
  const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
  const label = args[args.length - 1]!.split("/").pop()!;
  writeFileSync(join(root, "checks", label + ".log"), output);
  console.log(label, "exit", result.exitCode);
  console.log(output.split("\n").filter(line => /^TỔNG|^KẾT LUẬN|^\s*\d+ (pass|fail)|^\s*\[FAIL\]/.test(line)).join("\n"));
  if (result.exitCode !== 0) { console.error(output); process.exit(result.exitCode); }
}
