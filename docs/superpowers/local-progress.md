# Local Windows execution ledger

Plan: docs/superpowers/plans/2026-11-10-local-windows.md

- Source cloned at 8600ddfcce70ddaadb15f96ad73e57a84c8c884d; clean baseline; isolated branch codex/local-windows on D.
- User selected browser-based offline application at D:\QuanLyKho. Routine implementation choices follow that authorization; no further deployment/permission gate is needed for reversible local work.
- Ruling: use a fresh clone on D rather than a managed worktree, whose placement might be on C and conflict with the user's storage constraint.
- Ruling: full action transactions + serialized requests are part of the local runtime boundary. Preserve failed-login counters when a PIN is wrong.
- Task 1: pending. Task 2: pending. Task 3: pending.
