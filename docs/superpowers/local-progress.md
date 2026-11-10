# Local Windows execution ledger

Plan: docs/superpowers/plans/2026-11-10-local-windows.md

- Source cloned at 8600ddfcce70ddaadb15f96ad73e57a84c8c884d; clean baseline; isolated branch codex/local-windows on D.
- User selected browser-based offline application at D:\QuanLyKho. Routine implementation choices follow that authorization; no further deployment/permission gate is needed for reversible local work.
- Ruling: use a fresh clone on D rather than a managed worktree, whose placement might be on C and conflict with the user's storage constraint.
- Ruling: full action transactions + serialized requests are part of the local runtime boundary. Preserve failed-login counters when a PIN is wrong.
- Task 1: complete. Native SQLite HTTP tests 7/7 and existing regression checks 92/92 pass; failed-login and partial CSV writes commit deliberately, other failed business actions roll back.
- Task 2: complete. Typecheck and executable build passed; compiled EXE smoke passed assets, money, sale/return/payment, shutdown and restart persistence. Browser smoke passed login/PIN change, product, mixed-price receipt, reload, offline Internet state, CSV download on D and zero page errors/external requests.
- Task 3: complete. Dedicated-profile launch verified: repeat opens reuse one PID; listener is 127.0.0.1 only; actual Edge profile/download/save paths are on D. Fresh whole-branch review found no Critical/Important issues; its minor stop/instant-reopen race is fixed by waiting for the recorded server process to exit. Actual RED: old Stop-Kho returned while runtime.json still existed. GREEN: fixed installed Stop-Kho exits successfully only after runtime.json is gone and port 17830 is closed. Full browser launcher reopened the installed app and /health returned ok with root D:\QuanLyKho.
- Builder check found CSV partial imports return ok:false while preserving valid rows. Ruling: commit this explicit partial-success response; add native HTTP regression, alongside failed-login lockout exception.
- RED observed: standalone tests fail because local-app module does not yet exist. Native backend implementation follows.
- Ruling: run Playwright with the existing Node executable (read-only on C), not Bun. Bun on Windows started Edge but its debugging pipe did not connect; only the isolated test processes were stopped. All profiles/cache/artifacts remain on D.
- Delivery: executable, launchers, guide, SQLite data, snapshots, exports, browser profile, development caches and verification output are under D:\QuanLyKho. No remote push or publishing. Existing cloud data is absent from the repository and has not been migrated; the production warehouse has no test products/orders.
