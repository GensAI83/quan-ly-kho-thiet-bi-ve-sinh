# Online warehouse, independent of the Windows PC

The user selected access from anywhere and explicitly selected moving the application and data to an online server so the PC may be off. This authorizes preparing the online application and migration. A hosting account has been requested; no paid resource will be provisioned before its cost is accepted. All local work stays under D:\QuanLyKho. The installed Windows executable/data are preserved.

## Approaches and decision

- Private connection to the PC: rejected by the user's requirement that the PC may be off.
- Cloudflare Sites with D1: available, but its runtime cannot directly run this Bun/SQLite server or its full action transactions. Replacing the storage/transaction model would enlarge this migration and weaken already verified behavior.
- Selected implementation approach (builder decision): one Bun server with a persistent SQLite disk, packaged as a Docker image. The same image can run on a VPS, Render or Railway. Render is the documented proposal, not a hosting choice already made by the user. Provider account, billing and final URL remain pending.

## Behavior and boundaries

- Reuse the React UI and existing business actions. Keep action serialization and full SQLite transactions, including failed-PIN counters and intentional partial CSV imports. No rewrite of warehouse calculations.
- A separate cloud entry point binds to 0.0.0.0 and the platform PORT. Configure one explicit HTTPS public origin; accept only its host and same-origin writes through the platform's TLS proxy. The local entry point stays loopback-only.
- A remote-access password (at least 16 characters, no default) gates the entire app before the existing staff PIN login. A signed, expiring HttpOnly/Secure/SameSite cookie remembers access; password rotation invalidates these sessions. Reject unsafe origins, malformed input, brute-force login bursts, private-file requests and remote shutdown. Public health contains no storage paths.
- Keep the database, snapshots, logs and temporary imports under the mounted persistent data directory. Do not package data, backups, credentials or browser profiles into source/image archives.
- Take consistent physical snapshots on startup, every hour and graceful shutdown. Existing in-app snapshots and JSON downloads remain available. These disk snapshots are not an offsite copy; users must download/copy backups outside the server, or later configure an independent backup destination.
- Transfer a consistent SQLite snapshot from the live local DB using SQLite's serialization API. The online import is authenticated, same-origin, size-bounded and available only while all application data tables are empty. Validate SQLite integrity and migration checksums before replacing the empty DB. Preserve staff/PIN hashes; remove imported live staff sessions. An invalid file or an import into a nonempty warehouse must not modify current data. Keep a pre-import backup and recover the empty DB if activation fails.
- Once online, the online database is authoritative. The D-drive standalone app is a separate offline copy and does not synchronize; prevent a misleading promise of automatic two-way sync.

## Deliverables and verification

Cloud auth/RPC/import tests, all existing native/regression suites, typecheck, cloud bundle, Docker/Render configuration, Vietnamese deployment/backup guide, D-drive transfer script and a mobile-viewport browser test. Docker execution and live 4G access can only be claimed after an actual host is available. No cloud URL or completed migration will be claimed from local tests.
