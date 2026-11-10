# Bản chạy trực tiếp trên Windows

User selected: bấm “Mở kho” rồi dùng trong trình duyệt trên máy; thư mục `D:\QuanLyKho`; dùng khi không có Internet. This selection authorizes the reversible local implementation. No GitHub push or cloud deployment.

## Intent

Convert commit `8600ddfcce70ddaadb15f96ad73e57a84c8c884d` into a standalone Windows application for this one-store warehouse. Preserve the existing business actions and UI. The GitHub repository contains code, not the store's existing cloud data.

## Approaches

- Chosen by user: a local server and browser, launched with one click. Simple packaging, existing React UI reused.
- Alternative: a desktop window with Electron/WebView. More packaging and runtime dependencies; user chose the browser approach.

## Constraints and design

- All application code, dependencies, database, migration records, backups, exports, logs, build/test caches and dedicated browser profile live under `D:\QuanLyKho`. Use existing tools from C read-only; redirect writable tool caches and temporary directories to D. Do not install anything to C.
- Source is isolated in `D:\QuanLyKho\source`, branch `codex/local-windows`. Application is distributed at its parent, with `QuanLyKho.exe`, `public`, `migrations`, `data`, `backups`, `exports`, `logs`, `temp`, and `browser-profile`.
- Replace private Hatch SDK with a small typed action contract, JSON HTTP client, QueryClient, and Bun HTTP server. Keep Zod request/response validation. Keep business handlers intact except the SDK import.
- Use Bun's built-in SQLite and Drizzle. Apply versioned SQL migrations once; create no demo warehouse data. Keep the existing first-login PIN-change flow.
- Bind only to `127.0.0.1:17830`. Reject unexpected Host/Origin and non-JSON action requests. Never serve database or source files. Validate actions through an explicit registry.
- Serialize action requests. Execute each action inside a SQLite transaction; roll back failed business actions or exceptions, while committing intentional failed-login lockout counters and valid CSV rows in partial-success imports. Database batch mutations are atomic too.
- Build frontend assets and compile a standalone executable, so normal use needs neither Bun/Node installation nor Internet. Remove online font dependency; use local server health instead of Internet connectivity to show connection status.
- “Mở kho” starts the server hidden, reuses an existing valid instance, and opens Edge/Chrome with a dedicated profile and download directory on D. “Tắt kho” asks the application to shut down gracefully using a local secret. Browser executables may remain at their existing OS locations.
- Persist database at `data\warehouse.sqlite`; take a physical database snapshot under `backups` on startup once per day and on graceful shutdown. Existing UI snapshots/JSON exports continue to work. Never overwrite a previous user's database or automatic backup.
- No LAN access, cloud synchronization, Windows service registration, or rewrite of the inventory workflows. Existing cloud records require a separately supplied export to migrate.

## Acceptance

Native database migrations and reopen preserve products. Real HTTP actions validate/authenticate, keep stock and voucher totals correct, and roll back simulated write failures. All existing repository regression suites pass. Compiled EXE serves all UI assets and SQLite without development dependencies. A browser smoke test covers first login/PIN change, product + mixed-price receipt, sale/return/payment, and reload persistence. Application/browser outputs are verified under D. Launcher can be opened twice and stopped safely.
