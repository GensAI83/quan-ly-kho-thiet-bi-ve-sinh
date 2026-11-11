import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pruneCloudBackups } from "../server/src/cloud-backups";

test("cloud retention bounds total backup bytes and preserves the newest two and user-kept files", () => {
  const root = mkdtempSync(join(resolve(import.meta.dir, "../../checks"), "retention-test-")), backups = join(root, "backups");
  mkdirSync(backups);
  const dbfile = join(root, "fixture.sqlite"), db = new Database(dbfile);
  db.exec("CREATE TABLE fixture(stock INTEGER); INSERT INTO fixture VALUES(17)"); db.close();
  const size = readFileSync(dbfile).byteLength;
  const files: string[] = [];
  for (let day = 1; day <= 6; day++) {
    const path = join(backups, `warehouse-2026-11-0${day}T00-00-00-000Z.sqlite`);
    copyFileSync(dbfile, path); utimesSync(path, day * 86400, day * 86400); files.push(path);
  }
  const manual = join(backups, "my-kept-copy.sqlite"), beforeImport = join(backups, "warehouse-before-import-012345.sqlite");
  copyFileSync(dbfile, manual); copyFileSync(dbfile, beforeImport);
  pruneCloudBackups(root, { maxFiles: 3, maxBytes: size * 2, minKeep: 2 });
  expect(files.map(path => existsSync(path))).toEqual([false, false, false, false, true, true]);
  expect(existsSync(manual)).toBe(true); expect(existsSync(beforeImport)).toBe(true);
});
