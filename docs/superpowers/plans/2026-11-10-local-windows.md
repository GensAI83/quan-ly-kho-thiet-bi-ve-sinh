# Local Windows Warehouse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a working offline Windows warehouse app at `D:\QuanLyKho` with one-click browser launch and local persistent data.

**Architecture:** Preserve the React screens and existing actions. Replace Hatch hosting with a typed local RPC adapter, Bun HTTP server and persistent SQLite; compile the server and distribute static assets with Windows launch scripts.

**Tech Stack:** Bun 1.3.12, React 19, TanStack Query, Drizzle 0.45.2, Zod 4.4.3, Tailwind 4, SQLite, PowerShell.

**Spec:** `docs/superpowers/specs/2026-11-10-local-windows-design.md`

## Global Constraints

- All writable application files, caches, browser data, exports and test output must be under `D:\QuanLyKho`; no installation to C.
- Preserve business logic from source commit `8600ddfcce70ddaadb15f96ad73e57a84c8c884d`.
- Loopback only; authenticated API; no cloud dependency for normal use.
- No remote push or publishing; this is an isolated local branch.

## Review Focus

- Failed login must persist lockout counters despite transaction rollback on failed business writes.
- Restart, repeat launcher, migration failures and occupied port must preserve existing data and processes.
- Browser downloads/profile and compiler caches must not default to C.
- Offline browser state must not disable working loopback actions.
- Different prices, order returns and interrupted writes must preserve stock and money.

### Task 1: Native local backend

**Files:** `server/src/local-contract.ts`, `server/src/local-database.ts`, `server/src/local-app.ts`, `server/src/local-main.ts`, `tests/local-app.test.ts`; modify actions SDK import and package configuration.

**Interfaces:** `openLocalDatabase(root, migrationsDir)` returns `{db, sqlite, close}`. `createLocalApp({root, migrationsDir, publicDir})` returns a request `fetch` handler and `close` lifecycle. Actions receive the existing db/invalidateQueries context.

- [x] Write tests for persistent migration/reopen, mixed-price movements, rollback on failed SQL write, failed-login lockout, invalid action/payload/origin and private-file access.
- [x] Run tests and observe missing standalone runtime failure.
- [x] Implement native database, contract and serialized transactional HTTP handler.
- [x] Run native tests and all existing regression harnesses; verify failures and successful data persistence.

### Task 2: Offline frontend and executable

**Files:** `client/src/api.ts`, `client/src/main.tsx`, `client/src/App.tsx`, `client/src/theme.css`, `client/build.mjs`, `scripts/build-local.ts`, local tsconfigs and runtime test scripts.

- [x] Use the backend contract to replace Hatch client utilities, preserving existing query/mutation behavior.
- [x] Replace Internet-only connectivity detection with server health; remove external font request.
- [x] Build static JS/CSS, compile EXE, copy migrations without touching `data`.
- [x] Typecheck and run compiled-EXE HTTP tests including real database restart and money/stock scenarios.

### Task 3: Windows launch, browser and handoff

**Files:** `windows/Open-Kho.ps1`, `windows/Stop-Kho.ps1`, launcher files, `HUONG-DAN.txt`, `scripts/browser-smoke` and verification evidence under `D:\QuanLyKho\checks`.

- [x] Implement D-only environment/profile/download setup, hidden background server and duplicate-open detection; implement graceful authenticated shutdown.
- [x] Exercise launch/stop and a browser workflow with output stored on D; inspect browser screenshot and console/network failures.
- [x] Obtain a fresh whole-branch review, fix actionable problems, rerun affected checks, and record limitations.
- [x] Leave a local commit, open the ready app and provide exact launch/data/backup locations.
