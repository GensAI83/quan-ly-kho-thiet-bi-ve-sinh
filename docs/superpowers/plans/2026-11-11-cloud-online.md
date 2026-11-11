# Online Warehouse Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Prepare and, when hosting access is available, publish a warehouse usable from a phone while the PC is off.

**Architecture:** A separate HTTPS-proxy-aware cloud entry point reuses the transactional SQLite application. A signed remote-access cookie gates staff PIN authentication. Docker and Render configuration attach persistent data storage; a guarded first-use import transfers the existing local warehouse.

**Tech Stack:** existing Bun 1.3.12, React, Drizzle/SQLite, TypeScript, Docker.

**Spec:** docs/superpowers/specs/2026-11-11-cloud-online-design.md

## Global Constraints

- All local work and artifacts remain under D:\QuanLyKho; preserve the installed offline executable/data.
- One server instance, one persistent SQLite disk; retain full transactional action execution.
- No default remote password; configure an HTTPS public origin and independent session secret.
- Hosting account and paid-resource approval are pending; do all reversible preparation first.

## Review Focus

- Host/origin confusion behind the HTTPS proxy must not bypass authentication or CSRF controls.
- Default staff PIN must never expose a public first-login takeover.
- Failed/duplicate import must preserve current data, and imported staff sessions must be revoked.
- Restart/update must reuse a mounted DB; backups must run even without opening or closing the app.
- Cloud assets and transfer archives must never overwrite local assets or contain private data.

### Task 1: Cloud boundary and guarded import

**Files:** server/src/cloud-app.ts, server/src/cloud-main.ts, tests/cloud-app.test.ts; optional publicOrigin on server/src/local-app.ts.

**Interfaces:** createCloudApp({root,migrationsDir,publicDir,publicOrigin,password,sessionSecret}) returns fetch, idle, backup, close and DB inspection for native verification. The existing createLocalApp retains default loopback behavior.

- [ ] Write tests for remote access/session/origin rejection, transactional actions, valid empty-warehouse import, bad/nonempty import and retained data after reopen.
- [ ] Run them and observe the missing cloud boundary failure.
- [ ] Implement cloud session gate, fixed-origin adapter, import and scheduled-backup entry point.
- [ ] Run cloud/native tests, full original regressions and typecheck; commit.

### Task 2: Build, transfer and deployment package

**Files:** scripts/build-cloud.ts, scripts/transfer-cloud-data.ts, Dockerfile, .dockerignore, render.yaml, docs/ONLINE.md, package scripts; output option in client/build.mjs and generic connection text.

- [ ] Build assets into source/dist/cloud instead of the installed public directory; bundle the cloud server and migrations.
- [ ] Implement consistent snapshot transfer using a secret supplied through stdin, with HTTPS required and no source DB changes.
- [ ] Add single-instance persistent-disk hosting configuration and Vietnamese deployment, backup and authoritative-data instructions.
- [ ] Verify build and native real HTTP/browser workflows at a phone viewport; obtain whole-branch review and fix findings.
- [ ] Deploy/import/verify the real URL if hosting access and billing approval arrive; otherwise hand over the tested package and the exact remaining external requirement.
